// Shared API types of Grimoire: the shapes that are no entity of their own —
// the campaign list, the campaign tree, the lists, search and the generator
// job — plus the instance settings.
//
// An entity with its own resource (ADR #31) has its type from its zod schema
// in its own module — the campaign in ./campaign.ts, the chapter in
// ./chapter.ts, the scene in ./scene.ts, the npc in ./npc.ts and the
// location in ./location.ts —, and the types are re-exported here.

import type { ChapterStatus } from "./chapter";
import type { LocationProposal } from "./location";
import type { NpcChange, NpcProposal, NpcStatus } from "./npc";
import type { SceneChange, SceneProposal, SceneStatus, SceneType } from "./scene";

export type {
  Campaign,
  CampaignChange,
  CampaignCreate,
  CampaignPatch,
  CampaignSeed,
} from "./campaign";

export type {
  Chapter,
  ChapterChange,
  ChapterCreate,
  ChapterPatch,
  ChapterProposal,
  ChapterStatus,
} from "./chapter";

export type {
  Location,
  LocationChange,
  LocationFields,
  LocationPatch,
  LocationProposal,
} from "./location";

export type {
  Npc,
  NpcChange,
  NpcCreate,
  NpcFields,
  NpcPatch,
  NpcProposal,
  NpcReplyFields,
  NpcReplyObject,
  NpcStatus,
  QuickstatPair,
} from "./npc";

export type {
  Scene,
  SceneChange,
  SceneCreate,
  ScenePatch,
  SceneProposal,
  SceneReplyFields,
  SceneReplyObject,
  SceneStatus,
  SceneType,
} from "./scene";

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

/**
 * Everything the SEARCH INDEX holds, and the list kinds beside them: a hit
 * names its entity by `kind` and `id` (see SearchResult).
 */
export type EntityKind =
  | "campaign"
  | "chapter"
  | "scene"
  | "npc"
  | "location"
  | "session"
  | "inbox"
  | "glossary";

// --- API response shapes (see endpoint list in server/src/server.ts) -------

export interface CampaignSummary {
  /** The campaign's id — the key in every URL. */
  id: string;
  /**
   * Id of the campaign's newest session (the `<id>` of `sessions/<id>`).
   * OPAQUE: an address, not a
   * date, and NOT comparable — order by `lastSessionStarted` instead. Absent
   * when the campaign has no session.
   */
  lastSession?: string;
  /**
   * `started` of that newest session — the zone-less wall-clock string the
   * property carries (`yyyy-mm-ddTHH:MM:SS`). This is what "last active"
   * means, and the only orderable thing about a session the client
   * gets. Absent when the campaign has no session, or when that session has no
   * usable `started` — either way it then sorts behind every campaign that
   * has one.
   */
  lastSessionStarted?: string;
  /**
   * Display name. Always present: a campaign without an authored name is
   * shown under its id, exactly as `GET /api/campaigns/:c` answers its `name`
   * — the two endpoints must agree. Optional in the type so an older payload
   * still parses.
   */
  name?: string;
  /**
   * One-line description of the campaign; absent when there is none (unlike
   * `name` there is nothing sensible to synthesize).
   */
  description?: string;
}

/**
 * A scene in the campaign tree. No address: a scene is its own resource,
 * `…/scenes/:id` (ADR #31).
 */
export interface SceneSummary {
  id: string;
  title: string;
  type: SceneType;
  status: SceneStatus;
  /** Free-text firing condition — only meaningful for `type: contingency`. */
  trigger?: string;
  /** The location id the scene names; absent when it sits at chapter level. */
  location?: string;
  /**
   * The location's display NAME, degraded to the id when nobody has named
   * it yet (a location created and left empty). Absent exactly when
   * `location` is.
   *
   * Resolved by the SERVER because only the server has the location rows at
   * hand while it builds the tree: a scene's meta line shows the name of its
   * location, not the slug behind it.
   */
  locationName?: string;
  npcs: string[];
  tags: string[];
}

export interface ChapterNode {
  /** The chapter's id, e.g. "01-salzhafen". */
  id: string;
  /** The chapter's title; falls back to its id. */
  title: string;
  status?: ChapterStatus;
  /**
   * Guard token of the scene ORDER below — what
   * `PUT /chapters/:chapter/scene-order` sends back and 409s on. Its own
   * counter, NOT the chapter's `rev`: reordering and editing the chapter are
   * separate writes and must not invalidate each other.
   * Optional in the type so an older payload still parses.
   */
  sceneOrderRev?: number;
  /**
   * The chapter's scenes in the order the DM arranged them — `pos` ascending
   * with the id as the tie-break. A FLAT list: the scenes of a chapter are
   * ordered, not grouped, and the location a scene names is a property it
   * shows (`locationName`) rather than a heading it hangs under.
   */
  scenes: SceneSummary[];
}

/**
 * An npc in the campaign tree. No address: an npc is its own resource,
 * `…/npcs/:id` (ADR #31).
 */
export interface NpcSummary {
  id: string;
  name: string;
  role?: string;
  status: NpcStatus;
  chapter?: string;
}

/**
 * A location in the campaign tree. No address: a location is its own
 * resource, `…/locations/:id` (ADR #31).
 */
export interface LocationSummary {
  id: string;
  name: string;
  chapter?: string;
}

/**
 * One session in a LIST — `GET /api/campaigns/:campaign/sessions` and the
 * campaign tree. It is the identifying head of `SessionResponse`: what a list
 * shows of a session is its id and when it ran.
 *
 * No address and no `scenes_played`: a session is not an entry (ADR #26), and
 * its log and its played scenes come from the session itself.
 */
export interface SessionSummary {
  /** Opaque id — `GET /api/campaigns/:campaign/sessions/<id>` reads it. */
  id: string;
  /** Zone-less local wall clock `yyyy-mm-ddTHH:MM:SS`; empty when never set. */
  started: string;
  /** The server's epoch reading of `started`; absent when it says nothing. */
  startedMs?: number;
  /** Absent while the session runs. */
  ended?: string;
  /** The server's epoch reading of `ended`. */
  endedMs?: number;
}

/**
 * One pause interval of a session. The strings are the zone-less wall clock
 * the columns hold; the `…Ms` values are the SERVER's reading of them — only
 * the server knows which wall clock those digits belong to, so a client in
 * another timezone still computes the right runtime. A missing `to` is the
 * RUNNING pause: the clock stands.
 */
export interface SessionPauseInterval {
  from: string;
  fromMs?: number;
  to?: string;
  toMs?: number;
}

/**
 * One line of a session's log. APPEND-ONLY, and structured: `text` is the
 * note as the DM typed it, hashtags included — they are body vocabulary
 * (README) and belong to the text, not beside it.
 */
export interface SessionLogEntry {
  /** The row's stable id — what `POST /review/seen` names the line by. */
  id: string;
  /** `HH:mm` local, the time the note was taken. */
  at: string;
  /** The scene the note was taken in; absent when it names none. */
  sceneId?: string;
  text: string;
  reviewed: boolean;
}

/**
 * ONE SESSION, as every session endpoint answers it: `GET …/session`,
 * `GET …/sessions/:id`, the four session verbs, `POST …/log`,
 * `POST …/review/seen` and `PATCH …/sessions/:id`.
 *
 * A session is a table, not an entry (ADR #26): no address, no `properties`
 * map, no markdown text. Its log is a list of rows and its pauses are
 * intervals, each with the server's epoch reading beside the string.
 */
export interface SessionResponse extends SessionSummary {
  pauses: SessionPauseInterval[];
  log: SessionLogEntry[];
  /** Scene ids in the order they were played; a revisited scene stands twice. */
  scenesPlayed: string[];
  /** Guard token of the session row — `PATCH …/sessions/:id` sends it back. */
  rev: number;
}

/** One idea in the inbox. */
export interface InboxEntry {
  /** The row's stable id — what `POST /review/inbox-done` names it by. */
  id: string;
  text: string;
  done: boolean;
}

/**
 * THE INBOX — `GET …/inbox`, `POST …/inbox` and
 * `POST …/review/inbox-done`: a list of rows plus the LIST's own guard token
 * (`campaigns.inbox_rev`), not an entry with a text.
 */
export interface InboxResponse {
  entries: InboxEntry[];
  rev: number;
}

/** One open thread — a row of a chapter's thread list. */
export interface ThreadEntry {
  /** The row's stable id — what a tick, an edit and a delete name it by. */
  id: string;
  text: string;
  done: boolean;
}

/**
 * THE OPEN THREADS of a chapter — every endpoint under
 * `…/chapters/:chapter/threads` answers it: the rows in their order plus the
 * LIST's own guard token (`chapters.threads_rev`). Not the chapter's `rev`:
 * the list is no field of the chapter, so writing it moves neither the
 * chapter's `body` nor its guard (ADR #26, #29).
 */
export interface ThreadsResponse {
  entries: ThreadEntry[];
  rev: number;
}

/**
 * The body of `PATCH …/chapters/:chapter/threads/:id` — tick, untick or
 * reword ONE thread. `rev` is the list's token as it was read; a stale one
 * is 409 `rev_conflict` carrying the current list under `threads`. At least
 * one of `text` and `done` has to be there, otherwise 400 `nothing_to_write`.
 */
export interface PatchThreadRequest {
  rev: number;
  text?: string;
  done?: boolean;
}

/**
 * The body of `PATCH /api/campaigns/:campaign/sessions/:id` — the timestamps
 * of a session, the only fields of it the DM edits by hand (a mistyped start,
 * a forgotten pause).
 *
 * `rev` is the guard token the session was read with; a mismatch is the same
 * 409 `rev_conflict` every other write answers. At least one of the three
 * fields has to be there, otherwise 400 `nothing_to_write`. The log and
 * `scenesPlayed` are not among them: they grow through their own endpoints.
 */
export interface PatchSessionRequest {
  rev: number;
  started?: string;
  /** `null` clears it — the session runs again. */
  ended?: string | null;
  /** Replaces the whole list; an entry without `to` is the running pause. */
  pauses?: Array<{ from: string; to?: string | null }>;
}

/** GET /api/:campaign/tree */
export interface CampaignTree {
  campaign: string;
  chapters: ChapterNode[];
  npcs: NpcSummary[];
  locations: LocationSummary[];
  sessions: SessionSummary[];
}

/**
 * PUT /api/campaigns/:campaign/chapters/:chapter/scene-order — the chapter's
 * scenes in their new order, and the chapter's fresh guard token.
 *
 * `rev` is `chapters.scene_order_rev` — the ORDER's own guard token, which
 * the tree hands out as `ChapterNode.sceneOrderRev`. Not the chapter's `rev`
 * and not a scene's: reordering changes neither, so it must not invalidate an
 * editor open on one. `scenes` is the complete list of the
 * chapter's scene ids — a request naming anything else is refused whole
 * (`scene_order_mismatch`).
 */
export interface SceneOrderResponse {
  scenes: string[];
  rev: number;
}

/**
 * One row of GET /api/:campaign/search (the response wraps them as
 * `{ results: SearchResult[] }`, see SearchResponse). Indexed are the
 * campaign, the chapters, the scenes, the npcs, the locations and the
 * glossary terms — see server/src/store/fts.ts. The search is truly mixed, so
 * a hit names its entity by `kind` and `id`, and the app opens the resource
 * of that entity — or, for a glossary term, the glossary (ADR #31).
 */
export interface SearchResult {
  kind: EntityKind;
  id: string;
  title: string;
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
 * Token spend of ONE generator run, summed over every provider call (the
 * initial one plus each correction turn). Absent when the endpoint reports
 * no usage at all — the UI then simply shows nothing. The generator's 422
 * bodies carry the same shape next to `error`, so a run that produced
 * nothing is just as visible as a successful one.
 */
export interface GenerateUsage {
  inputTokens: number;
  outputTokens: number;
  /** Provider calls in this run — 1 when no correction turn was needed. */
  attempts: number;
}

/**
 * The generator's review preview. Mechanically validated (every scene is a
 * draft, references resolve, only known callouts); `warnings` are the LLM's
 * own review notes for the DM. Carried by a finished job (see GenerateJob) —
 * POST /generate itself only starts one.
 */
export interface GenerateResult {
  /**
   * The scenes the run proposes, each a scene without its guard and always a
   * draft — accepted or dropped one by one, by id (`review.droppedScenes`).
   */
  scenes: SceneProposal[];
  /**
   * The npcs the run proposes, each an npc without its guard — accepted or
   * rejected one by one, by id (`review.npcs`).
   */
  npcs: NpcProposal[];
  /**
   * The locations the run proposes, each a location without its guard —
   * accepted or rejected one by one, by id (`review.locations`).
   */
  locations: LocationProposal[];
  warnings: string[];
  /**
   * The SERVER's own findings, not the model's: drafts that
   * still carry a spelling a naming convention replaces. Absent/empty when
   * the campaign has no naming conventions or nothing was found — never a
   * reason to fail a run.
   */
  namingHints?: NamingHint[];
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage?: GenerateUsage;
}

/**
 * Result of an NPC run (POST /api/:campaign/generate/npc) — deliberately its
 * OWN shape instead of a scene-less GenerateResult: an NPC run produces
 * exactly one npc and has no chapter, and a `scenes: []` would be a lie every
 * consumer would have to special-case. Carried by a finished job as
 * `npcResult` (see GenerateJob). Nothing is stored yet: the npc is written
 * when the DM accepts it.
 */
export interface GenerateNpcResult {
  /** The proposed npc, without its guard. */
  npc: NpcProposal;
  /** The LLM's own review notes for the DM (gaps in the source text). */
  warnings: string[];
  /** The naming check's findings — see GenerateResult.namingHints. */
  namingHints?: NamingHint[];
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage?: GenerateUsage;
}

// --- augmenting an EXISTING scene, npc or location -------------------------

/**
 * The result of augmenting a SCENE (`POST …/scenes/:id/augment`): the scene
 * as the run read it and as the model proposes it, both without their guard.
 * Nothing is written — `POST …/scenes/:id/augment/apply` is the only write,
 * and it carries the fields the DM took.
 *
 * The review compares the two field by field; `body` is reviewed block by
 * block, cut in the app with the Block-Composer's own block model.
 */
export interface SceneAugmentResult {
  /** The scene the run is about. */
  id: string;
  /** The `rev` the run READ. Informational — the write sends the UI's rev. */
  rev: number;
  /** The scene as the run read it. */
  current: SceneProposal;
  /** The scene as the model proposes it, complete. */
  proposed: SceneProposal;
  /** The LLM's own review notes for the DM. */
  warnings: string[];
  /** The naming check's findings — see GenerateResult.namingHints. */
  namingHints?: NamingHint[];
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage?: GenerateUsage;
}

/**
 * The result of augmenting a LOCATION (`POST …/locations/:id/augment`): the
 * location as the run read it and as the model proposes it, both without
 * their guard. Nothing is written — `POST …/locations/:id/augment/apply` is
 * the only write, and it carries the fields the DM took.
 *
 * The review compares the two field by field; `body` is reviewed block by
 * block, cut in the app with the Block-Composer's own block model.
 */
export interface LocationAugmentResult {
  /** The location the run is about. */
  id: string;
  /** The `rev` the run READ. Informational — the write sends the UI's rev. */
  rev: number;
  /** The location as the run read it. */
  current: LocationProposal;
  /** The location as the model proposes it, complete. */
  proposed: LocationProposal;
  /** The LLM's own review notes for the DM. */
  warnings: string[];
  /** The naming check's findings — see GenerateResult.namingHints. */
  namingHints?: NamingHint[];
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage?: GenerateUsage;
}

/**
 * The result of augmenting an NPC (`POST …/npcs/:id/augment`): the npc as the
 * run read it and as the model proposes it, both without their guard.
 * Nothing is written — `POST …/npcs/:id/augment/apply` is the only write, and
 * it carries the fields the DM took.
 *
 * The review compares the two field by field; `body` is reviewed block by
 * block, cut in the app with the Block-Composer's own block model.
 */
export interface NpcAugmentResult {
  /** The npc the run is about. */
  id: string;
  /** The `rev` the run READ. Informational — the write sends the UI's rev. */
  rev: number;
  /** The npc as the run read it. */
  current: NpcProposal;
  /** The npc as the model proposes it, complete. */
  proposed: NpcProposal;
  /** The LLM's own review notes for the DM. */
  warnings: string[];
  /** The naming check's findings — see GenerateResult.namingHints. */
  namingHints?: NamingHint[];
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage?: GenerateUsage;
}

// --- the scene pipeline ----------------------------------------------------

/**
 * ONE part of a pipelined scene run as the client sees it.
 *
 * A run is no longer one call that stands or falls whole: an OUTLINE call
 * decides which scenes exist, and then every scene, every proposed npc and
 * every proposed location is a call of its own. Each of those is a PART with a status, so a form
 * error costs that part and nothing else — and a finished part is reviewable
 * while its siblings are still running.
 *
 * The OUTLINE itself never travels: it is a purely internal step for error
 * reduction and is never offered for editing. What the client
 * gets is the part LIST — order, kind, title, status — because a status card
 * and a progress count of finished parts cannot be drawn without it.
 */
export interface GenerateJobPart {
  /** Stable key of the part; the retry endpoint addresses it (`scene:<id>`). */
  key: string;
  kind: "scene" | "npc" | "location";
  /** The id the outline gave this part — the id of its scene, npc or location. */
  id: string;
  /** Display title of the part; the id when the outline named none. */
  title: string;
  status: GenerateJobPartStatus;
  /** Why the part failed — the DM reads this next to the retry action. */
  error?: string;
  /** The mechanical validation errors of a failed part, when there were any. */
  validationErrors?: string[];
  /** The raw reply of the failed attempt (capped) — the raw-reply block. */
  rawReply?: string;
}

export const GENERATE_JOB_PART_STATUSES = ["pending", "running", "done", "failed"] as const;
export type GenerateJobPartStatus = (typeof GENERATE_JOB_PART_STATUSES)[number];

/**
 * The pipeline state of a scene run: its parts in OUTLINE order
 * plus what the whole run has cost so far. Absent for the single-call runs
 * (npc, augment) and for a job from an older server.
 */
export interface GenerateJobPipeline {
  parts: GenerateJobPart[];
  /**
   * What the chapter a new-chapter run creates is about — written by the
   * outline from the source material, and the text that chapter starts with
   * once the run is accepted. Absent for a run into an existing chapter and
   * when the outline brought none.
   */
  chapterDescription?: string;
  /**
   * Summed over every provider call of every part, the outline included —
   * the review header shows it as a token and call count. `calls` counts
   * provider calls (a correction turn is one more).
   */
  totals: { inputTokens: number; outputTokens: number; calls: number };
}

// --- background generate jobs ----------------------------------------------

export const GENERATE_JOB_STATUSES = ["running", "done", "failed"] as const;
export type GenerateJobStatus = (typeof GENERATE_JOB_STATUSES)[number];

/**
 * What a generator job produces: proposed scenes for a chapter, one proposed
 * npc, or a PROPOSAL for an existing scene (`scene-augment`), npc
 * (`npc-augment`) or location (`location-augment`). There is still exactly
 * ONE job per campaign; the kind only tells the client which result field to
 * read and which mode to restore.
 */
export const GENERATE_JOB_KINDS = [
  "scene",
  "npc",
  "scene-augment",
  "npc-augment",
  "location-augment",
] as const;
export type GenerateJobKind = (typeof GENERATE_JOB_KINDS)[number];

/**
 * A failed run, exactly as the synchronous endpoint would have answered it:
 * the HTTP status and the JSON error body it would have sent. So a job
 * failure carries the same `error`/`validationErrors`/`rawReply`/`usage`
 * fields the client already knows from the generator's 422
 * — the UI feeds `body` into the same block it feeds `ApiError.details`.
 */
export interface GenerateJobError {
  status: number;
  body: Record<string, unknown>;
}

/**
 * GET /api/:campaign/generate/job — the one generate job of a campaign.
 * The run outlives the browser tab: POST /generate answers
 * `202 { jobId }` and the result waits here until it is applied, discarded
 * or replaced by the next run.
 *
 * A ROW on the server (`generate_jobs`), so the run outlives
 * the process too: `done` and `failed` come back after a restart whole —
 * result, error body and the DM's edits — and stay applyable. Only a `running`
 * job cannot survive, because its provider call died with the process: the
 * boot rewrites it to `failed` with a German message saying to start the run
 * again, which the client shows instead of polling forever.
 */
export interface GenerateJob {
  /** crypto.randomUUID — the client sends it back on apply. */
  id: string;
  campaign: string;
  /**
   * What this run produces. Additive and optional: a payload
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
  /** Present iff status is "done" and kind is "npc". */
  npcResult?: GenerateNpcResult;
  /** Present iff status is "done" and kind is "scene-augment". */
  sceneAugmentResult?: SceneAugmentResult;
  /** Present iff status is "done" and kind is "npc-augment". */
  npcAugmentResult?: NpcAugmentResult;
  /** Present iff status is "done" and kind is "location-augment". */
  locationAugmentResult?: LocationAugmentResult;
  /**
   * The id of the scene a `scene-augment` run works on. Present for that
   * kind from the moment the job STARTS, so the app can show which scene is
   * being worked on while the run is still going.
   */
  scene?: string;
  /**
   * The id of the npc an `npc-augment` run works on — present from the
   * moment the job STARTS, like `scene` for the scene augment run.
   */
  npc?: string;
  /**
   * The id of the location a `location-augment` run works on — present from
   * the moment the job STARTS, like `scene` for the scene augment run.
   */
  location?: string;
  /** Present iff status is "failed". */
  error?: GenerateJobError;
  /**
   * The DM's changes to a proposed scene, by its id — `result.scenes`. A
   * change names the fields it sets, `null` clears an optional one, and every
   * other field keeps the model's value (`withSceneChange`). Kept on the job
   * so an edited scene survives a reload, and applied on top of the proposal
   * when it is accepted.
   */
  sceneEdits: Record<string, SceneChange>;
  /**
   * The DM's changes to a proposed npc, by its id — `result.npcs` or the
   * NPC run's `npcResult.npc`. A change names the fields it sets, `null`
   * clears an optional one, and every other field keeps the model's value
   * (`withNpcChange`). Kept on the job like `sceneEdits`, and applied on top
   * of the proposal when it is accepted.
   */
  npcEdits: Record<string, NpcChange>;
  /**
   * Optimistic-concurrency token of the REVIEW STATE. Every
   * `PATCH …/review` sends the rev it read and gets a 409
   * `rev_conflict` when the job moved underneath (a second tab), so nothing
   * a DM decided is ever silently overwritten. Bumped by the review patch
   * and by a partial accept; absent on a payload from an older server.
   */
  rev?: number;
  /**
   * Everything the DM DID in the review, kept on the job, so a
   * navigation, a reload, a second tab and a server restart all show the
   * same state. `sceneEdits` and `npcEdits` hold the changed fields; this
   * holds the decisions. Absent on a payload from an older server — the UI
   * treats that as "nothing decided yet".
   */
  review?: GenerateJobReview;
  /**
   * The pipeline state of a scene run — the parts in outline
   * order and the run's token/call totals. Absent for a single-call run and
   * for a payload from an older server, and then the review renders exactly
   * as it did before the pipeline existed.
   */
  pipeline?: GenerateJobPipeline;
}

/**
 * The review state of a job. Deliberately a small, additive
 * record of DECISIONS, not a second copy of the result: the result stays
 * the model's output, this is what the DM did with it.
 */
export interface GenerateJobReview {
  /** The ids of the proposed scenes the DM dropped from the run — never written. */
  droppedScenes: string[];
  /**
   * Augment run only: decision per PROPERTY key. `true` accepts the
   * proposal, `false` keeps the current value; an absent key keeps the
   * computed default (lib/augment `defaultAccepted`), so a fresh review
   * starts from that default.
   */
  fields: Record<string, boolean>;
  /** Augment run only: the same per body BLOCK id. */
  blocks: Record<string, boolean>;
  /**
   * The ids of the proposed scenes a PARTIAL accept already wrote. A written
   * part is read-only in the review and links to what it became; the job
   * disappears once every part is written, dropped or rejected.
   */
  writtenScenes: string[];
  /**
   * Decision per proposed NPC, keyed by its id. A key that is absent is OPEN
   * — the review's third state, which is why "open" is not a value here.
   */
  npcs: Record<string, GenerateReviewDecision>;
  /** The ids of the proposed npcs a partial accept already wrote. */
  writtenNpcs: string[];
  /** Decision per proposed LOCATION, keyed by its id. Absent is open, as in `npcs`. */
  locations: Record<string, GenerateReviewDecision>;
  /** The ids of the proposed locations a partial accept already wrote. */
  writtenLocations: string[];
}

/** What the DM decided about one proposed npc or location. */
export type GenerateReviewDecision = "accepted" | "rejected";

/**
 * POST /api/:campaign/generate and POST /api/:campaign/generate/npc — 202
 * with the started job's id.
 */
export interface GenerateJobStarted {
  jobId: string;
}

// --- instance settings ------------------------------------------------------

/**
 * The UI languages the app ships. The list lives HERE, not in the app, because
 * the server validates `PUT /api/settings` against it — the language is an
 * INSTANCE setting, not a browser preference (quality floor: no localStorage
 * for data, the server is the truth).
 */
export const UI_LOCALES = ["de", "en"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

/**
 * GET/PUT /api/settings — the whole instance settings object (Grimoire is a
 * single-user tool, so there is exactly one of it).
 *
 * `locale: null` means NOT DECIDED YET: the app then follows
 * `navigator.language` and writes nothing. Only an explicit switch in the UI
 * stores a value, which is what makes the choice survive a reload and reach
 * the next browser.
 */
export interface InstanceSettings {
  locale: UiLocale | null;
}

// --- glossary & campaign knowledge -----------------------------------------

/**
 * One glossary term. The glossary answers the TRANSLATION question ("what do
 * we call a `lighthouse keeper` in this campaign?") and is quoted to the
 * model as `term → explanation` lines.
 */
export interface GlossaryEntry {
  term: string;
  explanation: string;
}

/**
 * GET/PUT /api/:campaign/glossary. `rev` is the guard token of the WHOLE
 * list (`campaigns.glossary_rev`) — the glossary is one entry that is
 * edited as a whole, so there is no per-entry version to hold, and the
 * ORDER of `entries` is the stored order (that is what reordering writes).
 */
export interface GlossaryResponse {
  entries: GlossaryEntry[];
  rev: number;
}

/**
 * The three kinds of campaign knowledge:
 *
 *   naming  a NAMING CONVENTION — `from` is the spelling the source material
 *           uses, `to` the one this campaign uses. The only kind the server
 *           can CHECK after a run, which is why it is a pair and not prose.
 *   fact    a campaign fact that outranks the source material.
 *   style   a style rule for the generated prose.
 *
 * `fact` and `style` carry `text`; `naming` carries `from` + `to`. The unused
 * fields are empty strings rather than absent — one row shape, and a kind
 * switched in the UI keeps what was already typed instead of dropping it.
 */
export const KNOWLEDGE_KINDS = ["naming", "fact", "style"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export function isKnowledgeKind(value: unknown): value is KnowledgeKind {
  return typeof value === "string" && (KNOWLEDGE_KINDS as readonly string[]).includes(value);
}

/** One campaign-knowledge entry. See KNOWLEDGE_KINDS for which fields apply. */
export interface KnowledgeEntry {
  kind: KnowledgeKind;
  /** `naming`: the source material's spelling. Empty for the other kinds. */
  from: string;
  /** `naming`: the spelling this campaign uses. Empty for the other kinds. */
  to: string;
  /** `fact`/`style`: the sentence. Empty for `naming`. */
  text: string;
}

/**
 * GET/PUT /api/:campaign/knowledge — same whole-list shape and the same
 * guard rule as the glossary (`campaigns.knowledge_rev`).
 */
export interface KnowledgeResponse {
  entries: KnowledgeEntry[];
  rev: number;
}

/**
 * One finding of the POST-RUN naming check: a finished draft
 * still carries a spelling that a naming convention replaces.
 *
 * A HINT, never a blocker — the check is a plain word-boundary text search
 * and cannot know whether the hit is the thing the rule means (a `from` of
 * "Salt" hits "Salt Harbour" and the word "salt"). So it reports WHERE it
 * looked and lets the DM decide; the sentence around it is built by the app
 * from its own catalog, because the server stays language-free.
 *
 * WHAT the hit sits in is named by its kind: a proposed or augmented scene
 * by its id under `scene`, an npc by its id under `npc`, a location by its id
 * under `location`.
 */
export type NamingHint = NamingHintAt &
  (
    | { scene: string; npc?: never; location?: never }
    | { npc: string; scene?: never; location?: never }
    | { location: string; scene?: never; npc?: never }
  );

/** Where a naming hint sits and what it found — see `NamingHint`. */
export interface NamingHintAt {
  /** The convention's `from` — the spelling that was found. */
  from: string;
  /** The convention's `to` — what should stand there instead. */
  to: string;
  /**
   * Where inside it: `"body"` together with a 1-based `line`, or the name of
   * the field (`"title"`, `"role"`, …) with `line` absent.
   */
  field: string;
  /** 1-based line number inside the markdown body; absent for a property. */
  line?: number;
  /** The line (or property value) the hit sits in, trimmed and capped. */
  excerpt: string;
}
