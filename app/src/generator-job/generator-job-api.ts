// The API client of the generator job (decisions/resources): its resource — start a
// run, read, review and accept, retry a part, discard. Built from the shared
// HTTP helpers (../api.ts). There is one job per campaign, whatever its kind;
// an augment run starts on the resource of its scene, npc or location and is
// read here like every other run.

import type { GeneratorJob, GeneratorJobPatch } from "@grimoire/shared/generator-job";

import { ApiError, campaignPath, deleteJson, getJson, sendJson, startJob } from "@/api";

/** `…/generator-jobs` of a campaign — the generator job's resource (decisions/resources). */
function generatorJobsPath(campaign: string): string {
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
 * Start an NPC run: source material in, ONE proposed npc out. Same job model
 * as the scene run (`startJob`); the proposal is read on the job (its
 * `npcResult`).
 *
 * `id` is optional: empty means the model picks the id. A 409 WITHOUT a
 * running job is the other collision — the pinned id's npc already holds
 * something (never overwritten).
 */
export function startGenerateNpcJob(
  campaign: string,
  input: { sourceText: string; id?: string },
): Promise<GeneratorJob> {
  return startJob(generatorJobsPath(campaign), {
    kind: "npc",
    sourceText: input.sourceText,
    ...(input.id === undefined || input.id === "" ? {} : { id: input.id }),
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
  try {
    await deleteJson(generatorJobPath(campaign, job.id), { rev: job.rev });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
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
export function patchGeneratorJob(
  campaign: string,
  jobId: string,
  patch: GeneratorJobPatch,
): Promise<GeneratorJob> {
  return sendJson<GeneratorJob>("PATCH", generatorJobPath(campaign, jobId), patch);
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
export function retryJobPart(
  campaign: string,
  jobId: string,
  key: string,
): Promise<GeneratorJob> {
  return sendJson<GeneratorJob>(
    "PATCH",
    `${generatorJobPath(campaign, jobId)}/parts/${encodeURIComponent(key)}`,
    { status: "running" },
  );
}
