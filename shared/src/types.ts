// Entity types for the Grimoire markdown data format.
// This is the code mirror of the format contract in /README.md — keep both
// in sync; changes here need a matching README edit (and vice versa).
//
// Design rule (README): the format DEGRADES, it does not validate. Every
// enum-ish field is typed as its known literals *or* any string, unknown
// frontmatter keys are preserved, and nothing in shared/ ever throws on
// odd input.

/** Known scene lifecycle states; files may contain other values (degrade). */
export const SCENE_STATUSES = ["draft", "ready", "played", "dropped"] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

export const SCENE_TYPES = ["planned", "contingency"] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const NPC_STATUSES = ["alive", "dead", "missing", "unknown"] as const;
export type NpcStatus = (typeof NPC_STATUSES)[number];

/** The six callout kinds the renderer knows. Unknown kinds render as plain text. */
export const CALLOUT_KINDS = [
  "readaloud",
  "check",
  "secret",
  "outcome",
  "loot",
  "note",
] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** Widens a literal union to string while keeping literal autocomplete. */
type OrString<T extends string> = T | (string & {});

/** `id` is the stable reference key and must never change once assigned. */
export interface SceneFrontmatter {
  id: string;
  title: string;
  type?: OrString<SceneType>;
  /** Only meaningful for `type: contingency` — free-text firing condition. */
  trigger?: string;
  chapter?: string;
  /** A location id from locations/ OR a free string. */
  location?: string;
  /** Npc ids from npcs/. */
  npcs?: string[];
  /** Roll20 handout names — references only, never copies. */
  handouts?: string[];
  tags?: string[];
  status?: OrString<SceneStatus>;
  [key: string]: unknown;
}

export interface NpcFrontmatter {
  id: string;
  name: string;
  /** One-liner. */
  role?: string;
  /** Chapter the NPC is introduced in. */
  chapter?: string;
  status?: OrString<NpcStatus>;
  /** Reference to the Roll20 sheet ("Roll20: <name>") — never a copy. */
  statblock?: string;
  /** Free-form social stats, e.g. { wis: "+2", insight: "+2" }. */
  quickstats?: Record<string, string | number>;
  voice?: string;
  appearance?: string;
  [key: string]: unknown;
}

export interface LocationFrontmatter {
  id: string;
  name: string;
  chapter?: string;
  /** Reference to the Roll20 page — never a map copy. */
  "roll20-page"?: string;
  [key: string]: unknown;
}

/** Frontmatter of a chapter's `_chapter.md`. */
export interface ChapterFrontmatter {
  id: string;
  title: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Session files are app-managed (`sessions/<yyyy-mm-dd>.md`).
 * Timestamps are strings — YAML would otherwise parse bare ISO dates as
 * Date objects; the parser normalizes them back to strings.
 */
export interface SessionFrontmatter {
  id: string;
  started?: string;
  ended?: string;
  scenes_played?: string[];
  [key: string]: unknown;
}

export type EntityKind =
  | "scene"
  | "npc"
  | "location"
  | "chapter"
  | "session"
  | "inbox"
  | "glossary"
  | "unknown";

/** One parsed markdown file. `path` is always relative to the campaign root. */
export interface ParsedFile<F = Record<string, unknown>> {
  path: string;
  kind: EntityKind;
  frontmatter: F;
  /** Markdown body without the frontmatter block. */
  body: string;
  /** Optimistic-concurrency token: PATCH sends it back, server 409s on mismatch. */
  mtimeMs: number;
}

// --- API response shapes (see endpoint list in server/src/server.ts) -------

export interface CampaignSummary {
  /** Directory name under CAMPAIGN_ROOT. */
  id: string;
}

export interface SceneSummary {
  path: string;
  id: string;
  title: string;
  type: OrString<SceneType>;
  status: OrString<SceneStatus>;
  /** Free-text firing condition — only meaningful for `type: contingency`. */
  trigger?: string;
  location?: string;
  npcs: string[];
  tags: string[];
}

export interface SceneGroup {
  /** Location-slug directory inside the chapter; "" for scenes directly in the chapter dir. */
  slug: string;
  scenes: SceneSummary[];
}

export interface ChapterNode {
  /** Directory name, e.g. "01-salzhafen". */
  id: string;
  /** From _chapter.md; falls back to the directory name. */
  title: string;
  status?: string;
  /** Path of _chapter.md, if present. */
  path?: string;
  groups: SceneGroup[];
}

export interface NpcSummary {
  path: string;
  id: string;
  name: string;
  role?: string;
  status: OrString<NpcStatus>;
  chapter?: string;
}

export interface LocationSummary {
  path: string;
  id: string;
  name: string;
  chapter?: string;
}

export interface SessionSummary {
  path: string;
  id: string;
  started?: string;
  ended?: string;
  scenes_played: string[];
}

/** GET /api/:campaign/tree */
export interface CampaignTree {
  campaign: string;
  chapters: ChapterNode[];
  npcs: NpcSummary[];
  locations: LocationSummary[];
  sessions: SessionSummary[];
}

/** GET /api/:campaign/file?path=… */
export interface FileResponse extends ParsedFile {
  /** Full file contents including the frontmatter block. */
  raw: string;
}

/**
 * One row of GET /api/:campaign/search (the response wraps them as
 * `{ results: SearchResult[] }`, see SearchResponse). Only scenes, npcs,
 * locations and chapters are indexed — see server/src/search-index.ts.
 */
export interface SearchResult {
  kind: EntityKind;
  id: string;
  title: string;
  path: string;
  /** Fuse.js score: 0 is a perfect match, values grow toward 1. */
  score: number;
  /** ~120 chars of body context around the first literal query hit. */
  snippet?: string;
}

/** GET /api/:campaign/search?q=… (400 on missing/empty q) */
export interface SearchResponse {
  results: SearchResult[];
}
