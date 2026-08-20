// Rename one entity id and drag every REFERENCE along (issue #30; origin:
// the #29 discussion, filed as DECISIONS #11 — the acute pain of file-based
// storage is the id rename, and it is cheap to solve on files).
//
// What a reference IS (README is the contract — this module never invents a
// reference site):
//
//   npc      npcs/<id>.md            scene frontmatter `npcs: [...]`
//                                    `## Beziehungen` lines `- <id>: <text>`
//                                    in every npc file
//   location locations/<id>.md       scene frontmatter `location: <id>`
//   scene    <chapter>/…/<id>.md     session frontmatter `scenes_played: [...]`
//                                    session log markers `- HH:MM (<id>) …`
//   chapter  <chapter>/ (DIRECTORY)  `_chapter.md` frontmatter id, plus the
//                                    `chapter: <id>` field of every scene,
//                                    npc and location that names it
//
// What is deliberately NOT touched: free prose. A scene body that mentions
// `smuggler-captured` in a `[!note]`, a log line's text, a glossary entry —
// those are text, not references (issue #30 AK, "Prosa-Erwähnungen bewusst
// NICHT"). Same for `inbox.md` and `glossary.md`: they carry no reference
// fields by contract, so they are not even scanned.
//
// Mechanics — everything here is TOKEN-LEVEL, because AK5 asks for a cascade
// that is byte-exact ("nur Referenzstellen ändern sich"):
//
//   * FRONTMATTER references are rewritten inside their own line: the value of
//     a scalar key (`location: leuchtturm`), the matching member of a flow
//     sequence (`npcs: [jorna, fenn]`) or of a block sequence (`- jorna`).
//     Only the id token changes — quoting, spacing, comments and every other
//     key stay verbatim. A shape this does not recognize falls back to the
//     write layer's raw-patch mechanism (campaign-write.ts), which re-emits
//     the YAML block and may normalize ITS formatting (documented there);
//     the body stays byte-identical either way.
//   * BODY references (`## Beziehungen` entries, log markers) are line-level
//     and anchored the same way: indent, spacing, text and hashtags verbatim.
//   * Every write is an atomicWrite under the per-file lock.
//
// PLAN, then EXECUTE. The whole cascade is computed in memory first: entity
// lookup, collision check, and the new content of every affected file. A
// failure during that phase (unknown id, collision, unreadable file, broken
// YAML) answers 400/404/409 and writes NOTHING — that is the "all or
// nothing" of AK2, and it is also what `dryRun` returns as the UI's preview.
//
// True cross-file rollback after a mid-write crash is NOT available on a
// plain filesystem (no transaction, and a rename is not undoable once other
// files moved on). So the write ORDER is chosen instead:
//
//   1. all content rewrites (reference sites first, the renamed file's own
//      `id` among them) — every one of them at its CURRENT path,
//   2. the rename of the file (or, for a chapter, of the directory) LAST.
//
// Crash behaviour of that order: the referencing files already name the new
// id while the entity still sits at its old path. Nothing points at a file
// that is GONE — the entity is always on disk, under one name or the other —
// and re-running the rename after the crash is not needed for the references,
// only for the file itself (which the DM sees in the tree). The reverse order
// (rename first) would leave real dangling references, which is why it is not
// used.

import { readdir, readFile, rename as renamePath, stat } from "node:fs/promises";
import path from "node:path";
import { parseMarkdown, type ParsedFile } from "@grimoire/shared";
import { ApiError, campaignDir, collectCampaignFiles, RESERVED_DIRS } from "./campaign-fs";
import { applyFrontmatterPatch, atomicWrite, withFileLock } from "./campaign-write";
import { invalidateCampaign } from "./search-index";

/** The entity kinds that have a rename cascade (sessions have no id to rename). */
export const RENAME_KINDS = ["npc", "location", "scene", "chapter"] as const;

export type RenameKind = (typeof RENAME_KINDS)[number];

export function isRenameKind(value: unknown): value is RenameKind {
  return typeof value === "string" && (RENAME_KINDS as readonly string[]).includes(value);
}

/**
 * The answer of POST /:campaign/rename — and, with `dryRun`, the preview the
 * dialog shows before it commits.
 *
 * `renamed` is the moved file (or, for a chapter, the moved DIRECTORY) in
 * campaign-relative paths. `changed` lists every file whose BYTES change,
 * named by its path AFTER the rename (so a scene inside a renamed chapter
 * appears under the new chapter directory) — sorted, and including the
 * renamed entity's own file, because its `id` is part of the cascade.
 */
export interface RenameResult {
  renamed: { from: string; to: string };
  changed: string[];
  dryRun?: true;
}

// --- id validation --------------------------------------------------------------

/** Entity ids are kebab slugs — the README's stable reference keys. Chapter
 * ids use the same rule; their number prefix (`01-salzhafen`) is already a
 * legal slug segment, so no separate pattern is needed. */
const ID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Lexical segment safety — the same rules the fs layer applies to a path
 * segment. Applied to `oldId` too: for a chapter it IS a directory name. */
function assertSafeIdSegment(id: string, label: string): void {
  if (
    id.length === 0 ||
    id.startsWith(".") ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    id.includes("..")
  ) {
    throw new ApiError(400, `invalid ${label}`);
  }
}

function assertNewId(newId: string): void {
  assertSafeIdSegment(newId, "newId");
  if (!ID_SLUG.test(newId)) {
    throw new ApiError(400, "newId must be a kebab-case slug (a-z, 0-9, single dashes)");
  }
  // npcs/locations/sessions are the reserved directories of a campaign; a
  // chapter named like one would be invisible to the tree walker, and for the
  // other kinds such an id is never a good one either.
  if (RESERVED_DIRS.has(newId)) throw new ApiError(400, `newId is a reserved name: ${newId}`);
}

// --- loading ---------------------------------------------------------------------

/** One candidate file: its raw bytes plus the parsed (degrade-safe) view. */
interface Loaded {
  rel: string;
  abs: string;
  raw: string;
  parsed: ParsedFile;
}

/** Lexicographic compare — stable, locale-independent (as in campaign-fs). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Read the raw bytes of the already-parsed files. A file that vanished
 * between the scan and the read is skipped (degrade — it cannot be a
 * reference site any more).
 */
async function loadRaw(campaignAbs: string, parsedFiles: ParsedFile[]): Promise<Loaded[]> {
  const out: Loaded[] = [];
  for (const parsed of parsedFiles) {
    const abs = path.resolve(campaignAbs, parsed.path);
    try {
      out.push({ rel: parsed.path, abs, raw: await readFile(abs, "utf8"), parsed });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => cmp(a.rel, b.rel));
}

/**
 * The campaign's session files (`sessions/*.md`). collectCampaignFiles does
 * not cover them (they are not indexed), but they hold two reference sites:
 * `scenes_played` and the log markers.
 */
async function loadSessions(campaignAbs: string): Promise<Loaded[]> {
  const dirAbs = path.join(campaignAbs, "sessions");
  let entries;
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    return []; // no sessions yet — nothing to patch
  }
  const out: Loaded[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") || !e.name.endsWith(".md")) continue;
    const abs = path.join(dirAbs, e.name);
    let s;
    try {
      s = await stat(abs);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;
    const rel = `sessions/${e.name}`;
    const raw = await readFile(abs, "utf8");
    out.push({ rel, abs, raw, parsed: parseMarkdown(raw, rel, s.mtimeMs) });
  }
  return out.sort((a, b) => cmp(a.rel, b.rel));
}

// --- reference rewriting ---------------------------------------------------------

/** Regex-escape an id so it can sit inside an anchored pattern. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The new value of a frontmatter reference field, or undefined when the field
 * does not name `oldId` at all. Degrade-safe like the summary builders: a
 * list is mapped member-wise (order and other members untouched), a scalar is
 * compared as a string, a mapping is left alone.
 */
function replacedRef(value: unknown, oldId: string, newId: string): unknown {
  const names = (v: unknown) => v !== null && v !== undefined && String(v) === oldId;
  if (Array.isArray(value)) {
    return value.some(names) ? value.map((v) => (names(v) ? newId : v)) : undefined;
  }
  if (value === null || value === undefined || typeof value === "object") return undefined;
  return names(value) ? newId : undefined;
}

// --- frontmatter references, token-level -----------------------------------------

/**
 * Byte offsets of the YAML frontmatter block's TEXT (between the two `---`
 * delimiter lines), or null when the file has no closed block. Same rules as
 * the write layer's splitter — an unclosed block degrades to "no frontmatter".
 */
function frontmatterRange(raw: string): { start: number; end: number } | null {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return null;
  const firstNl = raw.indexOf("\n");
  let pos = firstNl + 1;
  while (pos <= raw.length) {
    const nl = raw.indexOf("\n", pos);
    const lineEnd = nl === -1 ? raw.length : nl;
    let line = raw.slice(pos, lineEnd);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "---") return { start: firstNl + 1, end: pos };
    if (nl === -1) break;
    pos = nl + 1;
  }
  return null;
}

/** Trailing part of a YAML line that must survive verbatim: spaces, comment, CR. */
const TAIL = "[ \\t]*(?:#.*)?\\r?";

/** One flow-sequence member (`[a, "b" , c]`) split into quotes and value. */
const FLOW_MEMBER = /^([ \t]*)(['"]?)(.*?)\2([ \t]*)$/;

/** Replace `oldId` inside a `[a, b]` flow sequence, keeping quotes/spacing. */
function patchFlowMembers(inner: string, oldId: string, newId: string): string | null {
  let hit = false;
  const parts = inner.split(",").map((part) => {
    const m = FLOW_MEMBER.exec(part);
    if (m === null || m[3] !== oldId) return part;
    hit = true;
    return `${m[1]}${m[2]}${newId}${m[2]}${m[4]}`;
  });
  return hit ? parts.join(",") : null;
}

/**
 * Rewrite the id token in the frontmatter value of `key`, in place. Handles
 * the three shapes the format uses:
 *
 *   key: <id>              scalar (quoted or not)
 *   key: [<id>, other]     flow sequence
 *   key:                   block sequence
 *     - <id>
 *
 * Returns the patched text, "no-key" when the file's frontmatter has no such
 * top-level key at all, or "unsupported" when the key is there but no token
 * matched (an exotic YAML shape) — the caller then decides.
 */
type TokenPatch = { done: true; raw: string } | { done: false; reason: "no-key" | "unsupported" };

function patchFrontmatterToken(
  raw: string,
  key: string,
  oldId: string,
  newId: string,
): TokenPatch {
  const range = frontmatterRange(raw);
  if (range === null) return { done: false, reason: "no-key" };
  const lines = raw.slice(range.start, range.end).split("\n");
  const keyLine = new RegExp(`^${escapeRe(key)}:`);
  const at = lines.findIndex((line) => keyLine.test(line));
  if (at === -1) return { done: false, reason: "no-key" };

  const line = lines[at]!;
  const id = escapeRe(oldId);
  const k = escapeRe(key);
  const scalar = new RegExp(`^(${k}:[ \\t]*)(['"]?)${id}\\2(${TAIL})$`);
  const flow = new RegExp(`^(${k}:[ \\t]*\\[)(.*)(\\]${TAIL})$`);
  const empty = new RegExp(`^${k}:(${TAIL})$`);

  const commit = (): TokenPatch => ({
    done: true,
    raw: raw.slice(0, range.start) + lines.join("\n") + raw.slice(range.end),
  });

  const asScalar = scalar.exec(line);
  if (asScalar !== null) {
    lines[at] = `${asScalar[1]}${asScalar[2]}${newId}${asScalar[2]}${asScalar[3]}`;
    return commit();
  }
  const asFlow = flow.exec(line);
  if (asFlow !== null) {
    const inner = patchFlowMembers(asFlow[2]!, oldId, newId);
    if (inner === null) return { done: false, reason: "unsupported" };
    lines[at] = `${asFlow[1]}${inner}${asFlow[3]}`;
    return commit();
  }
  if (empty.test(line)) {
    // Block sequence: the indented `- <id>` items that follow, up to the next
    // top-level key.
    const item = new RegExp(`^([ \\t]*-[ \\t]+)(['"]?)${id}\\2(${TAIL})$`);
    let hit = false;
    for (let i = at + 1; i < lines.length; i++) {
      const current = lines[i]!;
      // Sequence items may sit at zero indent; anything else at zero indent
      // is the next key.
      if (current.trim() !== "" && !/^[ \t]/.test(current) && !/^-[ \t]/.test(current)) break;
      const m = item.exec(current);
      if (m !== null) {
        lines[i] = `${m[1]}${m[2]}${newId}${m[2]}${m[3]}`;
        hit = true;
      }
    }
    if (hit) return commit();
  }
  return { done: false, reason: "unsupported" };
}

/**
 * Rewrite one frontmatter reference: token-level when the YAML shape allows
 * it (byte-exact), otherwise through the write layer's raw-patch mechanism
 * with `value` as the new value (the YAML block is re-emitted then — the body
 * still stays byte-identical).
 */
function patchRef(
  raw: string,
  key: string,
  oldId: string,
  newId: string,
  value: unknown,
): string {
  const patched = patchFrontmatterToken(raw, key, oldId, newId);
  return patched.done ? patched.raw : applyFrontmatterPatch(raw, { [key]: value });
}

/**
 * The renamed entity's own `id`. A file whose id is only the FILE NAME
 * (no `id:` key — the parser's fallback) needs no write at all: the rename
 * itself gives it the new id.
 */
function patchOwnId(raw: string, oldId: string, newId: string): string {
  const patched = patchFrontmatterToken(raw, "id", oldId, newId);
  if (patched.done) return patched.raw;
  if (patched.reason === "no-key") return raw;
  // An `id:` key that does not read as `oldId` (a chapter whose _chapter.md
  // carries a different id than its directory, an exotic YAML shape): set it.
  return applyFrontmatterPatch(raw, { id: newId });
}

// --- body references, line-level ---------------------------------------------------

/** True for a markdown ATX heading line. */
const HEADING = /^#{1,6}[ \t]/;

/**
 * Rewrite `- <oldId>:` list entries inside `## Beziehungen` (README: the
 * relationship list of an npc file is `- <npc-id>: <Freitext>`).
 *
 * Only the id token changes: indent, dash spacing, the colon and the whole
 * free text stay byte-identical. Restricted to the `## Beziehungen` section
 * on purpose — a `- jorna: …` line under `## Notizen` is prose, not a
 * reference, and prose is never touched.
 */
function patchRelationshipLines(raw: string, oldId: string, newId: string): string {
  const line = new RegExp(`^(\\s*-\\s+)${escapeRe(oldId)}(\\s*:)`);
  const heading = /^##[ \t]+Beziehungen[ \t]*\r?$/;
  const lines = raw.split("\n");
  let inSection = false;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]!;
    if (HEADING.test(current)) {
      inSection = heading.test(current);
      continue;
    }
    if (!inSection) continue;
    const next = current.replace(line, `$1${newId}$2`);
    if (next !== current) {
      lines[i] = next;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : raw;
}

/**
 * Rewrite the scene marker of session log lines: `- HH:MM (<oldId>) Text`
 * (README format). Anchored on the timestamp, so only a real log marker
 * matches — the text after it (including hashtags) stays byte-identical, and
 * `## Threads` checkboxes cannot match at all.
 */
function patchLogMarkers(raw: string, oldId: string, newId: string): string {
  const line = new RegExp(`^(\\s*-\\s+\\d{1,2}:\\d{2}\\s+\\()${escapeRe(oldId)}(\\))`);
  const lines = raw.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]!;
    const next = current.replace(line, `$1${newId}$2`);
    if (next !== current) {
      lines[i] = next;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : raw;
}

// --- the plan --------------------------------------------------------------------

/** One planned content rewrite. */
interface PlannedWrite {
  /** Where it is written: the file's CURRENT path (writes happen before the rename). */
  abs: string;
  /** How it is reported: the file's path AFTER the rename. */
  reportRel: string;
  content: string;
}

interface RenamePlan {
  fromRel: string;
  toRel: string;
  fromAbs: string;
  toAbs: string;
  writes: PlannedWrite[];
}

/** Working set of content rewrites, keyed by absolute path so a file that is
 * touched twice (a session with both `scenes_played` and a log marker) is
 * transformed once, in sequence. */
type Edits = Map<string, { abs: string; reportRel: string; original: string; content: string }>;

function edit(edits: Edits, file: Loaded, reportRel: string, fn: (raw: string) => string): void {
  const entry =
    edits.get(file.abs) ??
    { abs: file.abs, reportRel, original: file.raw, content: file.raw };
  entry.content = fn(entry.content);
  edits.set(file.abs, entry);
}

/** The frontmatter id of a parsed file (the parser falls it back to the file stem). */
function idOf(parsed: ParsedFile): string {
  const id = parsed.frontmatter.id;
  return typeof id === "string" ? id : String(id ?? "");
}

/** The one file that carries this id, or 404/409. */
function findEntity(files: Loaded[], kind: "npc" | "location" | "scene", oldId: string): Loaded {
  const hits = files.filter((f) => f.parsed.kind === kind && idOf(f.parsed) === oldId);
  if (hits.length === 0) throw new ApiError(404, `${kind} "${oldId}" not found`);
  if (hits.length > 1) {
    // Two files claiming one id is a data bug; renaming "one of them" would
    // rewrite references that could mean either file. Refuse instead.
    throw new ApiError(409, `ambiguous ${kind} id — ${hits.length} files claim it`, {
      paths: hits.map((f) => f.rel),
    });
  }
  return hits[0]!;
}

/** 409 when the rename target already exists (as a file OR a directory). */
async function assertFree(toAbs: string, toRel: string): Promise<void> {
  try {
    await stat(toAbs);
  } catch {
    return; // free
  }
  throw new ApiError(409, "target already exists — not overwriting", { path: toRel });
}

async function planRename(
  campaign: string,
  campaignAbs: string,
  kind: RenameKind,
  oldId: string,
  newId: string,
): Promise<RenamePlan> {
  const files = await loadRaw(campaignAbs, await collectCampaignFiles(campaign));
  const sessions = kind === "scene" ? await loadSessions(campaignAbs) : [];

  // The renamed entity's own file (undefined only for a chapter without a
  // `_chapter.md` — a chapter is a directory, the file is optional) and the
  // move itself.
  let entity: Loaded | undefined;
  let fromRel: string;
  let toRel: string;
  if (kind === "chapter") {
    // oldId is a path segment here — its lexical safety was asserted by the
    // caller before anything touched the filesystem.
    if (RESERVED_DIRS.has(oldId)) throw new ApiError(404, `chapter "${oldId}" not found`);
    let s;
    try {
      s = await stat(path.join(campaignAbs, oldId));
    } catch {
      throw new ApiError(404, `chapter "${oldId}" not found`);
    }
    if (!s.isDirectory()) throw new ApiError(404, `chapter "${oldId}" not found`);
    entity = files.find((f) => f.rel === `${oldId}/_chapter.md`);
    fromRel = oldId;
    toRel = newId;
  } else {
    entity = findEntity(files, kind, oldId);
    const dirRel = entity.rel.slice(0, entity.rel.lastIndexOf("/")); // npcs | locations | <chapter>[/<slug>]
    fromRel = entity.rel;
    toRel = `${dirRel}/${newId}.md`;
  }

  const fromAbs = path.resolve(campaignAbs, fromRel);
  const toAbs = path.resolve(campaignAbs, toRel);
  await assertFree(toAbs, toRel);

  // Report every file under its FINAL path: the renamed file itself, and —
  // for a chapter — everything inside the renamed directory.
  const finalRel = (rel: string): string =>
    rel === fromRel
      ? toRel
      : kind === "chapter" && rel.startsWith(`${fromRel}/`)
        ? `${toRel}${rel.slice(fromRel.length)}`
        : rel;

  const edits: Edits = new Map();

  // 1. the entity's own id. Patched unconditionally (an id-less file gets the
  //    key — the format wants it, and it is the same value the file name
  //    would degrade to anyway). A chapter without `_chapter.md` has nothing
  //    to patch; the tree then takes the id from the directory name.
  if (entity !== undefined) {
    edit(edits, entity, finalRel(entity.rel), (raw) => patchOwnId(raw, oldId, newId));
  }

  // 2. the reference sites of this kind.
  for (const f of files) {
    const fm = f.parsed.frontmatter;
    if (kind === "npc") {
      if (f.parsed.kind === "scene") {
        const npcs = replacedRef(fm.npcs, oldId, newId);
        if (npcs !== undefined) {
          edit(edits, f, finalRel(f.rel), (raw) => patchRef(raw, "npcs", oldId, newId, npcs));
        }
      }
      if (f.parsed.kind === "npc") {
        edit(edits, f, finalRel(f.rel), (raw) => patchRelationshipLines(raw, oldId, newId));
      }
    } else if (kind === "location") {
      if (f.parsed.kind === "scene") {
        const location = replacedRef(fm.location, oldId, newId);
        if (location !== undefined) {
          edit(edits, f, finalRel(f.rel), (raw) =>
            patchRef(raw, "location", oldId, newId, location),
          );
        }
      }
    } else if (kind === "chapter") {
      // `chapter` names the chapter id in scene, npc and location files alike
      // (README) — all three are patched.
      const chapter = replacedRef(fm.chapter, oldId, newId);
      if (chapter !== undefined) {
        edit(edits, f, finalRel(f.rel), (raw) => patchRef(raw, "chapter", oldId, newId, chapter));
      }
    }
  }
  for (const f of sessions) {
    const played = replacedRef(f.parsed.frontmatter.scenes_played, oldId, newId);
    if (played !== undefined) {
      edit(edits, f, f.rel, (raw) => patchRef(raw, "scenes_played", oldId, newId, played));
    }
    edit(edits, f, f.rel, (raw) => patchLogMarkers(raw, oldId, newId));
  }

  // Only real byte changes are writes — a transform that matched nothing
  // leaves the content identical and must not touch the file's mtime.
  const writes = [...edits.values()]
    .filter((e) => e.content !== e.original)
    .map(({ abs, reportRel, content }) => ({ abs, reportRel, content }))
    .sort((a, b) => cmp(a.reportRel, b.reportRel));

  return { fromRel, toRel, fromAbs, toAbs, writes };
}

// --- the endpoint operation --------------------------------------------------------

/**
 * POST /api/:campaign/rename — rename one entity id and patch every
 * reference (see the module header for the reference contract, the plan/
 * execute split and the write order).
 *
 * `dryRun` computes and validates the whole cascade and answers with the
 * plan without writing a byte — that is the UI's "betrifft N Dateien"
 * preview, and it is the same code path as the real thing, so a preview that
 * succeeds is a rename that will succeed.
 */
export async function renameEntity(
  campaign: string,
  kind: RenameKind,
  oldId: string,
  newId: string,
  dryRun = false,
): Promise<RenameResult> {
  if (!isRenameKind(kind)) throw new ApiError(400, `unknown kind: ${String(kind)}`);
  assertSafeIdSegment(oldId, "oldId");
  // "Rename to the same id" is a no-op request, not a rename: answering 200
  // would make the UI navigate to a "new" path and claim work that never
  // happened.
  if (oldId === newId) throw new ApiError(400, "newId equals oldId — nothing to rename");
  assertNewId(newId);

  const campaignAbs = await campaignDir(campaign);
  const plan = await planRename(campaign, campaignAbs, kind, oldId, newId);
  const result: RenameResult = {
    renamed: { from: plan.fromRel, to: plan.toRel },
    changed: plan.writes.map((w) => w.reportRel),
  };
  if (dryRun) return { ...result, dryRun: true };

  // EXECUTE — content first, the rename last (see the module header).
  for (const w of plan.writes) {
    await withFileLock(w.abs, () => atomicWrite(w.abs, w.content));
  }
  // Only the source is locked: the target was verified free, and taking two
  // locks at once is how deadlocks are built.
  await withFileLock(plan.fromAbs, () => renamePath(plan.fromAbs, plan.toAbs));

  // Paths and ids moved — the search index and the app's queries are stale.
  invalidateCampaign(campaign);
  return result;
}
