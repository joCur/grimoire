// Typed client for the Grimoire server API (endpoint list documented in
// server/src/server.ts). All response shapes come from @grimoire/shared —
// the format contract exists exactly once.

import type {
  CampaignSummary,
  CampaignTree,
  EntryResponse,
  GenerateJob,
  GenerateJobStarted,
  GeneratedStub,
  GlossaryEntry,
  GlossaryResponse,
  InstanceSettings,
  KnowledgeEntry,
  KnowledgeResponse,
  SearchResponse,
} from "@grimoire/shared/types";

export class ApiError extends Error {
  readonly status: number;
  /**
   * The server's JSON error body when there was one — the endpoints answer
   * `{ error, … }` and put the interesting parts next to it (`conflicts` on
   * 409, `validationErrors`/`rawReply`/`usage` on the generator's 422,
   * `rev` on a properties conflict).
   */
  readonly details: Record<string, unknown>;

  constructor(status: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/** Build the ApiError for a failed response, keeping the JSON error body. */
async function failure(what: string, response: Response): Promise<ApiError> {
  let details: Record<string, unknown> = {};
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === "object" && !Array.isArray(body)) {
      details = body as Record<string, unknown>;
    }
  } catch {
    // no/!JSON body — the status is all we know
  }
  const message = typeof details.error === "string" ? details.error : undefined;
  return new ApiError(response.status, `${what} → ${response.status}${message === undefined ? "" : `: ${message}`}`, details);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) throw await failure(`GET /api${path}`, response);
  return (await response.json()) as T;
}

/** PUT a JSON body and parse the JSON answer; a non-2xx becomes an ApiError. */
async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(`PUT /api${path}`, response);
  return (await response.json()) as T;
}

export function fetchCampaigns(): Promise<CampaignSummary[]> {
  return getJson<CampaignSummary[]>("/campaigns");
}

/**
 * The instance settings (issue #69) — today just the UI language. Server
 * state, deliberately not localStorage (quality floor), so the choice survives
 * a reload and is the same in the next browser.
 */
export function fetchSettings(): Promise<InstanceSettings> {
  return getJson<InstanceSettings>("/settings");
}

/** Store the UI language; `null` goes back to following `navigator.language`. */
export async function putSettings(patch: InstanceSettings): Promise<InstanceSettings> {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await failure("PUT /api/settings", response);
  return (await response.json()) as InstanceSettings;
}

export function fetchTree(campaign: string): Promise<CampaignTree> {
  return getJson<CampaignTree>(`/${encodeURIComponent(campaign)}/tree`);
}

export function fetchEntry(campaign: string, path: string): Promise<EntryResponse> {
  return getJson<EntryResponse>(
    `/${encodeURIComponent(campaign)}/entry?path=${encodeURIComponent(path)}`,
  );
}

/**
 * Fuzzy search over scenes/npcs/locations/chapters (max 20 results).
 * The server 400s on an empty/whitespace query — callers must not send one.
 */
export function fetchSearch(campaign: string, q: string): Promise<SearchResponse> {
  return getJson<SearchResponse>(
    `/${encodeURIComponent(campaign)}/search?q=${encodeURIComponent(q)}`,
  );
}

/**
 * Campaign version counter (issue #8) — bumped by every server-side write, in
 * the same transaction as the change (DECISIONS #9/#13); polled by
 * useCampaignVersion.
 *
 * `build` (issue #24) is the server's build id, riding along on this poll so
 * the handshake costs no extra request. Optional in the type because an older
 * server (or a stale tab talking to one) may not send it.
 */
export interface VersionResponse {
  version: number;
  build?: string;
}

export function fetchVersion(campaign: string): Promise<VersionResponse> {
  return getJson<VersionResponse>(`/${encodeURIComponent(campaign)}/version`);
}

/**
 * The campaign's glossary as a LIST of terms (issue #57): since the SQLite
 * migration it is a table, not a markdown blob. The reading view still opens
 * `glossary` as an entry — that rendering comes from these same rows —
 * but anything that wants the terms themselves reads this.
 */
export function fetchGlossary(campaign: string): Promise<GlossaryResponse> {
  return getJson<GlossaryResponse>(`/${encodeURIComponent(campaign)}/glossary`);
}

/**
 * Replace the whole glossary. The list is short and is edited as a whole, so
 * the ARRAY ORDER is the stored order — that is also how the settings page
 * reorders (issue #53) — and `rev` is the guard token of the list, read from
 * the `fetchGlossary` the editor is showing. A stale one answers 409.
 */
export function putGlossary(
  campaign: string,
  entries: GlossaryEntry[],
  rev: number,
): Promise<GlossaryResponse> {
  return putJson<GlossaryResponse>(`/${encodeURIComponent(campaign)}/glossary`, {
    entries,
    rev,
  });
}

/**
 * The campaign's KNOWLEDGE the generator has to apply (issue #53) — naming
 * conventions, facts, style rules. Same whole-list-plus-`rev` contract as the
 * glossary, on purpose: the DM edits both on the same page.
 */
export function fetchKnowledge(campaign: string): Promise<KnowledgeResponse> {
  return getJson<KnowledgeResponse>(`/${encodeURIComponent(campaign)}/knowledge`);
}

/** Replace the whole knowledge list; see putGlossary for the `rev` rule. */
export function putKnowledge(
  campaign: string,
  entries: KnowledgeEntry[],
  rev: number,
): Promise<KnowledgeResponse> {
  return putJson<KnowledgeResponse>(`/${encodeURIComponent(campaign)}/knowledge`, {
    entries,
    rev,
  });
}

// --- write endpoints (session/log, issue #9) --------------------------------

/**
 * Set/delete properties keys of one entry (issue #5 endpoint, used by the
 * scene-status control of issue #28). `patch` is flat: a value sets the key,
 * `null` deletes it. `rev` is the optimistic-concurrency token and must be
 * the one from the EntryResponse the UI is showing — when the entry changed on
 * disk since, the server answers 409 with the current `rev` in
 * `ApiError.details` and writes nothing.
 *
 * `locationName` is the only field that is not a properties key: the display
 * name for the Ort a scene's `location` creates (issue #100 follow-up — the
 * properties form slugs free text into `location` and sends the typed text
 * here). The server applies it when it INSERTS the row and ignores it
 * otherwise, so an existing location is never renamed through a scene.
 */
export async function patchProperties(
  campaign: string,
  input: {
    path: string;
    rev: number;
    patch: Record<string, unknown>;
    locationName?: string;
  },
): Promise<EntryResponse> {
  const path = `/${encodeURIComponent(campaign)}/properties`;
  const response = await fetch(`/api${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await failure(`PATCH /api${path}`, response);
  return (await response.json()) as EntryResponse;
}

/**
 * Replace the markdown BODY of one entry, properties untouched (issue #15 —
 * the reading view's edit mode). `body` is what GET /entry hands out: the file
 * without its properties block. `rev` is the same optimistic-concurrency
 * token as above and must come from the EntryResponse the editor was seeded
 * from — on a mismatch the server answers 409 with the current `rev` in
 * `ApiError.details` and writes nothing.
 */
export async function putEntryBody(
  campaign: string,
  path: string,
  body: string,
  rev: number,
): Promise<EntryResponse> {
  const url = `/${encodeURIComponent(campaign)}/entry`;
  const response = await fetch(`/api${url}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, rev, body }),
  });
  if (!response.ok) throw await failure(`PUT /api${url}`, response);
  return (await response.json()) as EntryResponse;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await failure(`POST /api${path}`, response);
  return (await response.json()) as T;
}

/**
 * The ACTIVE session (issue #40), or null when none is running — the server's
 * 404 is the normal "no session" answer, never an error state in the UI.
 *
 * The app must NOT derive the session from its own date: a session that
 * runs past midnight lives in yesterday's session, and a browser in another
 * timezone than the server would guess wrong. The response carries
 * `startedMs`/`endedMs` (epoch, resolved by the server), which is what makes
 * the live runtime correct.
 */
export async function fetchActiveSession(campaign: string): Promise<EntryResponse | null> {
  return fetchSession(campaign, false);
}

/**
 * The LAST STARTED session, ended or not (`?includeEnded=1`) — the REVIEW's
 * session. Same reason the app must not guess it: an evening that ran past
 * midnight was ended in yesterday's session, so "today's session" would harvest
 * nothing (or the wrong log). null when the campaign has no session at all.
 */
export async function fetchLastStartedSession(campaign: string): Promise<EntryResponse | null> {
  return fetchSession(campaign, true);
}

async function fetchSession(
  campaign: string,
  includeEnded: boolean,
): Promise<EntryResponse | null> {
  const path = `/${encodeURIComponent(campaign)}/session${includeEnded ? "?includeEnded=1" : ""}`;
  const response = await fetch(`/api${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(`GET /api${path}`, response);
  return (await response.json()) as EntryResponse;
}

/**
 * Start a NEW session (issue #58): "beenden" is final, so a start after an
 * ended session creates the next one of the day (`<date>-2`, `-3` …) with an
 * empty log. Idempotent only while today's session is the RUNNING one; the
 * single 409 left is `session_running` — an OLDER session is still open (see
 * sessionStartConflict).
 */
export function startSession(campaign: string): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/session/start`);
}

/** Set `ended` in the ACTIVE session (404 when there is none). */
export function endSession(campaign: string): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/session/end`);
}

/**
 * Pause the ACTIVE session (issue #40 AK8): the server opens a `pauses`
 * interval — the runtime really stops — and writes the `— Pause` log line.
 * Idempotent; 404 when no session is running.
 */
export function pauseSession(campaign: string): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/session/pause`);
}

/**
 * "Weiter" — close the open pause interval and log `— Weiter`. It ends a
 * PAUSE; an ENDED session is never re-opened (issue #58).
 */
export function continueSession(campaign: string): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/session/continue`);
}

/**
 * DELETE the active session — the undo of a mis-clicked "Session
 * starten" (issue #40 AK7). Only an EMPTY session may be discarded; the
 * server answers 409 (`code: "session_not_empty"`) otherwise and 404 when
 * nothing is running. Returns the path of the entry that is gone.
 */
export function discardSession(campaign: string): Promise<{ path: string }> {
  return postJson<{ path: string }>(`/${encodeURIComponent(campaign)}/session/discard`);
}

/**
 * Append a line to the campaign's inbox (mobile capture, issue #11);
 * the server creates the session on the first log entry.
 */
export function appendInbox(campaign: string, text: string): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/inbox`, { text });
}

/**
 * Append a log line to the ACTIVE session (404 when none runs) — which may be
 * yesterday's session when the session ran past midnight; the server picks it.
 * With a sceneId the server also maintains `scenes_played`.
 */
export function appendLog(
  campaign: string,
  text: string,
  sceneId?: string,
): Promise<EntryResponse> {
  return postJson<EntryResponse>(
    `/${encodeURIComponent(campaign)}/log`,
    sceneId === undefined ? { text } : { text, sceneId },
  );
}

// --- review actions (issue #10) ---------------------------------------------

/**
 * Mark a log line as reviewed: the server adds the short hash of the RAW
 * line to the session's `reviewed` list (idempotent). Returns the session.
 */
export function markLogLineSeen(
  campaign: string,
  path: string,
  line: string,
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/review/seen`, { path, line });
}

/**
 * Append `- [ ] text` under `## Offene Fäden` of the chapter's chapter entry
 * (section created when missing). Returns the chapter entry.
 */
export function adoptThread(
  campaign: string,
  chapter: string,
  text: string,
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/review/thread`, {
    chapter,
    text,
  });
}

/**
 * Create the npc entry for `id` (status: unknown, note under `## Notizen`) —
 * or answer with the entry the id already has (issue #70). Idempotent: the
 * goal is "this id has an entry", so an existing one is LINKED, never
 * overwritten, and an empty one (a reference created it) is filled in.
 */
export function ensureNpc(
  campaign: string,
  id: string,
  name?: string,
  note?: string,
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/review/npc-stub`, {
    id,
    ...(name === undefined ? {} : { name }),
    ...(note === undefined ? {} : { note }),
  });
}

/**
 * Rewrite an inbox line to `- [x] …` (the one documented exception to the
 * inbox's append-only rule). Idempotent; the line must match byte for byte.
 * Returns inbox.
 */
export function markInboxLineDone(campaign: string, line: string): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/review/inbox-done`, { line });
}

// --- creating content (issue #56) --------------------------------------------
//
// Five POSTs with one shape: the DM types a NAME, the server derives the id
// (the shared slug rule, `@grimoire/shared/slug`) and answers with the created
// DOCUMENT — so the caller can navigate straight into it. `id` is optional and
// exists for exactly one flow: taking the `slug_taken` 409's `suggestion` in
// one click. Errors arrive as ApiError; a 409 carries
// `{ code: "slug_taken", id, suggestion, path }` in `details` (lib/create.ts
// turns that into the German sentence the dialogs show).

/** The campaign the cold start creates — `id` is what the app navigates to. */
export function createCampaign(input: {
  name: string;
  description?: string;
  id?: string;
}): Promise<CampaignSummary> {
  return postJson<CampaignSummary>("/campaigns", {
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

/** A new chapter; `goal` lands under `## Ziel des Kapitels` when given. */
export function createChapter(
  campaign: string,
  input: { title: string; goal?: string; id?: string },
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/chapters`, {
    title: input.title,
    ...(input.goal === undefined ? {} : { goal: input.goal }),
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

/** A new scene in an EXISTING chapter (the server 400s on an unknown one). */
export function createScene(
  campaign: string,
  input: { title: string; chapter: string; id?: string },
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/scenes`, {
    title: input.title,
    chapter: input.chapter,
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

/** A new NPC entry — an EMPTY one a reference left behind is filled (#70). */
export function createNpc(
  campaign: string,
  input: { name: string; id?: string },
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/npcs`, {
    name: input.name,
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

/** A new location entry, same rules as the NPC one. */
export function createLocation(
  campaign: string,
  input: { name: string; id?: string },
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/locations`, {
    name: input.name,
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

// --- rename with reference cascade (issue #30) -------------------------------

/** The entity kinds the rename endpoint accepts (server: store/rename.ts). */
export type RenameKind = "npc" | "location" | "scene" | "chapter";

/**
 * The answer of POST /:campaign/rename — the moved entry (or, for a chapter,
 * the chapter itself) plus every entry whose bytes changed, named by its path
 * AFTER the rename. With `dryRun` nothing was written and this is the plan
 * the dialog previews. (Declared here rather than in @grimoire/shared: the
 * rename ticket keeps its footprint to server/ and app/.)
 */
/** The kinds of reference `GET /usage` counts (server: store/usage.ts). */
export type UsageRef =
  | "sceneNpcs"
  | "npcRelations"
  | "sceneLocation"
  | "scenesPlayed"
  | "logEntries"
  | "chapterScenes"
  | "chapterNpcs"
  | "chapterLocations"
  /** A body text says `[[<id>]]` (issue #68). */
  | "bodyRefs";

/** One referencing entry, with how many of its rows point at the entity. */
export interface UsageSite {
  kind: "scene" | "npc" | "location" | "session" | "chapter" | "campaign";
  id: string;
  title: string;
  path: string;
  count: number;
}

export interface UsageGroup {
  ref: UsageRef;
  /** Referencing ROWS, not entries. */
  count: number;
  sites: UsageSite[];
}

/**
 * The answer of GET /:campaign/usage — where one entity is referenced
 * (issue #60). The rename's response carries the same report, which is what
 * the dialog previews before it commits.
 */
export interface UsageReport {
  kind: RenameKind;
  id: string;
  path: string;
  total: number;
  groups: UsageGroup[];
}

export interface RenameResult {
  renamed: { from: string; to: string };
  changed: string[];
  /** Reference counts of the OLD id — the preview's German summary. */
  usage: UsageReport;
  dryRun?: boolean;
}

/**
 * Where an entity is referenced, straight from the endpoint (issue #60).
 * The rename dialog does not need this — its `dryRun` answer already carries
 * the identical report — but a caller that only wants the numbers can ask.
 */
export function fetchUsage(
  campaign: string,
  kind: RenameKind,
  id: string,
): Promise<UsageReport> {
  return getJson<UsageReport>(
    `/${encodeURIComponent(campaign)}/usage?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
  );
}

/**
 * Rename an entity id and let the server drag all references along
 * (properties npcs/location/chapter, session scenes_played, `## Beziehungen`
 * entries, log scene markers — prose is deliberately left alone).
 *
 * `dryRun: true` returns the very same plan without writing a byte: same code
 * path, so a preview that succeeds is a rename that will succeed. Errors
 * arrive as ApiError — 409 carries the blocking `path` in `details`.
 */
export function renameEntity(
  campaign: string,
  input: { kind: RenameKind; oldId: string; newId: string; dryRun?: boolean },
): Promise<RenameResult> {
  return postJson<RenameResult>(`/${encodeURIComponent(campaign)}/rename`, {
    kind: input.kind,
    oldId: input.oldId,
    newId: input.newId,
    ...(input.dryRun === true ? { dryRun: true } : {}),
  });
}

// --- generator (issue #12) ---------------------------------------------------

/**
 * Start a generator run for one chapter — a BACKGROUND job since issue #19:
 * the server answers 202 with the job id and the result is fetched via
 * fetchGenerateJob. Nothing is written (generator/README.md); `newChapter`
 * allows a chapter directory that does not exist yet (created by
 * applyDrafts below).
 *
 * A 409 is NOT an error here: it means a job for this campaign is already
 * running, and its id is the answer to "start a run" — the view adopts the
 * running job instead of showing a failure. Everything else throws as
 * usual; worth handling are 503 (no provider configured — no API key), 404
 * (unknown chapter) and 400.
 *
 * The run's own failure (the 422 of issues #18/#20 with `rawReply`, `usage`
 * and possibly `validationErrors`) never comes back from THIS call — it
 * lands in the job's `error.body`.
 *
 * `chapterTitle` rides along for a `newChapter` run and is stored ON the job.
 * It is what makes the accept independent of this browser: the review state is
 * persistent, so the accept regularly happens in a tab that never saw this
 * form.
 */
export async function startGenerateJob(
  campaign: string,
  input: { chapter: string; sourceText: string; newChapter?: boolean; chapterTitle?: string },
): Promise<GenerateJobStarted> {
  const path = `/${encodeURIComponent(campaign)}/generate`;
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chapter: input.chapter,
      sourceText: input.sourceText,
      ...(input.newChapter === true ? { newChapter: true } : {}),
      ...(input.newChapter === true && input.chapterTitle !== undefined
        ? { chapterTitle: input.chapterTitle }
        : {}),
    }),
  });
  if (!response.ok) {
    const error = await failure(`POST /api${path}`, response);
    if (error.status === 409 && typeof error.details.jobId === "string") {
      return { jobId: error.details.jobId };
    }
    throw error;
  }
  return (await response.json()) as GenerateJobStarted;
}

/**
 * Start an NPC run (issue #21): source material in, ONE NPC draft out.
 * Same job model as the scene run — 202 { jobId }, the result is fetched via
 * fetchGenerateJob (`kind: "npc"`, `npcResult`), and a 409 that carries a
 * jobId means "a generator job is already running for this campaign" and is
 * adopted instead of shown as an error.
 *
 * `id` is optional: empty means the model picks the id. A 409 WITHOUT a jobId
 * is the other collision — the pinned id's entry already exists (never
 * overwritten); its `details.path` names the entry.
 */
export async function startGenerateNpcJob(
  campaign: string,
  input: { sourceText: string; id?: string },
): Promise<GenerateJobStarted> {
  const path = `/${encodeURIComponent(campaign)}/generate/npc`;
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceText: input.sourceText,
      ...(input.id === undefined || input.id === "" ? {} : { id: input.id }),
    }),
  });
  if (!response.ok) {
    const error = await failure(`POST /api${path}`, response);
    if (error.status === 409 && typeof error.details.jobId === "string") {
      return { jobId: error.details.jobId };
    }
    throw error;
  }
  return (await response.json()) as GenerateJobStarted;
}

/**
 * Start an augment run („Mit KI ergänzen", issue #36): an entry that already
 * exists plus source material and/or an instruction, and the model proposes
 * the filled-in version. Same job model as the create runs — 202 { jobId },
 * the proposal is fetched via fetchGenerateJob (`kind: "augment"`,
 * `augmentResult`), and a 409 carrying a jobId means „a generator job is
 * already running for this campaign" and is ADOPTED instead of shown as an
 * error (the review then simply belongs to that job).
 *
 * At least one of sourceText/instruction has to carry text; the dialog
 * enforces it and the server answers 400 for the rest.
 */
export async function startAugmentJob(
  campaign: string,
  input: { path: string; sourceText?: string; instruction?: string },
): Promise<GenerateJobStarted> {
  const path = `/${encodeURIComponent(campaign)}/generate/augment`;
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: input.path,
      ...(input.sourceText === undefined || input.sourceText === ""
        ? {}
        : { sourceText: input.sourceText }),
      ...(input.instruction === undefined || input.instruction === ""
        ? {}
        : { instruction: input.instruction }),
    }),
  });
  if (!response.ok) {
    const error = await failure(`POST /api${path}`, response);
    if (error.status === 409 && typeof error.details.jobId === "string") {
      return { jobId: error.details.jobId };
    }
    throw error;
  }
  return (await response.json()) as GenerateJobStarted;
}

/**
 * Accept a reviewed augment proposal (issue #36): the properties fields the
 * DM took and the body they assembled from the accepted blocks, written in
 * ONE transaction against `rev`. A 409 is the ordinary conflict protocol
 * (ADR #4) and arrives as ApiError — the caller re-reads and tries again.
 * `jobId` discards the job in the same transaction.
 */
export function applyAugment(
  campaign: string,
  input: {
    path: string;
    rev: number;
    properties?: Record<string, unknown>;
    body?: string;
    jobId?: string;
  },
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/${encodeURIComponent(campaign)}/generate/augment/apply`, {
    path: input.path,
    rev: input.rev,
    ...(input.properties === undefined ? {} : { properties: input.properties }),
    ...(input.body === undefined ? {} : { body: input.body }),
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
  });
}

/**
 * The campaign's generate job, or null when there is none (the server's 404
 * is the normal "nothing running, nothing to restore" answer — never an
 * error state in the UI). A `null` after a job WAS there means it is gone:
 * applied or discarded. A server restart does NOT lose it any more (issue
 * #23): a finished job comes back, and one that was still running comes back
 * as `failed` with a message saying so.
 */
export async function fetchGenerateJob(campaign: string): Promise<GenerateJob | null> {
  const path = `/${encodeURIComponent(campaign)}/generate/job`;
  const response = await fetch(`/api${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(`GET /api${path}`, response);
  return (await response.json()) as GenerateJob;
}

/** Discard the campaign's generate job ("Verwerfen"). A missing job is fine. */
export async function deleteGenerateJob(campaign: string): Promise<void> {
  const path = `/${encodeURIComponent(campaign)}/generate/job`;
  const response = await fetch(`/api${path}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw await failure(`DELETE /api${path}`, response);
  }
}


/**
 * Store part of the REVIEW STATE on the job (issue #97). Everything merges,
 * so this sends only what changed: the text of the draft being typed in
 * (debounced by the caller), the decision that was just made, the drops.
 *
 * `rev` is the job's review rev as the caller read it — a 409
 * `rev_conflict` (with the current rev in `ApiError.details`) means a second
 * tab decided first and nothing was written; the caller reloads the job.
 */
export async function patchJobReview(
  campaign: string,
  jobId: string,
  rev: number,
  patch: {
    edits?: Record<string, string>;
    entries?: Record<string, "accepted" | "rejected" | null>;
    dropped?: string[];
    fields?: Record<string, boolean | null>;
    blocks?: Record<string, boolean | null>;
  },
): Promise<GenerateJob> {
  const path = `/${encodeURIComponent(campaign)}/generate/job/${encodeURIComponent(jobId)}/review`;
  const response = await fetch(`/api${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev, ...patch }),
  });
  if (!response.ok) throw await failure(`PATCH /api${path}`, response);
  return (await response.json()) as GenerateJob;
}

/**
 * Accept PART of a finished run (issue #97): „Diesen übernehmen" for one
 * scene or one suggested entry, „Alle übernehmen" without a selection.
 * Answers what it wrote (draft path -> the address it landed at) and
 * whether the job is gone because nothing is open any more. `rev` is the
 * review rev as the caller read it: a 409 `rev_conflict` means another tab
 * decided in between and nothing was written. A 409 with
 * `details.conflicts` is the ordinary write conflict, as for the whole-run
 * apply.
 */
export function acceptJobParts(
  campaign: string,
  jobId: string,
  rev: number,
  input: { paths?: string[]; chapter?: string; chapterTitle?: string } = {},
): Promise<{ written: Record<string, string>; jobDeleted: boolean }> {
  const path = `/${encodeURIComponent(campaign)}/generate/job/${encodeURIComponent(jobId)}/accept`;
  return postJson<{ written: Record<string, string>; jobDeleted: boolean }>(path, {
    rev,
    ...(input.paths === undefined ? {} : { paths: input.paths }),
    ...(input.chapter === undefined || input.chapterTitle === undefined
      ? {}
      : { chapter: input.chapter, chapterTitle: input.chapterTitle }),
  });
}

/**
 * „Erneut versuchen" for ONE part of a pipelined scene run (issue #102).
 * Restarts that part only — the outline stays, the finished parts stay
 * reviewable — and answers the job with the part back in `running`, so the
 * view can seed its cache without an extra read.
 */
export function retryJobPart(
  campaign: string,
  jobId: string,
  key: string,
): Promise<GenerateJob> {
  const path =
    `/${encodeURIComponent(campaign)}/generate/job/${encodeURIComponent(jobId)}` +
    `/parts/${encodeURIComponent(key)}/retry`;
  return postJson<GenerateJob>(path, {});
}

/**
 * Write the reviewed drafts (all or nothing): the possibly edited scene
 * markdown plus the accepted stubs. With `chapter` + `chapterTitle` the
 * server also creates `<chapter>` when it is missing.
 * ApiError 409 carries the existing paths in `details.conflicts` — nothing
 * was written then.
 *
 * `jobId` hands the server the job these drafts came from: a successful
 * apply discards it (the drafts are written — nothing left to restore).
 */
export function applyDrafts(
  campaign: string,
  input: {
    scenes: Array<{ path: string; markdown: string }>;
    stubs: GeneratedStub[];
    chapter?: string;
    chapterTitle?: string;
    jobId?: string;
  },
): Promise<{ written: string[] }> {
  return postJson<{ written: string[] }>(`/${encodeURIComponent(campaign)}/generate/apply`, {
    scenes: input.scenes,
    stubs: input.stubs,
    ...(input.chapter === undefined || input.chapterTitle === undefined
      ? {}
      : { chapter: input.chapter, chapterTitle: input.chapterTitle }),
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
  });
}

/**
 * Write the reviewed NPC draft (issue #21) — the same apply endpoint as the
 * scene drafts: it re-validates server-side (path, id, status, parseable
 * properties), answers 409 with `details.conflicts` when the entry already
 * exists (nothing written), and drops the job the draft came from.
 */
export function applyNpcDraft(
  campaign: string,
  input: { npc: { path: string; markdown: string }; jobId?: string },
): Promise<{ written: string[] }> {
  return postJson<{ written: string[] }>(`/${encodeURIComponent(campaign)}/generate/apply`, {
    npc: input.npc,
    ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
  });
}
