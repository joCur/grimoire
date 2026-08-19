// Filesystem access layer for the read API.
//
// Everything here works on campaign-relative paths (forward slashes, as in
// ParsedFile.path) and enforces the two non-negotiables:
//
//   1. No path may escape CAMPAIGN_ROOT — lexical checks first (`..`,
//      absolute paths, backslashes, hidden segments), then a realpath check
//      so symlinks cannot escape either. Violations throw ApiError(400).
//   2. Only Node APIs (node:fs/promises, node:path) — no Bun-only runtime
//      APIs (DECISIONS #5/#7).

import type { Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  locationSummary,
  npcSummary,
  parseMarkdown,
  sceneSummary,
  sessionSummary,
  type CampaignSummary,
  type CampaignTree,
  type ChapterNode,
  type FileResponse,
  type NpcSummary,
  type LocationSummary,
  type SceneGroup,
  type SessionSummary,
} from "@grimoire/shared";
import { getCampaignRoot } from "./config";

/**
 * Error with an HTTP status; route handlers map it to a JSON error body.
 * `extra` is merged into the body next to `error` (e.g. the current mtimeMs
 * on a 409 conflict).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Directories under a campaign that are NOT chapters. */
const RESERVED_DIRS = new Set(["npcs", "locations", "sessions"]);

// --- path safety -------------------------------------------------------------

/** Lexicographic (code-unit) compare for stable, locale-independent sorting. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

/**
 * A campaign id must be a single, non-hidden path segment. Rejects `..`,
 * separators, backslashes, and anything else that could steer the lookup
 * outside CAMPAIGN_ROOT. (Hono decodes the URL param, so encoded traversal
 * like %2e%2e arrives here as the literal characters and is caught too.)
 */
export function assertSafeCampaignId(id: string): void {
  if (
    id.length === 0 ||
    isHidden(id) ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    id === ".." ||
    id.includes("..")
  ) {
    throw new ApiError(400, "invalid campaign id");
  }
}

/**
 * Lexical validation of a campaign-relative markdown path. Rejects absolute
 * paths (POSIX and Windows-style), backslashes, `..`/`.` segments, hidden
 * segments, and non-.md targets. Encoded traversal is already decoded by the
 * time the query value gets here, so it hits the same checks.
 */
export function assertSafeRelativeMdPath(rel: string): void {
  if (rel.length === 0) throw new ApiError(400, "missing path");
  if (rel.includes("\\") || rel.includes("\0")) throw new ApiError(400, "invalid path");
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) {
    throw new ApiError(400, "absolute paths are not allowed");
  }
  const segments = rel.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") throw new ApiError(400, "invalid path");
    if (isHidden(seg)) throw new ApiError(400, "invalid path");
  }
  if (!rel.endsWith(".md")) throw new ApiError(400, "only .md files are served");
}

/** Absolute directory of a campaign; 404 if it does not exist. */
export async function campaignDir(campaign: string): Promise<string> {
  assertSafeCampaignId(campaign);
  const dir = path.join(getCampaignRoot(), campaign);
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) throw new ApiError(404, "campaign not found");
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(404, "campaign not found");
  }
  return dir;
}

/**
 * Resolve a campaign-relative file path to an absolute path and verify that
 * its REAL path (symlinks resolved) still lives inside the campaign root.
 * Missing file -> 404, escape attempt -> 400.
 */
export async function resolveInsideCampaign(dir: string, rel: string): Promise<string> {
  assertSafeRelativeMdPath(rel);
  const abs = path.resolve(dir, rel);
  const rootReal = await realpath(getCampaignRoot());
  let fileReal: string;
  try {
    fileReal = await realpath(abs);
  } catch {
    throw new ApiError(404, "file not found");
  }
  if (fileReal !== rootReal && !fileReal.startsWith(rootReal + path.sep)) {
    throw new ApiError(400, "path escapes campaign root");
  }
  return abs;
}

// --- reading -------------------------------------------------------------------

/** List directories directly under CAMPAIGN_ROOT (hidden and files skipped). */
export async function listCampaigns(): Promise<CampaignSummary[]> {
  let entries;
  try {
    entries = await readdir(getCampaignRoot(), { withFileTypes: true });
  } catch {
    return []; // missing root degrades to an empty list
  }
  const ids: string[] = [];
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    if (e.isDirectory()) {
      ids.push(e.name);
    } else if (e.isSymbolicLink()) {
      try {
        if ((await stat(path.join(getCampaignRoot(), e.name))).isDirectory()) ids.push(e.name);
      } catch {
        // dangling symlink — skip
      }
    }
  }
  return ids.sort(cmp).map((id) => ({ id }));
}

/** Read + parse one markdown file; mtimeMs is the file's real mtime. */
export async function readParsedFile(campaign: string, rel: string): Promise<FileResponse> {
  const dir = await campaignDir(campaign);
  const abs = await resolveInsideCampaign(dir, rel);
  let s;
  try {
    s = await stat(abs);
  } catch {
    throw new ApiError(404, "file not found");
  }
  if (!s.isFile()) throw new ApiError(404, "file not found");
  const raw = await readFile(abs, "utf8");
  const parsed = parseMarkdown(raw, rel, s.mtimeMs);
  return { ...parsed, raw };
}

// --- tree walker ---------------------------------------------------------------

/** Non-hidden `.md` files directly inside `dir`, parsed. Never throws. */
async function parseMdFilesIn(
  dir: string,
  relDir: string,
): Promise<Array<ReturnType<typeof parseMarkdown>>> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries.sort((a, b) => cmp(a.name, b.name))) {
    if (isHidden(e.name) || !e.name.endsWith(".md")) continue;
    const abs = path.join(dir, e.name);
    let s;
    try {
      s = await stat(abs); // follows symlinks; directories fall through
    } catch {
      continue;
    }
    if (!s.isFile()) continue;
    const rel = relDir === "" ? e.name : `${relDir}/${e.name}`;
    out.push(parseMarkdown(await readFile(abs, "utf8"), rel, s.mtimeMs));
  }
  return out;
}

/**
 * Walk one chapter directory per the README layout:
 *
 *   <chapter>/_chapter.md          -> chapter title/status (fallback: dir name)
 *   <chapter>/<scene>.md           -> SceneGroup slug ""
 *   <chapter>/<slug>/<scene>.md    -> SceneGroup slug "<slug>"
 *   anything deeper                -> silently ignored (README: max 2 levels)
 *
 * Groups without scenes are omitted; groups sort by slug, scenes by path.
 */
async function walkChapter(campaignAbs: string, chapterId: string): Promise<ChapterNode> {
  const chapterAbs = path.join(campaignAbs, chapterId);
  const node: ChapterNode = { id: chapterId, title: chapterId, groups: [] };

  const direct = await parseMdFilesIn(chapterAbs, chapterId);
  const directScenes = [];
  for (const f of direct) {
    if (f.kind === "chapter") {
      // _chapter.md — title/status come from its frontmatter.
      node.title = typeof f.frontmatter.title === "string" ? f.frontmatter.title : chapterId;
      if (typeof f.frontmatter.status === "string") node.status = f.frontmatter.status;
      node.path = f.path;
    } else if (f.kind === "scene") {
      directScenes.push(sceneSummary(f));
    }
  }
  if (directScenes.length > 0) node.groups.push({ slug: "", scenes: directScenes });

  let entries: Dirent[];
  try {
    entries = await readdir(chapterAbs, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const groups: SceneGroup[] = [];
  for (const e of entries) {
    if (isHidden(e.name) || !e.isDirectory()) continue;
    const scenes = (await parseMdFilesIn(path.join(chapterAbs, e.name), `${chapterId}/${e.name}`))
      .filter((f) => f.kind === "scene")
      .map(sceneSummary)
      .sort((a, b) => cmp(a.path, b.path));
    if (scenes.length > 0) groups.push({ slug: e.name, scenes });
  }
  node.groups.push(...groups);
  node.groups.sort((a, b) => cmp(a.slug, b.slug));
  return node;
}

/**
 * Build the full campaign tree. Chapter detection: every non-hidden,
 * non-reserved directory directly under the campaign is a chapter (this is
 * the scene-layout convention; `_chapter.md` is optional and only supplies
 * title/status). npcs/locations/sessions come from their reserved dirs.
 */
export async function buildTree(campaign: string): Promise<CampaignTree> {
  const dir = await campaignDir(campaign);

  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const chapterIds: string[] = [];
  for (const e of entries) {
    if (isHidden(e.name) || !e.isDirectory()) continue;
    if (RESERVED_DIRS.has(e.name)) continue;
    chapterIds.push(e.name);
  }
  chapterIds.sort(cmp);

  const chapters = await Promise.all(chapterIds.map((id) => walkChapter(dir, id)));

  const npcs: NpcSummary[] = (await parseMdFilesIn(path.join(dir, "npcs"), "npcs"))
    .map(npcSummary)
    .sort((a, b) => cmp(a.name, b.name));
  const locations: LocationSummary[] = (
    await parseMdFilesIn(path.join(dir, "locations"), "locations")
  )
    .map(locationSummary)
    .sort((a, b) => cmp(a.name, b.name));
  const sessions: SessionSummary[] = (await parseMdFilesIn(path.join(dir, "sessions"), "sessions"))
    .map(sessionSummary)
    .sort((a, b) => cmp(b.id, a.id)); // newest first

  return { campaign, chapters, npcs, locations, sessions };
}
