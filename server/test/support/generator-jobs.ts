// The generator job's resource for the tests: its URLs, the one read every
// case starts from, and the PATCH body of an accept.

import {
  openLocationIds,
  openNpcIds,
  openSceneIds,
  type GeneratorJob,
} from "@grimoire/shared";
import { app } from "../../src/server";

/** `…/generator-jobs` of a campaign. */
export function jobsUrl(campaign: string): string {
  return `/api/campaigns/${encodeURIComponent(campaign)}/generator-jobs`;
}

/** `…/generator-jobs/:id`. */
export function jobUrl(campaign: string, id: string): string {
  return `${jobsUrl(campaign)}/${encodeURIComponent(id)}`;
}

/** `…/generator-jobs/:id/parts/:key`. */
export function partUrl(campaign: string, id: string, key: string): string {
  return `${jobUrl(campaign, id)}/parts/${encodeURIComponent(key)}`;
}

/** The campaign's job — the one of the list — or null when there is none. */
export async function readJob(campaign: string): Promise<GeneratorJob | null> {
  const res = await app.request(jobsUrl(campaign));
  if (res.status !== 200) throw new Error(`GET generator-jobs → ${res.status}`);
  const jobs = (await res.json()) as GeneratorJob[];
  return jobs[0] ?? null;
}

/** The proposals an accept names, by entity. */
export interface Selection {
  scenes?: string[];
  npcs?: string[];
  locations?: string[];
}

/** The PATCH body that accepts a selection, with the guard the job was read with. */
export function acceptBody(job: GeneratorJob, selection: Selection): Record<string, unknown> {
  return {
    rev: job.rev,
    review: {
      ...(selection.scenes === undefined ? {} : { writtenScenes: selection.scenes }),
      ...(selection.npcs === undefined ? {} : { writtenNpcs: selection.npcs }),
      ...(selection.locations === undefined ? {} : { writtenLocations: selection.locations }),
    },
  };
}

/**
 * What "accept all" names: every open scene, every open npc and location the
 * DM accepted, and the NPC run's one npc unless it was rejected — it is the
 * whole run.
 */
export function openSelection(job: GeneratorJob): Selection {
  const npcRun = job.npcResult?.npc.id;
  return {
    scenes: [...openSceneIds(job)],
    npcs: [...openNpcIds(job)].filter(
      (id) => id === npcRun || job.review.npcs[id] === "accepted",
    ),
    locations: [...openLocationIds(job)].filter((id) => job.review.locations[id] === "accepted"),
  };
}

/** The ids an accept wrote: what the answer lists as written that the job before did not. */
export function writtenBy(
  before: GeneratorJob,
  after: GeneratorJob,
): { scenes: string[]; npcs: string[]; locations: string[] } {
  const added = (was: string[], is: string[]) => is.filter((id) => !was.includes(id));
  return {
    scenes: added(before.review.writtenScenes, after.review.writtenScenes),
    npcs: added(before.review.writtenNpcs, after.review.writtenNpcs),
    locations: added(before.review.writtenLocations, after.review.writtenLocations),
  };
}
