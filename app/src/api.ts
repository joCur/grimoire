// Typed client for the Grimoire server API (every endpoint is documented at
// its route, in its resource's module server/src/routes/<resource>.ts). All
// response shapes come from @grimoire/shared — the format contract exists
// exactly once. An entity with a slice of its own keeps its client there
// (campaign/campaign-api.ts, chapter/chapter-api.ts, scene/scene-api.ts,
// npc/npc-api.ts, location/location-api.ts, thread/thread-api.ts,
// idea/idea-api.ts, glossary-term/glossary-term-api.ts,
// knowledge-item/knowledge-item-api.ts, session/session-api.ts with the
// clients of its pauses, log entries and played scenes beside it), built from
// the HTTP helpers exported here.

import type {
  CampaignSummary,
  CampaignTree,
  InstanceSettings,
  SceneOrderResponse,
  SearchResponse,
} from "@grimoire/shared/types";
import type {
  GeneratorJob,
  GeneratorJobPatch,
} from "@grimoire/shared/generator-job";

export class ApiError extends Error {
  readonly status: number;
  /**
   * The server's JSON error body when there was one — the endpoints answer
   * `{ error, … }` and put the interesting parts next to it (`code`,
   * `validationErrors`/`rawReply`/`usage` on the generator's 422, and on a
   * write conflict the current `rev` plus the current row under the name of
   * its entity — read out by the conflict reader in that entity's slice).
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

/** GET a JSON answer; a non-2xx becomes an ApiError. */
export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) throw await failure(`GET /api${path}`, response);
  return (await response.json()) as T;
}

/** PUT a JSON body and parse the JSON answer; a non-2xx becomes an ApiError. */
async function putJson<T>(path: string, body: unknown): Promise<T> {
  return sendJson<T>("PUT", path, body);
}

/** Send a JSON body with any write verb; a non-2xx becomes an ApiError. */
export async function sendJson<T>(
  method: "PUT" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(`${method} /api${path}`, response);
  return (await response.json()) as T;
}

/** DELETE with a JSON body — its guard — and no answer body; a non-2xx becomes an ApiError. */
export async function deleteJson(path: string, body: unknown): Promise<void> {
  const response = await fetch(`/api${path}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(`DELETE /api${path}`, response);
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
 * Write the scene ORDER of one chapter — the whole list, because a move
 * changes where the neighbours sit too (ADR #27).
 *
 * `scenes` must name exactly the chapter's scenes; anything else is
 * 400 `scene_order_mismatch` and writes nothing. `rev` is the order's own
 * guard token, `ChapterNode.sceneOrderRev` — not the chapter's and not
 * a scene's, so an open editor neither causes nor suffers a conflict here. A
 * stale token is 409 and writes nothing either.
 */
export function putSceneOrder(
  campaign: string,
  chapter: string,
  scenes: readonly string[],
  rev: number,
): Promise<SceneOrderResponse> {
  return putJson<SceneOrderResponse>(
    `/campaigns/${encodeURIComponent(campaign)}/chapters/${encodeURIComponent(chapter)}/scene-order`,
    { scenes, rev },
  );
}

/** POST an optional JSON body and parse the JSON answer; a non-2xx becomes an ApiError. */
export async function postJson<T>(path: string, body?: unknown): Promise<T> {
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
 * Start a generator run — a BACKGROUND job: the server answers 202 with the
 * job, still running, and its result is read via fetchGeneratorJob. A 409
 * carrying a `generatorJob` is NOT an error: a job for this campaign is
 * already running, and it is the answer to "start a run" — the caller adopts
 * it. Everything else throws as usual.
 */
export async function startJob(path: string, body: unknown): Promise<GeneratorJob> {
  try {
    return await postJson<GeneratorJob>(path, body);
  } catch (error) {
    const running = error instanceof ApiError ? error.details.generatorJob : undefined;
    if (error instanceof ApiError && error.status === 409 && isJob(running)) return running;
    throw error;
  }
}

/** Is this an error body's `generatorJob` — a job with its id? */
function isJob(value: unknown): value is GeneratorJob {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

/** The part of a run request both of its optional texts share: only what carries text. */
export function runTexts(input: { sourceText?: string; instruction?: string }) {
  return {
    ...(input.sourceText === undefined || input.sourceText === ""
      ? {}
      : { sourceText: input.sourceText }),
    ...(input.instruction === undefined || input.instruction === ""
      ? {}
      : { instruction: input.instruction }),
  };
}

/** The request path of one campaign — every resource hangs under it. */
export function campaignPath(campaign: string): string {
  return `/campaigns/${encodeURIComponent(campaign)}`;
}

// --- generator ---------------------------------------------------------------

/** `…/generator-jobs` of a campaign — the generator job's resource (ADR #31). */
export function generatorJobsPath(campaign: string): string {
  return `${campaignPath(campaign)}/generator-jobs`;
}

/** `…/generator-jobs/:id`. */
function generatorJobPath(campaign: string, id: string): string {
  return `${generatorJobsPath(campaign)}/${encodeURIComponent(id)}`;
}

/**
 * Start a scene run for one chapter (`startJob`: 202 with the job, a running
 * job's 409 adopted). Nothing is written (generator/README.md); `newChapter`
 * allows a chapter that does not exist yet (the first accept creates it).
 * Worth handling are 503 (no provider configured — no API key), 404 (unknown
 * chapter) and 400.
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
export function startGenerateJob(
  campaign: string,
  input: { chapter: string; sourceText: string; newChapter?: boolean; chapterTitle?: string },
): Promise<GeneratorJob> {
  return startJob(generatorJobsPath(campaign), {
    kind: "scene",
    chapter: input.chapter,
    sourceText: input.sourceText,
    ...(input.newChapter === true ? { newChapter: true } : {}),
    ...(input.newChapter === true && input.chapterTitle !== undefined
      ? { chapterTitle: input.chapterTitle }
      : {}),
  });
}

/**
 * The campaign's generator job, or null when there is none — the list holds
 * one or none, and none is the normal "nothing running, nothing to restore"
 * answer, never an error state in the UI. A `null` after a job WAS there
 * means it is gone: accepted to the end or discarded. A server restart does
 * NOT lose it: a finished job comes back, and one that was still running
 * comes back as `failed` with a message saying so.
 */
export async function fetchGeneratorJob(campaign: string): Promise<GeneratorJob | null> {
  const jobs = await getJson<GeneratorJob[]>(generatorJobsPath(campaign));
  return jobs[0] ?? null;
}

/**
 * Discard a generator job, with the `rev` it was read with. A job that is
 * already gone is fine; a 409 means another tab decided in between.
 */
export async function deleteGeneratorJob(
  campaign: string,
  job: Pick<GeneratorJob, "id" | "rev">,
): Promise<void> {
  const path = generatorJobPath(campaign, job.id);
  const response = await fetch(`/api${path}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: job.rev }),
  });
  if (!response.ok && response.status !== 404) {
    throw await failure(`DELETE /api${path}`, response);
  }
}

/**
 * Write part of the job's review. Everything merges, so this sends only
 * what changed: the fields of the proposed scene or npc being typed in
 * (debounced by the caller), the decision that was just made, the drops.
 * An accept is a patch too — see acceptJobParts.
 *
 * `rev` is the job's rev as the caller read it — a 409 `rev_conflict` (with
 * the current rev in `ApiError.details`) means a second tab decided first and
 * nothing was written; the caller reloads the job.
 */
export async function patchGeneratorJob(
  campaign: string,
  jobId: string,
  patch: GeneratorJobPatch,
): Promise<GeneratorJob> {
  const path = generatorJobPath(campaign, jobId);
  const response = await fetch(`/api${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await failure(`PATCH /api${path}`, response);
  return (await response.json()) as GeneratorJob;
}

/**
 * Accept proposals of a run: the proposed scenes (`scenes`), npcs (`npcs` —
 * the NPC run's one npc among them) and locations (`locations`) it names, by
 * id. Answers the job as the write leaves it — as it ended, once nothing is
 * open. `rev` is the job's rev as the caller read it: a 409 `rev_conflict`
 * means another tab decided in between and nothing was written. A 409 with
 * `details.chapters`/`scenes`/`npcs`/`locations` is the ordinary write
 * conflict — the rows that already exist, per entity.
 */
export function acceptJobParts(
  campaign: string,
  jobId: string,
  rev: number,
  selection: { scenes?: string[]; npcs?: string[]; locations?: string[] },
): Promise<GeneratorJob> {
  return patchGeneratorJob(campaign, jobId, {
    rev,
    review: {
      ...(selection.scenes === undefined ? {} : { writtenScenes: selection.scenes }),
      ...(selection.npcs === undefined ? {} : { writtenNpcs: selection.npcs }),
      ...(selection.locations === undefined ? {} : { writtenLocations: selection.locations }),
    },
  });
}

/**
 * Run ONE failed part of a scene run again. Restarts that part only — the
 * outline stays, the finished parts stay reviewable — and answers the job
 * with the part back in `running`, so the view can seed its cache without an
 * extra read.
 */
export async function retryJobPart(
  campaign: string,
  jobId: string,
  key: string,
): Promise<GeneratorJob> {
  const path = `${generatorJobPath(campaign, jobId)}/parts/${encodeURIComponent(key)}`;
  const response = await fetch(`/api${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "running" }),
  });
  if (!response.ok) throw await failure(`PATCH /api${path}`, response);
  return (await response.json()) as GeneratorJob;
}
