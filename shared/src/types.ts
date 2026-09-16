// Entity types for the Grimoire markdown data format.
// This is the code mirror of the format contract in /README.md — keep both
// in sync; changes here need a matching README edit (and vice versa).
//
// Design rule (README): the format DEGRADES, it does not validate. Every
// enum-ish field is typed as its known literals *or* any string, unknown
// properties keys are preserved, and nothing in shared/ ever throws on
// odd input.

import type { SessionPause } from "./session-state";

/** Known scene lifecycle states; files may contain other values (degrade). */
export const SCENE_STATUSES = ["draft", "ready", "played", "dropped"] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

export const SCENE_TYPES = ["planned", "contingency"] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export const NPC_STATUSES = ["alive", "dead", "missing", "unknown"] as const;
export type NpcStatus = (typeof NPC_STATUSES)[number];

/**
 * A chapter's lifecycle states, in that order. `active` is the ONE the app
 * acts on — the session view opens the active chapter, and there is at most
 * one per campaign (the server swaps it in a single transaction).
 *
 * Like every other enum here these are the KNOWN values, not a validator: a
 * chapter carrying something else is shown verbatim, and there is no CHECK
 * constraint behind the column. What is different is that the API refuses to
 * WRITE anything else (400) — the status has three positions now, so a fourth
 * value arriving on the wire can only be a typo.
 */
export const CHAPTER_STATUSES = ["planned", "active", "done"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

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
export interface SceneProperties {
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

export interface NpcProperties {
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

export interface LocationProperties {
  id: string;
  name: string;
  chapter?: string;
  /** Reference to the Roll20 page — never a map copy. */
  "roll20-page"?: string;
  [key: string]: unknown;
}

/**
 * Properties of a campaign's `campaign` (README, "Entität: Kampagne
 * (optional)"). The file is optional — without it the UI shows the directory
 * name. `id` is the directory name, `name` the display name; further keys
 * (e.g. `system`) are preserved verbatim.
 */
export interface CampaignProperties {
  id: string;
  name: string;
  /** One-liner shown next to the name (switcher meta, pool subtitle). */
  description?: string;
  [key: string]: unknown;
}

/** Properties of a chapter. */
export interface ChapterProperties {
  id: string;
  title: string;
  status?: OrString<ChapterStatus>;
  [key: string]: unknown;
}

/**
 * Session files are app-managed (`sessions/<id>`, where `<id>` is an
 * opaque random string — everything displayable about a
 * session comes from `started`).
 * Timestamps are strings — YAML would otherwise parse bare ISO dates as
 * Date objects; the parser normalizes them back to strings.
 */
export interface SessionProperties {
  id: string;
  started?: string;
  ended?: string;
  scenes_played?: string[];
  /**
   * Pause intervals of the session (app-managed, hand-editable):
   * `[{ from: yyyy-mm-ddTHH:MM:SS, to?: … }]` in the same zone-less
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
  properties: F;
  /** Markdown body without the properties block. */
  body: string;
  /** Optimistic-concurrency token: PATCH sends it back, server 409s on mismatch. */
  rev: number;
}

// --- API response shapes (see endpoint list in server/src/server.ts) -------

export interface CampaignSummary {
  /** The campaign's id — the key in every URL. */
  id: string;
  /**
   * Id of the campaign's newest session (`sessions/<id>` without the
   * extension). OPAQUE by PO decision: an address, not a
   * date, and NOT comparable — order by `lastSessionStarted` instead. Absent
   * when the campaign has no session.
   */
  lastSession?: string;
  /**
   * `started` of that newest session — the zone-less wall-clock string the
   * file format carries (`yyyy-mm-ddTHH:MM:SS`). This is what "last active"
   * means, and the only orderable thing about a session the client
   * gets. Absent when the campaign has no session, or when that session has no
   * usable `started` (a hand-edited file) — either way it then sorts behind
   * every campaign that has one.
   */
  lastSessionStarted?: string;
  /**
   * Display name. Always present: a campaign
   * without an authored name is shown under its ID, exactly as the campaign
   * DOCUMENT renders it (`GET /entry?path=campaign`) — the two endpoints
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
  /**
   * The `location` the scenes of this group name — the group IS that
   * location. "" for the scenes that name none.
   */
  slug: string;
  /**
   * The location entry's display NAME, degraded to the id when nobody has
   * named it yet (an entry created and left empty). "" for the `slug: ""`
   * group, which is not a location and is labelled by the app.
   *
   * Resolved HERE because the groups are ordered by it: the heading the DM
   * reads is the name, so an ordering by slug put „Die Bucht" under B.
   */
  name: string;
  scenes: SceneSummary[];
}

export interface ChapterNode {
  /** Directory name, e.g. "01-salzhafen". */
  id: string;
  /** The chapter's title; falls back to its id. */
  title: string;
  status?: OrString<ChapterStatus>;
  /** Address of the chapter — its id. */
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

/** GET /api/:campaign/entry?path=… (and GET /api/:campaign/session) */
export interface EntryResponse extends ParsedFile {
  /**
   * SESSIONS ONLY: `started` as epoch milliseconds, read in
   * the SERVER's timezone. The properties value stays the zone-less string
   * the format uses — this is the server's interpretation of it, so a client
   * in a different timezone still computes the right session runtime.
   * Undefined when there is no usable `started`.
   */
  startedMs?: number;
  /** SESSIONS ONLY: `ended` as epoch milliseconds (see startedMs). */
  endedMs?: number;
  /**
   * SESSIONS ONLY: the total length of the session's
   * CLOSED `pauses` intervals in milliseconds, computed by the server for the
   * same reason as startedMs — the strings are zone-less. Absent when the
   * session has no usable closed pause.
   */
  pausedMs?: number;
  /**
   * SESSIONS ONLY: start of the OPEN pause interval as epoch
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
  /** Campaign-relative target path, e.g. "01-salzhafen/hafen/captured". */
  path: string;
  /** The complete markdown file including the properties block. */
  markdown: string;
  /** The parsed properties (always `status: draft`), for the review UI. */
  properties: Record<string, unknown>;
}

/**
 * A stub for an npc/location the source text mentions but the campaign does
 * not know yet. The review UI accepts/rejects stubs individually; the target
 * path on apply is derived as `npcs/<id>` / `locations/<id>`.
 */
export interface GeneratedStub {
  kind: "npc" | "location";
  id: string;
  name: string;
  /** The complete stub markdown file including the properties block. */
  markdown: string;
}

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
 * The generator's review preview. Mechanically validated (properties
 * parses, status is draft, references resolve, only known callouts);
 * `warnings` are the LLM's own review notes for the DM. Carried by a
 * finished job (see GenerateJob) — POST /generate itself only starts one.
 */
export interface GenerateResult {
  scenes: GeneratedSceneDraft[];
  stubs: GeneratedStub[];
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
 * One generated NPC file draft. Same "nothing is on disk yet"
 * rule as a scene draft: writing happens only via POST
 * /api/:campaign/generate/apply. The path is always `npcs/<id>` and the
 * properties id matches that filename — the server validates both before
 * the draft ever reaches the review.
 */
export interface GeneratedNpcDraft {
  /** Campaign-relative target path, always "npcs/<kebab-id>". */
  path: string;
  /** The complete markdown file including the properties block. */
  markdown: string;
  /** The parsed properties (id/name/status guaranteed), for the review UI. */
  properties: Record<string, unknown>;
}

/**
 * Result of an NPC run (POST /api/:campaign/generate/npc) —
 * deliberately its OWN shape instead of a scene-less GenerateResult: an NPC
 * run produces exactly one file, has no stubs and no chapter, and a
 * `scenes: []` would be a lie every consumer would have to special-case.
 * Carried by a finished job as `npcResult` (see GenerateJob).
 */
export interface GenerateNpcResult {
  npc: GeneratedNpcDraft;
  /** The LLM's own review notes for the DM (gaps in the source text). */
  warnings: string[];
  /** The naming check's findings — see GenerateResult.namingHints. */
  namingHints?: NamingHint[];
  /** Token spend of the run; absent when the endpoint reports no usage. */
  usage?: GenerateUsage;
}

// --- augmenting an EXISTING entry -------------------------------------------

/**
 * The entity kinds „Mit KI ergänzen" works on. Deliberately its own list and
 * not `EntityKind`: a chapter, a session or the campaign file has no augment
 * prompt, and a kind without one must not even reach the pipeline.
 */
export const AUGMENT_KINDS = ["npc", "location", "scene"] as const;

export type AugmentKind = (typeof AUGMENT_KINDS)[number];

export function isAugmentKind(value: unknown): value is AugmentKind {
  return typeof value === "string" && (AUGMENT_KINDS as readonly string[]).includes(value);
}

/**
 * One properties field of an augment proposal, as the review renders it:
 * „Vorhanden | Vorschlag" side by side.
 *
 * `state` is what the DEFAULT decision hangs off (never
 * silently overwrite): `new` means the entry has no value for the key (absent,
 * null, empty string, empty list) and the proposal is preselected; `changed`
 * means the entry HAS a value and the model wants a different one — the
 * default there is „Behalten".
 *
 * Fields the proposal leaves alone are not listed at all; `current` is absent
 * exactly when the key does not exist on the entry.
 */
export interface AugmentPropertyProposal {
  key: string;
  current?: unknown;
  proposed: unknown;
  state: "new" | "changed";
}

/**
 * The result of an augment run: a PROPOSAL for one existing
 * entry. Nothing is written — POST …/generate/augment/apply is the only
 * write, and it carries the DM's per-field/per-block decisions.
 *
 * The body travels as two whole markdown strings rather than as a block list:
 * the block model lives in the app (app/src/lib/blocks.ts) and is the same
 * one the Block-Composer edits, so splitting the proposal into blocks in the
 * app is the only way the review's decision units are guaranteed to be the
 * units the DM already knows. The server stays the authority for what is
 * WRITTEN (rev guard, one transaction), not for how the diff is cut.
 */
export interface AugmentResult {
  /** Address of the augmented entry, e.g. `npcs/fenn`. */
  path: string;
  kind: AugmentKind;
  /** The `rev` the run READ. Informational — the write sends the UI's rev. */
  rev: number;
  /** Only the keys the proposal adds or changes (see AugmentPropertyProposal). */
  properties: AugmentPropertyProposal[];
  /** The entry's body as the run read it — the „Vorher" side of the diff. */
  currentBody: string;
  /** The model's proposed body, complete (not a patch). */
  proposedBody: string;
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
 * decides which scenes exist, and then every scene and every suggested entry
 * is a call of its own. Each of those is a PART with a status, so a form
 * error costs that part and nothing else — and a finished part is reviewable
 * while its siblings are still running.
 *
 * The OUTLINE itself never travels: it is a purely internal step for error
 * reduction (PO, 15.09.) and is never offered for editing. What the client
 * gets is the part LIST — order, kind, title, status — because a status card
 * and „2 von 3 Szenen fertig" cannot be drawn without it.
 */
export interface GenerateJobPart {
  /** Stable key of the part; the retry endpoint addresses it (`scene:<id>`). */
  key: string;
  kind: "scene" | "npc" | "location";
  /** The id the outline gave this part — the scene/entry id. */
  id: string;
  /** Display title of the part; the id when the outline named none. */
  title: string;
  status: GenerateJobPartStatus;
  /** Why the part failed — the DM reads this next to „Erneut versuchen". */
  error?: string;
  /** The mechanical validation errors of a failed part, when there were any. */
  validationErrors?: string[];
  /** The raw reply of the failed attempt (capped) — the „was kam zurück" block. */
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
   * Summed over every provider call of every part, the outline included —
   * the review header shows it as „~N Tokens · M Aufrufe". `calls` counts
   * provider calls (a correction turn is one more).
   */
  totals: { inputTokens: number; outputTokens: number; calls: number };
}

// --- background generate jobs ----------------------------------------------

export const GENERATE_JOB_STATUSES = ["running", "done", "failed"] as const;
export type GenerateJobStatus = (typeof GENERATE_JOB_STATUSES)[number];

/**
 * What a generator job produces: scene drafts for a chapter, one
 * NPC file draft, or a PROPOSAL for an entry that already exists
 * (`augment`). There is still exactly ONE job per campaign; the
 * kind only tells the client which result field to read and which mode to
 * restore.
 */
export const GENERATE_JOB_KINDS = ["scene", "npc", "augment"] as const;
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
  /** Present iff status is "done" and kind is "augment". */
  augmentResult?: AugmentResult;
  /**
   * Address of the entry an `augment` run targets. Present for
   * that kind from the moment the job STARTS, so the app can show which entry
   * is being worked on while the run is still going.
   */
  target?: string;
  /** Present iff status is "failed". */
  error?: GenerateJobError;
  /**
   * Review edits kept server-side, keyed by the draft's campaign-relative
   * path (PATCH …/generate/job/:id/review) — so an edited draft survives a
   * reload as well. Empty until the DM edits something; applied ON TOP of
   * `result.scenes` (or of `npcResult.npc`) by the review UI.
   */
  draftEdits: Record<string, string>;
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
   * same state. `draftEdits` holds the edited TEXT; this holds the
   * decisions. Absent on a payload from an older server — the UI treats
   * that as "nothing decided yet".
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
  /**
   * Decision per suggested entry, keyed by the address it would be written
   * to (`npcs/grella`). A key that is absent is OPEN — the review's third
   * state, which is why "open" is not a value here.
   */
  entries: Record<string, GenerateReviewDecision>;
  /** Scene draft paths the DM dropped from the run — never written. */
  dropped: string[];
  /**
   * Augment run only: decision per PROPERTY key. `true` = übernehmen,
   * `false` = behalten; an absent key keeps the computed default (lib/augment
   * `defaultAccepted`), so a fresh review still starts where it always did.
   */
  fields: Record<string, boolean>;
  /** Augment run only: the same per body BLOCK id. */
  blocks: Record<string, boolean>;
  /**
   * The parts a PARTIAL accept already wrote: draft path -> the ADDRESS the
   * entry actually landed at (they differ for a scene, whose address is
   * `<chapter>/<id>`). A written part is read-only in the review and links
   * to the entry; the job disappears once every part is written, dropped or
   * rejected.
   */
  written: Record<string, string>;
}

/** What the DM decided about one suggested entry. */
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
 * The three kinds of campaign knowledge (PO decision):
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
 */
export interface NamingHint {
  /** The convention's `from` — the spelling that was found. */
  from: string;
  /** The convention's `to` — what should stand there instead. */
  to: string;
  /** Campaign-relative path of the draft the hit sits in. */
  path: string;
  /**
   * Where inside the draft: `"body"` together with a 1-based `line`, or the
   * name of the properties key (`"title"`, `"role"`, …) with `line` absent.
   */
  field: string;
  /** 1-based line number inside the markdown body; absent for a property. */
  line?: number;
  /** The line (or property value) the hit sits in, trimmed and capped. */
  excerpt: string;
}
