// Write layer for the app-managed writes (GitHub issue #5): frontmatter
// patches, session start/end, session log, inbox. See DECISIONS #4 for the
// write model — the app only ever appends log/inbox lines and patches
// frontmatter keys; content editing stays external.
//
// Non-negotiables implemented here:
//
//   1. RAW-TEXT PATCHING. A frontmatter patch never serializes the parsed
//      `ParsedFile.frontmatter` back to disk — the shared parser injects
//      fallback keys (`id` from the filename etc.) that must not materialize
//      in the file. Instead the raw text is split into YAML block + body,
//      the block alone is parsed (gray-matter, same engine as shared/),
//      patched, and re-emitted; the body is reattached byte-identically.
//      Key order stays stable: existing keys in file order, new keys
//      appended. Keys not named in the patch keep their values (the YAML
//      block is re-emitted, so surface formatting of the block may
//      normalize — e.g. `+2` becomes `2` — but never the meaning).
//   2. ATOMIC-ISH WRITES. Every write goes to a temp file in the same
//      directory followed by a rename, so a crash never leaves a partial
//      file.
//   3. PER-FILE SERIALIZATION. Writes to the same absolute path are chained
//      on an in-memory promise queue. This covers concurrent requests within
//      this process only — multi-process deployments are out of scope
//      (single container, DECISIONS #5); cross-process conflicts are what
//      the mtime check is for.
//   4. Node APIs only (node:fs/promises, node:path) — DECISIONS #5/#7.

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { CORE_SCHEMA, dump } from "js-yaml";
import { isEnded, kindFromPath, parseMarkdown, type FileResponse } from "@grimoire/shared";
import {
  ApiError,
  assertSafeRelativeMdPath,
  CAMPAIGN_FILE,
  campaignDir,
  findActiveSessionRel,
  findLastStartedSessionRel,
  readParsedFile,
  resolveInsideCampaign,
  RESERVED_DIRS,
} from "./campaign-fs";
import { localDate, localDateTime, localTime, now } from "./clock";

// --- per-file write serialization ---------------------------------------------

/** Tail of the write chain per absolute path; entries are removed when idle. */
const writeChains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after all previously queued writes for `abs` have settled.
 * Failures of earlier writes do not poison the queue.
 * (Exported for the generator's apply step — same lock map, so generator
 * writes serialize with the write API's writes.)
 */
export function withFileLock<T>(abs: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(abs) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  writeChains.set(abs, tail);
  void tail.then(() => {
    if (writeChains.get(abs) === tail) writeChains.delete(abs);
  });
  return run;
}

// --- atomic write ---------------------------------------------------------------

let tmpCounter = 0;

/**
 * Write `content` to a temp file next to `abs`, then rename it into place.
 * The temp name starts with a dot, so a leftover from a crash is invisible
 * to the readers (hidden files are skipped everywhere).
 * (Exported for the generator's apply step.)
 */
export async function atomicWrite(abs: string, content: string): Promise<void> {
  const tmp = path.join(
    path.dirname(abs),
    `.${path.basename(abs)}.${process.pid}.${tmpCounter++}.tmp`,
  );
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, abs);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

// --- raw frontmatter patching ----------------------------------------------------

/**
 * Split raw file text into the YAML frontmatter block and the body.
 * Returns null when the file has no (closed) frontmatter block. The body is
 * the exact byte sequence after the closing delimiter's newline — it is
 * reattached verbatim, which is what keeps patches body-identical.
 */
function splitFrontmatterBlock(raw: string): { yamlText: string; body: string } | null {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return null;
  const firstNl = raw.indexOf("\n");
  let pos = firstNl + 1;
  while (pos <= raw.length) {
    const nl = raw.indexOf("\n", pos);
    const lineEnd = nl === -1 ? raw.length : nl;
    let line = raw.slice(pos, lineEnd);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "---") {
      return {
        yamlText: raw.slice(firstNl + 1, pos),
        body: nl === -1 ? "" : raw.slice(nl + 1),
      };
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  // An unclosed block has no body to reattach, so there is nothing to split.
  // CAREFUL: this is NOT what the parser does — gray-matter still reads
  // frontmatter out of several files this rejects (a stray space after the
  // closing fence, a file that ends inside the block, a BOM in front of the
  // opening one). Every caller that writes a body back must therefore compare
  // its result against the parser's; see writeFileBody.
  return null;
}

/**
 * Replace the BODY of raw file text, keeping the frontmatter block verbatim.
 * `body` has the same semantics as `ParsedFile.body` (gray-matter's
 * `content`): everything after the closing delimiter's newline — so a body
 * read via GET /file can be written back unchanged. A file without a
 * frontmatter block IS its body.
 *
 * Nothing is normalized except the trailing newline: a non-empty body that
 * lacks one gets exactly one appended (every file of the format ends with a
 * single newline). Existing trailing newlines are left alone, so a roundtrip
 * stays byte-identical.
 */
function replaceBody(raw: string, body: string): string {
  const next = body === "" || body.endsWith("\n") ? body : `${body}\n`;
  const block = splitFrontmatterBlock(raw);
  if (block === null) return next;
  // The frontmatter block is exactly the raw prefix in front of the old body,
  // reused byte for byte — never re-emitted from parsed YAML (rule 1 above).
  let prefix = raw.slice(0, raw.length - block.body.length);
  // Degenerate file that ends right at the closing `---` without a newline:
  // without this the new body would be glued onto the delimiter line.
  if (next !== "" && !prefix.endsWith("\n")) prefix += "\n";
  return prefix + next;
}

/**
 * gray-matter's js-yaml parses unquoted YAML timestamps as Date objects.
 * Normalize them back to the strings the format uses (same rules as the
 * shared parser: date-only -> `yyyy-mm-dd`, datetime -> `yyyy-mm-ddTHH:MM`,
 * read with UTC getters because zone-less timestamps are parsed as UTC).
 * Always returns fresh containers — gray-matter caches parsed objects.
 */
function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
    const isMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    return isMidnight ? date : `${date}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  }
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeDates(v);
    return out;
  }
  return value;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

/** Keys that would hit Object.prototype machinery instead of data. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Parsed frontmatter of the raw block (dates normalized), keys in file order. */
function currentFrontmatter(raw: string): Record<string, unknown> {
  if (splitFrontmatterBlock(raw) === null) return {};
  let data: unknown;
  try {
    data = matter(raw).data;
  } catch {
    throw new ApiError(400, "frontmatter is not valid YAML — fix the file externally");
  }
  if (!isPlainObject(data)) {
    throw new ApiError(400, "frontmatter is not a YAML mapping — fix the file externally");
  }
  const fm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) fm[k] = normalizeDates(v);
  return fm;
}

/**
 * Apply a flat frontmatter patch (null deletes a key) to the RAW file text.
 * Only the YAML block is regenerated; the body stays byte-identical. A file
 * without a frontmatter block gets one prepended iff the resulting
 * frontmatter is non-empty; deleting the last key drops the block.
 * (Exported for the rename cascade of issue #30 — it patches reference keys
 * in many files and must use the exact same raw-patch mechanism.)
 */
export function applyFrontmatterPatch(raw: string, patch: Record<string, unknown>): string {
  const block = splitFrontmatterBlock(raw);
  const fm = currentFrontmatter(raw);

  for (const [key, value] of Object.entries(patch)) {
    if (key === "" || UNSAFE_KEYS.has(key)) throw new ApiError(400, `invalid patch key: ${key}`);
    if (value === null) delete fm[key];
    else fm[key] = value;
  }

  const body = block === null ? raw : block.body;
  if (Object.keys(fm).length === 0) return body;

  // flowLevel 1 keeps nested collections inline ([a, b], {k: v}) — the style
  // the README examples use; CORE_SCHEMA leaves timestamp-like strings
  // unquoted (they round-trip through the shared parser's normalization).
  const yaml = dump(fm, { schema: CORE_SCHEMA, flowLevel: 1, lineWidth: -1 });
  return `---\n${yaml}---\n${body}`;
}

// --- endpoint operations -----------------------------------------------------------

/**
 * PATCH /api/:campaign/frontmatter — optimistic concurrency via mtimeMs:
 * the file's current mtime must equal the one the client read, otherwise
 * 409 with the current mtimeMs (DECISIONS #4).
 */
export async function patchFrontmatter(
  campaign: string,
  rel: string,
  mtimeMs: number,
  patch: Record<string, unknown>,
): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const abs = await resolveInsideCampaign(dir, rel); // 404 missing, 400 unsafe
  await withFileLock(abs, async () => {
    let s;
    try {
      s = await stat(abs);
    } catch {
      throw new ApiError(404, "file not found");
    }
    if (s.mtimeMs !== mtimeMs) {
      throw new ApiError(409, "file changed on disk — reload before patching", {
        mtimeMs: s.mtimeMs,
      });
    }
    const raw = await readFile(abs, "utf8");
    const next = applyFrontmatterPatch(raw, patch);
    if (next !== raw) await atomicWrite(abs, next);
  });
  return readParsedFile(campaign, rel);
}

/**
 * PUT /api/:campaign/file — replace the markdown BODY of an EXISTING file
 * (issue #15: editing content in the app instead of an external editor,
 * DECISIONS #11). The frontmatter block is carried over byte-identically;
 * frontmatter keys are only ever changed through PATCH /frontmatter.
 * Same optimistic concurrency as the frontmatter patch (DECISIONS #4): the
 * file's current mtime must equal the one the client read, otherwise 409 with
 * the current mtimeMs.
 * Append-only kinds (session logs, inbox) are refused with 400 — they grow by
 * lines through their own endpoints, never by a body rewrite (DECISIONS #4).
 */
export async function writeFileBody(
  campaign: string,
  rel: string,
  mtimeMs: number,
  body: string,
): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const abs = await resolveInsideCampaign(dir, rel); // 404 missing, 400 unsafe
  // DECISIONS #4: session logs and the inbox are APPEND-ONLY — the app adds
  // single lines through POST /log and POST /inbox and never rewrites them.
  // The reading view already hides „Bearbeiten" for these kinds, but the rule
  // belongs to the endpoint: the API is the contract, not the button.
  const kind = kindFromPath(rel);
  if (kind === "session" || kind === "inbox") {
    throw new ApiError(400, "this file is append-only — use the log/inbox endpoints");
  }
  await withFileLock(abs, async () => {
    let s;
    try {
      s = await stat(abs);
    } catch {
      throw new ApiError(404, "file not found");
    }
    if (!s.isFile()) throw new ApiError(404, "file not found"); // e.g. a dir named *.md
    if (s.mtimeMs !== mtimeMs) {
      throw new ApiError(409, "file changed on disk — reload before saving", {
        mtimeMs: s.mtimeMs,
      });
    }
    const raw = await readFile(abs, "utf8");
    // Guard every case where the client's notion of "body" (what GET /file
    // handed out, i.e. the PARSER's body) and the raw split disagree — the
    // parser is what seeded the editor, so a mismatch means the write would
    // change more than the body:
    //
    //   block found, parser body differs — the block is not a YAML mapping,
    //     the parser degrades and reports the WHOLE file as body (README:
    //     format degrades); writing that back would duplicate the block.
    //   NO block found, parser body differs from the raw file — the parser
    //     DID read frontmatter where the raw split sees none (stray space
    //     after the closing fence, a file that ends inside the block, a BOM
    //     in front of the opening fence). replaceBody would write the body
    //     alone and DELETE the frontmatter from disk.
    //
    // Same 400 as the frontmatter patch — such a file is fixed externally.
    // The parser's body is compared instead of relying on a thrown YAML
    // error: gray-matter caches by content and degrades silently.
    const block = splitFrontmatterBlock(raw);
    const parsedBody = parseMarkdown(raw, rel, s.mtimeMs).body;
    if (block === null ? parsedBody !== raw : parsedBody !== block.body) {
      throw new ApiError(400, "frontmatter is not valid YAML — fix the file externally");
    }
    const next = replaceBody(raw, body);
    if (next !== raw) await atomicWrite(abs, next);
  });
  return readParsedFile(campaign, rel);
}

/**
 * POST /api/:campaign/session/start — create today's session file.
 *
 * The session state machine has exactly three answers here (issue #40 review):
 *
 *   - a session is RUNNING and it is today's file -> return it untouched
 *     (idempotent: pressing "Session starten" twice re-enters the session).
 *   - a session is RUNNING but in an OLDER file (the evening ran past
 *     midnight, or an old session was never ended) -> 409 { code:
 *     "session_running", path }. No implicit ending of someone else's session
 *     and no second parallel session: the app offers "alte Session beenden".
 *     This is also what keeps a past-midnight session alive — it stays THE
 *     session instead of being shadowed by a fresh file for the new day.
 *   - today's file exists and is ENDED -> 409 { code: "session_ended", path }.
 *     Silently handing out the ended file made the live view a dead end until
 *     midnight (a Start button that changed nothing); re-opening it silently
 *     would rewrite history behind the DM's back. The app asks and calls
 *     `resumeSession` — the explicit undo of an accidental "beenden".
 */
export async function startSession(campaign: string): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const d = now();
  const rel = `sessions/${localDate(d)}.md`;
  const abs = path.resolve(dir, rel);
  const activeRel = await findActiveSessionRel(campaign);
  if (activeRel !== undefined && activeRel !== rel) {
    throw new ApiError(409, "another session is still running — end it first", {
      code: "session_running",
      path: activeRel,
    });
  }
  if (activeRel === rel) return readParsedFile(campaign, rel);
  let created = false;
  await withFileLock(abs, async () => {
    try {
      if ((await stat(abs)).isFile()) return; // exists and is not active => ended
    } catch {
      // does not exist yet — create below
    }
    await mkdir(path.dirname(abs), { recursive: true });
    const content = `---\nid: ${localDate(d)}\nstarted: ${localDateTime(d)}\nscenes_played: []\n---\n\n## Log\n`;
    await atomicWrite(abs, content);
    created = true;
  });
  if (!created) {
    throw new ApiError(409, "today's session is already ended", {
      code: "session_ended",
      path: rel,
    });
  }
  return readParsedFile(campaign, rel);
}

/**
 * POST /api/:campaign/session/resume — re-open the last started session by
 * REMOVING `ended` (issue #40 review): the explicit undo of an accidental
 * "Session beenden", so the evening can continue in the same file instead of
 * being split in two. 404 when there is no session file at all, 409 when the
 * last started session is still running (nothing to resume).
 */
export async function resumeSession(campaign: string): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const rel = await findLastStartedSessionRel(campaign);
  if (rel === undefined) throw new ApiError(404, "no session to resume");
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      throw new ApiError(404, "no session to resume");
    }
    if (!isEnded(currentFrontmatter(raw))) {
      throw new ApiError(409, "this session is still running", { path: rel });
    }
    await atomicWrite(abs, applyFrontmatterPatch(raw, { ended: null }));
  });
  return readParsedFile(campaign, rel);
}

/**
 * POST /api/:campaign/session/end — set `ended` in the RUNNING session via the
 * raw-patch mechanism (that may be YESTERDAY's file when the session went past
 * midnight). Idempotent: with nothing running it falls back to the LAST
 * STARTED session and keeps its existing `ended`; 404 only when the campaign
 * has no session file at all.
 */
export async function endSession(campaign: string): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const rel = (await findActiveSessionRel(campaign)) ?? (await findLastStartedSessionRel(campaign));
  if (rel === undefined) throw new ApiError(404, "no active session");
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      throw new ApiError(404, "no active session");
    }
    if (isEnded(currentFrontmatter(raw))) return; // keep the first `ended`
    await atomicWrite(abs, applyFrontmatterPatch(raw, { ended: localDateTime(now()) }));
  });
  return readParsedFile(campaign, rel);
}

/**
 * Append one log line to raw session text — APPEND-ONLY: existing lines are
 * never rewritten. The line goes to the end of the file (the Log section is
 * the last section by convention); if a `## Threads` section exists it goes
 * right before it instead. Only blank separator lines around the insertion
 * point are adjusted.
 */
function insertLogLine(raw: string, entry: string): string {
  const threads = /^## Threads[ \t]*\r?$/m.exec(raw);
  if (threads) {
    const idx = threads.index;
    const beforeTrimmed = raw.slice(0, idx).replace(/\n+$/, "");
    const rest = raw.slice(idx);
    return beforeTrimmed === "" ? `${entry}\n\n${rest}` : `${beforeTrimmed}\n${entry}\n\n${rest}`;
  }
  let base = raw;
  if (base.length > 0 && !base.endsWith("\n")) base += "\n";
  // Blank line between a heading (e.g. a fresh `## Log`) and the first entry.
  const lastLine = base.trimEnd().split("\n").pop() ?? "";
  const needBlank = lastLine.startsWith("#") && !base.endsWith("\n\n") && base !== "";
  return `${base}${needBlank ? "\n" : ""}${entry}\n`;
}

/**
 * POST /api/:campaign/log — append `- HH:MM (sceneId) text` to the RUNNING
 * session file (issue #40: that may be yesterday's file past midnight).
 * STRICTLY the running session: 404 when none runs, so a note typed after
 * "Session beenden" is refused instead of quietly landing in a closed log
 * (it used to fall back to today's file and answer 200). `text`/`sceneId`
 * arrive pre-normalized from the route.
 *
 * When a sceneId is given, `scenes_played` is maintained in the same write
 * (README: "automatisch gepflegt" — the app is the only writer of session
 * files): the id is appended iff not already present, so array order is
 * first-played order. Frontmatter update (raw-patch mechanism) and log-line
 * append happen under the same lock and land in ONE atomicWrite — no
 * interleaving write can slip between them. Calls without sceneId leave
 * `scenes_played` untouched.
 */
export async function appendLogEntry(
  campaign: string,
  text: string,
  sceneId?: string,
): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const rel = await findActiveSessionRel(campaign);
  if (rel === undefined) throw new ApiError(404, "no active session");
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      throw new ApiError(404, "no active session");
    }
    if (sceneId !== undefined) {
      const fm = currentFrontmatter(raw);
      const cur = fm.scenes_played;
      // Degrade path: a missing/null key becomes an empty list (the key is
      // then created), a scalar is treated as a one-element list.
      const played = Array.isArray(cur) ? cur : cur === undefined || cur === null ? [] : [cur];
      if (!played.some((v) => String(v) === sceneId)) {
        raw = applyFrontmatterPatch(raw, { scenes_played: [...played, sceneId] });
      }
    }
    const entry = `- ${localTime(now())}${sceneId ? ` (${sceneId})` : ""} ${text}`;
    await atomicWrite(abs, insertLogLine(raw, entry));
  });
  return readParsedFile(campaign, rel);
}

/**
 * POST /api/:campaign/inbox — append `- text` to the root inbox.md
 * (append-only idea intake, README). Created with a `# Inbox` heading when
 * missing. `text` arrives pre-normalized from the route.
 */
export async function appendInboxEntry(campaign: string, text: string): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const rel = "inbox.md";
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    let raw: string | null = null;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      // missing — create below
    }
    const line = `- ${text}\n`;
    const content =
      raw === null || raw === ""
        ? `# Inbox\n\n${line}`
        : `${raw}${raw.endsWith("\n") ? "" : "\n"}${line}`;
    await atomicWrite(abs, content);
  });
  return readParsedFile(campaign, rel);
}

// --- review actions (issue #10) --------------------------------------------------

/**
 * Short hash of one raw log line: first 8 hex chars of SHA-256 over the line
 * string exactly as sent. This is the `reviewed` entry format (README,
 * "Entität: Session") — hashing the raw line keeps `## Log` strictly
 * append-only and makes external reordering irrelevant.
 */
export function logLineShortHash(line: string): string {
  return createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);
}

/**
 * POST /api/:campaign/review/seen — add the short hash of `line` to the
 * session file's `reviewed` frontmatter list iff absent (raw-patch
 * mechanism, same degrade rules and guarantees as scenes_played: the body is
 * never touched). Idempotent. Only sessions/*.md files carry `reviewed`.
 */
export async function markLogLineSeen(
  campaign: string,
  rel: string,
  line: string,
): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  assertSafeRelativeMdPath(rel);
  const segments = rel.split("/");
  if (segments.length !== 2 || segments[0] !== "sessions") {
    throw new ApiError(400, "path must be a sessions/*.md file");
  }
  const abs = await resolveInsideCampaign(dir, rel); // 404 missing, 400 unsafe
  const hash = logLineShortHash(line);
  await withFileLock(abs, async () => {
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      throw new ApiError(404, "file not found");
    }
    const cur = currentFrontmatter(raw).reviewed;
    // Degrade path (same as scenes_played): missing/null key -> empty list
    // (the key is then created), a scalar -> one-element list.
    const reviewed = Array.isArray(cur) ? cur : cur === undefined || cur === null ? [] : [cur];
    if (reviewed.some((v) => String(v) === hash)) return; // already seen
    await atomicWrite(abs, applyFrontmatterPatch(raw, { reviewed: [...reviewed, hash] }));
  });
  return readParsedFile(campaign, rel);
}

/** A chapter id must be one non-hidden path segment (like a campaign id). */
function assertSafeChapterId(chapter: string): void {
  if (
    chapter.length === 0 ||
    chapter.startsWith(".") ||
    chapter.includes("/") ||
    chapter.includes("\\") ||
    chapter.includes("\0") ||
    chapter.includes("..")
  ) {
    throw new ApiError(400, "invalid chapter");
  }
}

/**
 * Append one item to the `## Offene Fäden` section of raw chapter text.
 * The item goes to the end of the section (right before the next heading, or
 * the end of the file when the section is last); a missing section is created
 * at the end of the file. Only blank separator lines around the insertion
 * point are adjusted — everything else stays byte-identical.
 */
function appendThreadItem(raw: string, item: string): string {
  const heading = /^## Offene Fäden[ \t]*\r?$/m.exec(raw);
  if (heading === null) {
    let base = raw;
    if (base.length > 0 && !base.endsWith("\n")) base += "\n";
    if (base.length > 0 && !base.endsWith("\n\n")) base += "\n";
    return `${base}## Offene Fäden\n\n${item}\n`;
  }
  const nlAfterHeading = raw.indexOf("\n", heading.index);
  const sectionStart = nlAfterHeading === -1 ? raw.length : nlAfterHeading + 1;
  const nextHeading = /^#{1,6}[ \t]/m.exec(raw.slice(sectionStart));
  const sectionEnd = nextHeading === null ? raw.length : sectionStart + nextHeading.index;
  const section = raw.slice(sectionStart, sectionEnd).replace(/\s+$/, "");
  const newSection = section === "" ? `\n${item}\n` : `${section}\n${item}\n`;
  const rest = raw.slice(sectionEnd);
  return raw.slice(0, sectionStart) + newSection + (rest === "" ? "" : `\n${rest}`);
}

/**
 * POST /api/:campaign/review/thread — append `- [ ] text` under
 * `## Offene Fäden` of `<chapter>/_chapter.md` (README, "Review-Aktionen").
 * The section is created when missing; a missing `_chapter.md` is created
 * with minimal frontmatter (degrade-friendly — the tree walker only needs
 * id/title). The chapter DIRECTORY must exist -> 404 otherwise.
 */
export async function appendThreadToChapter(
  campaign: string,
  chapter: string,
  text: string,
): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  assertSafeChapterId(chapter);
  if (RESERVED_DIRS.has(chapter)) throw new ApiError(404, "chapter not found");
  const chapterAbs = path.join(dir, chapter);
  let s;
  try {
    s = await stat(chapterAbs);
  } catch {
    throw new ApiError(404, "chapter not found");
  }
  if (!s.isDirectory()) throw new ApiError(404, "chapter not found");
  const rel = `${chapter}/_chapter.md`;
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    let raw: string | null = null;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      // missing — create with minimal frontmatter below
    }
    if (raw === null) {
      const yaml = dump(
        { id: chapter, title: chapter },
        { schema: CORE_SCHEMA, flowLevel: 1, lineWidth: -1 },
      );
      raw = `---\n${yaml}---\n`;
    }
    await atomicWrite(abs, appendThreadItem(raw, `- [ ] ${text}`));
  });
  return readParsedFile(campaign, rel);
}

/**
 * POST /api/:campaign/campaign-meta — create the campaign's `_campaign.md`
 * with `id` (always the DIRECTORY name, never client input), `name` and the
 * optional `description` (issue #34: the meta dialog must also work for a
 * campaign that has no metadata file yet).
 *
 * CREATE ONLY: an existing file is never touched -> 409 { path }. Editing an
 * existing one is PATCH /frontmatter's job, which carries the mtime check —
 * that contract stays untouched on purpose.
 */
export async function createCampaignMeta(
  campaign: string,
  name: string,
  description?: string,
): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const rel = CAMPAIGN_FILE;
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    let exists = true;
    try {
      await stat(abs);
    } catch {
      exists = false;
    }
    if (exists) {
      throw new ApiError(409, "campaign file already exists — not overwriting", { path: rel });
    }
    const yaml = dump(
      { id: campaign, name, ...(description === undefined ? {} : { description }) },
      { schema: CORE_SCHEMA, flowLevel: 1, lineWidth: -1 },
    );
    await atomicWrite(abs, `---\n${yaml}---\n`);
  });
  return readParsedFile(campaign, rel);
}

/** npc ids are kebab slugs — the README's stable reference keys. */
const NPC_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * POST /api/:campaign/review/npc-stub — create `npcs/<id>.md` with minimal
 * frontmatter (`status: unknown`) and the log text under `## Notizen`
 * (README, "Review-Aktionen"). An existing file is NEVER overwritten ->
 * 409 { error, path }.
 */
export async function createNpcStub(
  campaign: string,
  id: string,
  name?: string,
  note?: string,
): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  if (!NPC_SLUG.test(id)) {
    throw new ApiError(400, "id must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  const rel = `npcs/${id}.md`;
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    let exists = true;
    try {
      await stat(abs);
    } catch {
      exists = false;
    }
    if (exists) throw new ApiError(409, "npc already exists — not overwriting", { path: rel });
    await mkdir(path.dirname(abs), { recursive: true });
    const yaml = dump(
      { id, name: name ?? id, status: "alive" },
      { schema: CORE_SCHEMA, flowLevel: 1, lineWidth: -1 },
    );
    // `## Notizen` is the app-managed review section (README) — always
    // present in a stub so later review notes have their place.
    const body = note === undefined ? "\n## Notizen\n" : `\n## Notizen\n\n- ${note}\n`;
    await atomicWrite(abs, `---\n${yaml}---\n${body}`);
  });
  return readParsedFile(campaign, rel);
}

/**
 * POST /api/:campaign/review/inbox-done — rewrite the FIRST line of inbox.md
 * that exactly matches `line` from `- …` to `- [x] …`. This is the ONE
 * documented exception to the inbox's append-only rule (README) so done
 * ideas stop resurfacing in every review. Only the matching line changes —
 * every other byte of the file stays identical. Idempotent: a line that is
 * already `- [x] …` (matched directly, or as the done form of the sent
 * line) -> 200 without a write. Line not found -> 404.
 */
export async function markInboxLineDone(campaign: string, line: string): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const rel = "inbox.md";
  const abs = path.resolve(dir, rel);
  const doneForm = (l: string) =>
    l.startsWith("- [ ] ") ? `- [x] ${l.slice(6)}` : `- [x] ${l.slice(2)}`;
  await withFileLock(abs, async () => {
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      throw new ApiError(404, "line not found in inbox");
    }
    const lines = raw.split("\n"); // exact split/join keeps every other byte
    const idx = lines.indexOf(line);
    if (idx === -1) {
      // The done form already on disk means an earlier call succeeded.
      if (!line.startsWith("- [x]") && lines.includes(doneForm(line))) return;
      throw new ApiError(404, "line not found in inbox");
    }
    if (line.startsWith("- [x]")) return; // already done
    lines[idx] = doneForm(line);
    await atomicWrite(abs, lines.join("\n"));
  });
  return readParsedFile(campaign, rel);
}
