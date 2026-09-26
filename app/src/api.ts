// Typed client for the Grimoire server API (every endpoint is documented at
// its route, in its resource's module server/src/routes/<resource>.ts). All
// response shapes come from @grimoire/shared — the format contract exists
// exactly once. An entity with a slice of its own keeps its client there
// (campaign/campaign-api.ts, chapter/chapter-api.ts, scene/scene-api.ts,
// npc/npc-api.ts, location/location-api.ts, thread/thread-api.ts,
// idea/idea-api.ts, glossary-term/glossary-term-api.ts,
// knowledge-item/knowledge-item-api.ts, session/session-api.ts with the
// clients of its pauses, log entries and played scenes beside it,
// generator-job/generator-job-api.ts), built from the HTTP helpers exported
// here — `startJob` among them, because an augment run starts on the
// resource of its scene, npc or location.

import type { CampaignSummary } from "@grimoire/shared/campaign";
import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import type { InstanceSettings } from "@grimoire/shared/settings";
import type { SceneOrderResponse } from "@grimoire/shared/chapter";
import type { SearchResponse } from "@grimoire/shared/search";
import type { GeneratorJob } from "@grimoire/shared/generator-job";

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
 * the same transaction as the change (decisions/polling, decisions/sqlite); polled by
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
 * changes where the neighbours sit too (decisions/scene-order).
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
