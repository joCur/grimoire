// A generator job in the suite: its resource `…/generator-jobs/:id` (decisions/resources)
// and the list `…/generator-jobs`, which holds the campaign's one job or none.
// A scene run's parts are its children, retried on
// `…/generator-jobs/:id/parts/:key`. Its type is the one
// `@grimoire/shared/generator-job` derives from the job's schema.
//
// A job id is an opaque string the server hands out, so "the job of this
// campaign" is a question only the list can answer — `readGeneratorJob` asks
// it.

import type {
  GeneratorJob,
  GeneratorJobCreate,
  GeneratorJobPatch,
} from "@grimoire/shared/generator-job";
import { underCampaign, type Api } from "./api";

/** The request path of one job, or, without an id, of the job list. */
export function generatorJobPath(api: Api, id?: string): string {
  return id === undefined
    ? underCampaign(api, "generator-jobs")
    : underCampaign(api, "generator-jobs", id);
}

/** The request path of one part of a scene run. */
export function generatorJobPartPath(api: Api, id: string, key: string): string {
  return underCampaign(api, "generator-jobs", id, "parts", key);
}

/** The campaign's job — the one of the list — or null when there is none. */
export async function readGeneratorJob(api: Api): Promise<GeneratorJob | null> {
  const [job] = await api.get<GeneratorJob[]>(generatorJobPath(api));
  return job ?? null;
}

/** The campaign's job; throws when there is none. */
export async function getGeneratorJob(api: Api): Promise<GeneratorJob> {
  const job = await readGeneratorJob(api);
  if (job === null) throw new Error("the campaign has no generator job");
  return job;
}

/** Start a run: `POST …/generator-jobs`, answered 202 with the job itself. */
export function startGeneratorJob(
  api: Api,
  body: GeneratorJobCreate,
): Promise<GeneratorJob> {
  return api.send<GeneratorJob>("POST", generatorJobPath(api), body);
}

/**
 * `PATCH …/generator-jobs/:id` — the review, and with `review.written…` the
 * accept. Answers the job as the write leaves it.
 */
export function patchGeneratorJob(
  api: Api,
  id: string,
  patch: GeneratorJobPatch,
): Promise<GeneratorJob> {
  return api.send<GeneratorJob>("PATCH", generatorJobPath(api, id), patch);
}

/** Poll until the job leaves `running` (the stub answers in well under 30s). */
export async function waitForGeneratorJob(api: Api): Promise<GeneratorJob> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = await readGeneratorJob(api);
    if (current === null) throw new Error("the job disappeared while waiting");
    if (current.status !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the job never finished");
}
