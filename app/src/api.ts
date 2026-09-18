// Typed client for the Grimoire server API (endpoint list documented in
// server/src/server.ts). All response shapes come from @grimoire/shared —
// the format contract exists exactly once.

import type {
  CampaignSummary,
  CampaignTree,
  DraftEdit,
  EntryResponse,
  GenerateJob,
  GenerateJobStarted,
  GlossaryEntry,
  GlossaryResponse,
  InboxResponse,
  InstanceSettings,
  KnowledgeEntry,
  KnowledgeResponse,
  SearchResponse,
  SessionListEntry,
  SessionResponse,
} from "@grimoire/shared/types";

import { encodeAddress } from "@/lib/address";

export class ApiError extends Error {
  readonly status: number;
  /**
   * The server's JSON error body when there was one — the endpoints answer
   * `{ error, … }` and put the interesting parts next to it (`code`,
   * `validationErrors`/`rawReply`/`usage` on the generator's 422, and on a
   * write conflict the current `rev` plus the current `entry` — read out by
   * `revConflict` below).
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
 * The instance settings — today just the UI language. Server
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
  return getJson<CampaignTree>(`/campaigns/${encodeURIComponent(campaign)}/tree`);
}

export function fetchEntry(campaign: string, path: string): Promise<EntryResponse> {
  return getJson<EntryResponse>(entriesUrl(campaign, path));
}

/** The request path of one entry: its address is the URL path. */
function entriesUrl(campaign: string, path: string): string {
  return `/campaigns/${encodeURIComponent(campaign)}/entries/${encodeAddress(path)}`;
}

/**
 * Fuzzy search over scenes/npcs/locations/chapters (max 20 results).
 * The server 400s on an empty/whitespace query — callers must not send one.
 */
export function fetchSearch(campaign: string, q: string): Promise<SearchResponse> {
  return getJson<SearchResponse>(
    `/campaigns/${encodeURIComponent(campaign)}/search?q=${encodeURIComponent(q)}`,
  );
}

/**
 * Campaign version counter — bumped by every server-side write, in
 * the same transaction as the change (DECISIONS #9/#13); polled by
 * useCampaignVersion.
 *
 * `build` is the server's build id, riding along on this poll so
 * the handshake costs no extra request. Optional in the type because an older
 * server (or a stale tab talking to one) may not send it.
 */
export interface VersionResponse {
  version: number;
  build?: string;
}

export function fetchVersion(campaign: string): Promise<VersionResponse> {
  return getJson<VersionResponse>(`/campaigns/${encodeURIComponent(campaign)}/version`);
}

/**
 * The campaign's glossary as a LIST of terms: it is a table, not a markdown
 * blob, and this is the only way to read it.
 */
export function fetchGlossary(campaign: string): Promise<GlossaryResponse> {
  return getJson<GlossaryResponse>(`/campaigns/${encodeURIComponent(campaign)}/glossary`);
}

/**
 * Replace the whole glossary. The list is short and is edited as a whole, so
 * the ARRAY ORDER is the stored order — that is also how the settings page
 * reorders — and `rev` is the guard token of the list, read from
 * the `fetchGlossary` the editor is showing. A stale one answers 409.
 */
export function putGlossary(
  campaign: string,
  entries: GlossaryEntry[],
  rev: number,
): Promise<GlossaryResponse> {
  return putJson<GlossaryResponse>(`/campaigns/${encodeURIComponent(campaign)}/glossary`, {
    entries,
    rev,
  });
}

/**
 * The campaign's KNOWLEDGE the generator has to apply — naming
 * conventions, facts, style rules. Same whole-list-plus-`rev` contract as the
 * glossary, on purpose: the DM edits both on the same page.
 */
export function fetchKnowledge(campaign: string): Promise<KnowledgeResponse> {
  return getJson<KnowledgeResponse>(`/campaigns/${encodeURIComponent(campaign)}/knowledge`);
}

/** Replace the whole knowledge list; see putGlossary for the `rev` rule. */
export function putKnowledge(
  campaign: string,
  entries: KnowledgeEntry[],
  rev: number,
): Promise<KnowledgeResponse> {
  return putJson<KnowledgeResponse>(`/campaigns/${encodeURIComponent(campaign)}/knowledge`, {
    entries,
    rev,
  });
}

// --- the one write path of an entry ----------------------------------------

/**
 * What one guarded write carries. Only the fields that are present are
 * written, so the same request serves a properties-only patch, a text-only
 * one and a dialog that edits both in one transaction.
 *
 * `properties` is flat — a value sets the key, `null` deletes it, an unknown
 * key is a 400. `body` is the markdown GET hands out — the entry's text, with
 * its properties beside it. Neither field present is a 400
 * `nothing_to_write`.
 *
 * `rev` is the optimistic-concurrency token of the entry the editing session
 * started from. When the row moved since, the server writes NOTHING and
 * answers 409 with its current version AND the current entry — `revConflict`
 * reads both out. `force: true` writes the given fields on top of the current
 * row instead, which is the deliberate force action of the conflict UI.
 *
 * A reference in the patch — `chapter`, `location`, an `npcs` entry — has to
 * name an entry that exists; the server answers 400 with the code the app
 * turns into its "create it first" sentence and writes nothing.
 *
 * Defined here rather than in @grimoire/shared until the shared package
 * carries the request type.
 */
export interface PatchEntryRequest {
  rev: number;
  properties?: Record<string, unknown>;
  body?: string;
  force?: boolean;
}

/** The single write path of one entry. */
export async function patchEntry(
  campaign: string,
  path: string,
  request: PatchEntryRequest,
): Promise<EntryResponse> {
  const url = entriesUrl(campaign, path);
  const response = await fetch(`/api${url}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw await failure(`PATCH /api${url}`, response);
  return (await response.json()) as EntryResponse;
}

/** The server's state at the moment it refused the write. */
export interface RevConflict {
  /** The row's current version — what a retry would have to carry. */
  rev: number;
  /**
   * The current entry, so the UI can show and adopt what is stored without a
   * second request. Undefined when the 409 body did not carry one (an older
   * server, or a write path that only reports the version) — the caller then
   * degrades to re-reading the entry itself.
   */
  entry?: EntryResponse;
}

/**
 * Read a write conflict out of a rejection: the 409 of every guarded write,
 * with the version and entry the server answered with. `undefined` for
 * anything else, so a caller can branch on it without knowing the status.
 *
 * Degrades per the house rule: a 409 whose body is missing or shaped
 * differently still counts as a conflict, just without the details.
 */
export function revConflict(error: unknown): RevConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const { rev, entry } = error.details;
  return {
    rev: typeof rev === "number" ? rev : Number.NaN,
    ...(isEntryResponse(entry) ? { entry } : {}),
  };
}

function isEntryResponse(value: unknown): value is EntryResponse {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<EntryResponse>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.rev === "number"
  );
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
 * The ACTIVE session, or null when none is running — the server's
 * 404 is the normal "no session" answer, never an error state in the UI.
 *
 * The app must NOT derive the session from its own date: a session that
 * runs past midnight lives in yesterday's session, and a browser in another
 * timezone than the server would guess wrong. The response carries
 * `startedMs`/`endedMs` and the same reading per pause (epoch, resolved by the
 * server), which is what makes the live runtime correct.
 */
export async function fetchActiveSession(campaign: string): Promise<SessionResponse | null> {
  return currentSession(campaign, false);
}

/**
 * The LAST STARTED session, ended or not (`?includeEnded=1`) — the REVIEW's
 * session. Same reason the app must not guess it: an evening that ran past
 * midnight was ended in yesterday's session, so "today's session" would harvest
 * nothing (or the wrong log). null when the campaign has no session at all.
 */
export async function fetchLastStartedSession(campaign: string): Promise<SessionResponse | null> {
  return currentSession(campaign, true);
}

async function currentSession(
  campaign: string,
  includeEnded: boolean,
): Promise<SessionResponse | null> {
  const path = `/campaigns/${encodeURIComponent(campaign)}/session${includeEnded ? "?includeEnded=1" : ""}`;
  const response = await fetch(`/api${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(`GET /api${path}`, response);
  return (await response.json()) as SessionResponse;
}

/** ONE session by its id — the reading page of a past evening. */
export function fetchSession(campaign: string, id: string): Promise<SessionResponse> {
  return getJson<SessionResponse>(
    `/campaigns/${encodeURIComponent(campaign)}/sessions/${encodeURIComponent(id)}`,
  );
}

/** The campaign's sessions, newest first — id and the two timestamps only. */
export function fetchSessions(campaign: string): Promise<SessionListEntry[]> {
  return getJson<SessionListEntry[]>(`/campaigns/${encodeURIComponent(campaign)}/sessions`);
}

/**
 * Start a NEW session: "beenden" is final, so a start after an
 * ended session creates the next one of the day with an
 * empty log. Idempotent only while today's session is the RUNNING one; the
 * single 409 left is `session_running` — an OLDER session is still open (see
 * sessionStartConflict).
 */
export function startSession(campaign: string): Promise<SessionResponse> {
  return postJson<SessionResponse>(`/campaigns/${encodeURIComponent(campaign)}/session/start`);
}

/** Set `ended` on the ACTIVE session (404 when there is none). */
export function endSession(campaign: string): Promise<SessionResponse> {
  return postJson<SessionResponse>(`/campaigns/${encodeURIComponent(campaign)}/session/end`);
}

/**
 * Pause the ACTIVE session: the server opens a `pauses`
 * interval — the runtime really stops — and writes the pause log row.
 * Idempotent; 404 when no session is running.
 */
export function pauseSession(campaign: string): Promise<SessionResponse> {
  return postJson<SessionResponse>(`/campaigns/${encodeURIComponent(campaign)}/session/pause`);
}

/**
 * Close the open pause interval and log the resume row. It ends a
 * PAUSE; an ENDED session is never re-opened.
 */
export function continueSession(campaign: string): Promise<SessionResponse> {
  return postJson<SessionResponse>(`/campaigns/${encodeURIComponent(campaign)}/session/continue`);
}

/**
 * DELETE the active session — the undo of a mis-clicked start. Only an EMPTY
 * session may be discarded; the server answers 409
 * (`code: "session_not_empty"`) otherwise and 404 when nothing is running.
 * The caller needs nothing from the answer: after this there is no session to
 * show, and which older one becomes the last started is the server's answer.
 */
export function discardSession(campaign: string): Promise<{ id?: string }> {
  return postJson<{ id?: string }>(`/campaigns/${encodeURIComponent(campaign)}/session/discard`);
}

/** The campaign's inbox as ROWS — ideas, not text (list plus its `rev`). */
export function fetchInbox(campaign: string): Promise<InboxResponse> {
  return getJson<InboxResponse>(`/campaigns/${encodeURIComponent(campaign)}/inbox`);
}

/** Throw one idea into the campaign's inbox (mobile capture). */
export function appendInbox(campaign: string, text: string): Promise<InboxResponse> {
  return postJson<InboxResponse>(`/campaigns/${encodeURIComponent(campaign)}/inbox`, { text });
}

/**
 * Append a log row to the ACTIVE session (404 when none runs) — which may be
 * yesterday's session when the session ran past midnight; the server picks it.
 * With a sceneId the server also maintains the played scenes.
 */
export function appendLog(
  campaign: string,
  text: string,
  sceneId?: string,
): Promise<SessionResponse> {
  return postJson<SessionResponse>(
    `/campaigns/${encodeURIComponent(campaign)}/log`,
    sceneId === undefined ? { text } : { text, sceneId },
  );
}

// --- review actions ---------------------------------------------------------

/**
 * Mark ONE log row as reviewed, named by the session and the row's id
 * (idempotent). Returns the session.
 */
export function markLogLineSeen(
  campaign: string,
  sessionId: string,
  logId: string,
): Promise<SessionResponse> {
  return postJson<SessionResponse>(`/campaigns/${encodeURIComponent(campaign)}/review/seen`, {
    sessionId,
    logId,
  });
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
  return postJson<EntryResponse>(`/campaigns/${encodeURIComponent(campaign)}/review/thread`, {
    chapter,
    text,
  });
}

/**
 * Create the npc entry for `id` (status: unknown, note under `## Notizen`) —
 * or answer with the entry the id already has. Idempotent: the
 * goal is "this id has an entry", so an existing one is LINKED, never
 * overwritten, and an empty one — created and never filled in — is filled in.
 */
export function ensureNpc(
  campaign: string,
  id: string,
  name?: string,
  note?: string,
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/campaigns/${encodeURIComponent(campaign)}/review/npc-stub`, {
    id,
    ...(name === undefined ? {} : { name }),
    ...(note === undefined ? {} : { note }),
  });
}

/** Tick ONE inbox row off by its id (idempotent). Returns the inbox. */
export function markInboxLineDone(campaign: string, id: string): Promise<InboxResponse> {
  return postJson<InboxResponse>(`/campaigns/${encodeURIComponent(campaign)}/review/inbox-done`, {
    id,
  });
}

// --- creating content --------------------------------------------------------
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

/**
 * Setting a chapter active from its status control — ONE call, because it is one
 * decision about two chapters: this one becomes `active` and the one that was
 * active goes back to `planned`. Doing it as two properties patches from here
 * would leave a window in which the campaign has two active chapters, and the
 * session view picks the first it finds.
 *
 * No rev: there is nothing to overwrite (the overview carries no rev at all),
 * and the action deliberately also changes a chapter the caller never read.
 * Answers the chapter's entry.
 */
export function setChapterActive(campaign: string, chapter: string): Promise<EntryResponse> {
  return postJson<EntryResponse>(
    `/campaigns/${encodeURIComponent(campaign)}/chapters/${encodeURIComponent(chapter)}/active`,
  );
}

/** A new chapter; `goal` lands under `## Ziel des Kapitels` when given. */
export function createChapter(
  campaign: string,
  input: { title: string; goal?: string; id?: string },
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/campaigns/${encodeURIComponent(campaign)}/chapters`, {
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
  return postJson<EntryResponse>(`/campaigns/${encodeURIComponent(campaign)}/scenes`, {
    title: input.title,
    chapter: input.chapter,
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

/** A new NPC entry — an EMPTY one that was never filled in is filled. */
export function createNpc(
  campaign: string,
  input: { name: string; id?: string },
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/campaigns/${encodeURIComponent(campaign)}/npcs`, {
    name: input.name,
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

/** A new location entry, same rules as the NPC one. */
export function createLocation(
  campaign: string,
  input: { name: string; id?: string },
): Promise<EntryResponse> {
  return postJson<EntryResponse>(`/campaigns/${encodeURIComponent(campaign)}/locations`, {
    name: input.name,
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}

// --- generator ---------------------------------------------------------------

/**
 * Start a generator run for one chapter — a BACKGROUND job:
 * the server answers 202 with the job id and the result is fetched via
 * fetchGenerateJob. Nothing is written (generator/README.md); `newChapter`
 * allows a chapter that does not exist yet (the accept creates it).
 *
 * A 409 is NOT an error here: it means a job for this campaign is already
 * running, and its id is the answer to "start a run" — the view adopts the
 * running job instead of showing a failure. Everything else throws as
 * usual; worth handling are 503 (no provider configured — no API key), 404
 * (unknown chapter) and 400.
 *
 * The run's own failure (the 422 with `rawReply`, `usage`
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
  const path = `/campaigns/${encodeURIComponent(campaign)}/generate`;
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
 * Start an NPC run: source material in, ONE NPC draft out.
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
  const path = `/campaigns/${encodeURIComponent(campaign)}/generate/npc`;
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
 * Start an augment run from an entry's augment action: an entry that already
 * exists plus source material and/or an instruction, and the model proposes
 * the filled-in version. Same job model as the create runs — 202 { jobId },
 * the proposal is fetched via fetchGenerateJob (`kind: "augment"`,
 * `augmentResult`), and a 409 carrying a jobId means "a generator job is
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
  const path = `/campaigns/${encodeURIComponent(campaign)}/generate/augment`;
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
 * Accept a reviewed augment proposal: the properties fields the
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
  return postJson<EntryResponse>(`/campaigns/${encodeURIComponent(campaign)}/generate/augment/apply`, {
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
 * applied or discarded. A server restart does NOT lose it any more:
 * a finished job comes back, and one that was still running comes back
 * as `failed` with a message saying so.
 */
export async function fetchGenerateJob(campaign: string): Promise<GenerateJob | null> {
  const path = `/campaigns/${encodeURIComponent(campaign)}/generate/job`;
  const response = await fetch(`/api${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(`GET /api${path}`, response);
  return (await response.json()) as GenerateJob;
}

/** Discard the campaign's generate job ("Verwerfen"). A missing job is fine. */
export async function deleteGenerateJob(campaign: string): Promise<void> {
  const path = `/campaigns/${encodeURIComponent(campaign)}/generate/job`;
  const response = await fetch(`/api${path}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw await failure(`DELETE /api${path}`, response);
  }
}


/**
 * Store part of the REVIEW STATE on the job. Everything merges,
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
    edits?: Record<string, DraftEdit>;
    entries?: Record<string, "accepted" | "rejected" | null>;
    dropped?: string[];
    fields?: Record<string, boolean | null>;
    blocks?: Record<string, boolean | null>;
  },
): Promise<GenerateJob> {
  const path = `/campaigns/${encodeURIComponent(campaign)}/generate/job/${encodeURIComponent(jobId)}/review`;
  const response = await fetch(`/api${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev, ...patch }),
  });
  if (!response.ok) throw await failure(`PATCH /api${path}`, response);
  return (await response.json()) as GenerateJob;
}

/**
 * Accept PART of a finished run: one scene or one suggested entry, or all of
 * them when nothing is selected.
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
  const path = `/campaigns/${encodeURIComponent(campaign)}/generate/job/${encodeURIComponent(jobId)}/accept`;
  return postJson<{ written: Record<string, string>; jobDeleted: boolean }>(path, {
    rev,
    ...(input.paths === undefined ? {} : { paths: input.paths }),
    ...(input.chapter === undefined || input.chapterTitle === undefined
      ? {}
      : { chapter: input.chapter, chapterTitle: input.chapterTitle }),
  });
}

/**
 * The retry action for ONE part of a pipelined scene run.
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
    `/campaigns/${encodeURIComponent(campaign)}/generate/job/${encodeURIComponent(jobId)}` +
    `/parts/${encodeURIComponent(key)}/retry`;
  return postJson<GenerateJob>(path, {});
}

