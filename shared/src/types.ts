// Entity types for the Grimoire markdown data format.
// This is the code mirror of the format contract in /README.md — keep both
// in sync; changes here need a matching README edit (and vice versa).
//
// Design rule (README): the format DEGRADES, it does not validate. Every
// enum-ish field is typed as its known literals *or* any string, unknown
// frontmatter keys are preserved, and nothing in shared/ ever throws on
// odd input.

import type { SessionPause } from "./session-state";

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

/**
 * Frontmatter of a campaign's `_campaign.md` (README, "Entität: Kampagne
 * (optional)"). The file is optional — without it the UI shows the directory
 * name. `id` is the directory name, `name` the display name; further keys
 * (e.g. `system`) are preserved verbatim.
 */
export interface CampaignFrontmatter {
  id: string;
  name: string;
  /** One-liner shown next to the name (switcher meta, pool subtitle). */
  description?: string;
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
 * Session files are app-managed (`sessions/<id>.md`, where `<id>` is an
 * opaque random string since issue #58 — everything displayable about a
 * session comes from `started`).
 * Timestamps are strings — YAML would otherwise parse bare ISO dates as
 * Date objects; the parser normalizes them back to strings.
 */
export interface SessionFrontmatter {
  id: string;
  started?: string;
  ended?: string;
  scenes_played?: string[];
  /**
   * Pause intervals of the session (app-managed, hand-editable — issue #40
   * AK8): `[{ from: yyyy-mm-ddTHH:MM:SS, to?: … }]` in the same zone-less
   * local-time convention as started/ended. An entry without `to` is the
   * running pause. Read it through `sessionPauses` (session-state.ts), which
   * carries the degrade rules.
   */
  pauses?: SessionPause[];
  /**
   * Short hashes of log lines seen in the review step (app-managed). One
   * entry is the first 8 hex chars of SHA-256 over the RAW log line — this
   * keeps `## Log` strictly append-only and survives external reordering
   * (README, "Entität: Session").
   */
  reviewed?: string[];
  [key: string]: unknown;
}

export type EntityKind =
  | "scene"
  | "npc"
  | "location"
  | "chapter"
  | "campaign"
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
  /** The campaign's id — the key in every URL. */
  id: string;
  /**
   * Id of the campaign's newest session (`sessions/<id>.md` without the
   * extension). OPAQUE since the PO decision on issue #58: an address, not a
   * date, and NOT comparable — order by `lastSessionStarted` instead. Absent
   * when the campaign has no session.
   */
  lastSession?: string;
  /**
   * `started` of that newest session — the zone-less wall-clock string the
   * file format carries (`yyyy-mm-ddTHH:MM:SS`). This is what "last active"
   * means (issue #14) and the only orderable thing about a session the client
   * gets. Absent when the campaign has no session, or when that session has no
   * usable `started` (a hand-edited file) — either way it then sorts behind
   * every campaign that has one.
   */
  lastSessionStarted?: string;
  /**
   * Display name (issue #17). Always present since issue #62: a campaign
   * without an authored name is shown under its ID, exactly as the campaign
   * DOCUMENT renders it (`GET /file?path=_campaign.md`) — the two endpoints
   * used to disagree. Optional in the type so an older payload still parses.
   */
  name?: string;
  /**
   * One-line description of the campaign; absent when there is none (unlike
   * `name` there is nothing sensible to synthesize).
   */
  description?: string;
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

/** GET /api/:campaign/file?path=… (and GET /api/:campaign/session) */
export interface FileResponse extends ParsedFile {
  /** Full file contents including the frontmatter block. */
  raw: string;
  /**
   * SESSION FILES ONLY (issue #40): `started` as epoch milliseconds, read in
   * the SERVER's timezone. The frontmatter value stays the zone-less string
   * the format uses — this is the server's interpretation of it, so a client
   * in a different timezone still computes the right session runtime.
   * Undefined when there is no usable `started`.
   */
  startedMs?: number;
  /** SESSION FILES ONLY: `ended` as epoch milliseconds (see startedMs). */
  endedMs?: number;
  /**
   * SESSION FILES ONLY (issue #40 AK8): the total length of the session's
   * CLOSED `pauses` intervals in milliseconds, computed by the server for the
   * same reason as startedMs — the strings are zone-less. Absent when the
   * session has no usable closed pause.
   */
  pausedMs?: number;
  /**
   * SESSION FILES ONLY: start of the OPEN pause interval as epoch
   * milliseconds — present exactly while the session is paused, so the client
   * needs no parsing of its own to freeze the clock.
   */
  pausedSinceMs?: number;
}

/**
 * One row of GET /api/:campaign/search (the response wraps them as
 * `{ results: SearchResult[] }`, see SearchResponse). Only scenes, npcs,
 * locations, chapters and the campaign file are indexed — see
 * server/src/search-index.ts.
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

// --- generator (POST /api/:campaign/generate, see generator/README.md) -----

/**
 * One generated scene draft in the review preview. Nothing is on disk yet —
 * writing happens only via POST /api/:campaign/generate/apply.
 */
export interface GeneratedSceneDraft {
  /** Campaign-relative target path, e.g. "01-salzhafen/hafen/captured.md". */
  path: string;
  /** The complete markdown file including the frontmatter block. */
  markdown: string;
  /** The parsed frontmatter (always `status: draft`), for the review UI. */
  frontmatter: Record<string, unknown>;
}

/**
 * A stub for an npc/location the source text mentions but the campaign does
 * not know yet. The review UI accepts/rejects stubs individually; the target
 * path on apply is derived as `npcs/<id>.md` / `locations/<id>.md`.
 */
export interface GeneratedStub {
  kind: "npc" | "location";
  id: string;
  name: string;
  /** The complete stub markdown file including the frontmatter block. */
  markdown: string;
}

/**
 * Token spend of ONE generator run, summed over every provider call (the
 * initial one plus each correction turn). Absent when the endpoint reports
 * no usage at all — the UI then simply shows nothing. The generator's 422
 * bodies carry the same shape next to `error`, so a run that produced
 * nothing is just as visible as a successful one (issue #18).
 */
export interface GenerateUsage {
  inputTokens: number;
  outputTokens: number;
  /** Provider calls in this run — 1 when no correction turn was needed. */
  attempts: number;
}

/**
 * The generator's review preview. Mechanically validated (frontmatter
 * parses, status is draft, references resolve, only known callouts);
 * `warnings` are the LLM's own review notes for the DM. Carried by a
 * finished job (see GenerateJob) — POST /generate itself only starts one.
 */
export interface GenerateResult {
  scenes: GeneratedSceneDraft[];
  stubs: GeneratedStub[];
  warnings: string[];
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage?: GenerateUsage;
}

/**
 * One generated NPC file draft (issue #21). Same "nothing is on disk yet"
 * rule as a scene draft: writing happens only via POST
 * /api/:campaign/generate/apply. The path is always `npcs/<id>.md` and the
 * frontmatter id matches that filename — the server validates both before
 * the draft ever reaches the review.
 */
export interface GeneratedNpcDraft {
  /** Campaign-relative target path, always "npcs/<kebab-id>.md". */
  path: string;
  /** The complete markdown file including the frontmatter block. */
  markdown: string;
  /** The parsed frontmatter (id/name/status guaranteed), for the review UI. */
  frontmatter: Record<string, unknown>;
}

/**
 * Result of an NPC run (POST /api/:campaign/generate/npc, issue #21) —
 * deliberately its OWN shape instead of a scene-less GenerateResult: an NPC
 * run produces exactly one file, has no stubs and no chapter, and a
 * `scenes: []` would be a lie every consumer would have to special-case.
 * Carried by a finished job as `npcResult` (see GenerateJob).
 */
export interface GenerateNpcResult {
  npc: GeneratedNpcDraft;
  /** The LLM's own review notes for the DM (gaps in the source text). */
  warnings: string[];
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage?: GenerateUsage;
}

// --- background generate jobs (issue #19) ----------------------------------

export const GENERATE_JOB_STATUSES = ["running", "done", "failed"] as const;
export type GenerateJobStatus = (typeof GENERATE_JOB_STATUSES)[number];

/**
 * What a generator job produces (issue #21): scene drafts for a chapter, or
 * one NPC file draft. There is still exactly ONE job per campaign — the kind
 * only tells the client which result field to read and which mode to restore.
 */
export const GENERATE_JOB_KINDS = ["scene", "npc"] as const;
export type GenerateJobKind = (typeof GENERATE_JOB_KINDS)[number];

/**
 * A failed run, exactly as the synchronous endpoint would have answered it:
 * the HTTP status and the JSON error body it would have sent. So a job
 * failure carries the same `error`/`validationErrors`/`rawReply`/`usage`
 * fields the client already knows from the generator's 422 (issues #18/#20)
 * — the UI feeds `body` into the same block it feeds `ApiError.details`.
 */
export interface GenerateJobError {
  status: number;
  body: Record<string, unknown>;
}

/**
 * GET /api/:campaign/generate/job — the one generate job of a campaign
 * (issue #19). The run outlives the browser tab: POST /generate answers
 * `202 { jobId }` and the result waits here until it is applied, discarded
 * or replaced by the next run.
 *
 * A ROW on the server since issue #23 (`generate_jobs`), so the run outlives
 * the process too: `done` and `failed` come back after a restart whole —
 * result, error body and `draftEdits` — and stay applyable. Only a `running`
 * job cannot survive, because its provider call died with the process: the
 * boot rewrites it to `failed` with a German message saying to start the run
 * again, which the client shows instead of polling forever.
 */
export interface GenerateJob {
  /** crypto.randomUUID — the client sends it back on apply. */
  id: string;
  campaign: string;
  /**
   * What this run produces (issue #21). Additive and optional: a payload
   * without it is a scene run — the field exists so the UI can restore the
   * right generator mode (and read the right result field).
   */
  kind?: GenerateJobKind;
  /** Target chapter of a SCENE run; absent for `kind: "npc"` (no chapter). */
  chapter?: string;
  status: GenerateJobStatus;
  /** ISO timestamps (server clock). `finishedAt` only once it is not running. */
  startedAt: string;
  finishedAt?: string;
  /** Present iff status is "done" and kind is "scene". */
  result?: GenerateResult;
  /** Present iff status is "done" and kind is "npc" (issue #21). */
  npcResult?: GenerateNpcResult;
  /** Present iff status is "failed". */
  error?: GenerateJobError;
  /**
   * Review edits kept server-side, keyed by the draft's campaign-relative
   * path (PUT …/generate/job/drafts) — so an edited draft survives a reload
   * as well. Empty until the DM edits something; applied ON TOP of
   * `result.scenes` (or of `npcResult.npc`) by the review UI.
   */
  draftEdits: Record<string, string>;
}

/**
 * POST /api/:campaign/generate and POST /api/:campaign/generate/npc — 202
 * with the started job's id.
 */
export interface GenerateJobStarted {
  jobId: string;
}
