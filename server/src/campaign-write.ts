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

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { CORE_SCHEMA, dump } from "js-yaml";
import type { FileResponse } from "@grimoire/shared";
import { ApiError, campaignDir, readParsedFile, resolveInsideCampaign } from "./campaign-fs";
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
  return null; // unclosed block degrades to "no frontmatter", like the parser
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
 */
function applyFrontmatterPatch(raw: string, patch: Record<string, unknown>): string {
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

/** Campaign-relative path of today's session file (local date). */
function todaySessionRel(): string {
  return `sessions/${localDate(now())}.md`;
}

/**
 * POST /api/:campaign/session/start — create today's session file.
 * Idempotent: if the file already exists it is returned untouched.
 */
export async function startSession(campaign: string): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const d = now();
  const rel = `sessions/${localDate(d)}.md`;
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    try {
      if ((await stat(abs)).isFile()) return; // already started today
    } catch {
      // does not exist yet — create below
    }
    await mkdir(path.dirname(abs), { recursive: true });
    const content = `---\nid: ${localDate(d)}\nstarted: ${localDateTime(d)}\nscenes_played: []\n---\n\n## Log\n`;
    await atomicWrite(abs, content);
  });
  return readParsedFile(campaign, rel);
}

/**
 * POST /api/:campaign/session/end — set `ended` in today's session file via
 * the raw-patch mechanism. Idempotent: an existing `ended` is kept.
 */
export async function endSession(campaign: string): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const rel = todaySessionRel();
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      throw new ApiError(404, "no session today");
    }
    const fm = currentFrontmatter(raw);
    if (fm.ended !== undefined && fm.ended !== null) return; // keep the first `ended`
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
 * POST /api/:campaign/log — append `- HH:MM (sceneId) text` to today's
 * session file. 404 when no session was started today (the UI tells the DM
 * to start one). `text`/`sceneId` arrive pre-normalized from the route.
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
  const rel = todaySessionRel();
  const abs = path.resolve(dir, rel);
  await withFileLock(abs, async () => {
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      throw new ApiError(404, "no session today");
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
