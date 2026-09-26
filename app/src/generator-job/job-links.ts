// Where the campaign's generator job is reviewed: an augment run at the row it
// works on, with its review open; a scene or npc run on the generator page.

import type { GeneratorJob } from "@grimoire/shared/generator-job";

import { openTargetHref } from "@/lib/open-target";

import { augmentTarget } from "./generator-job-state";

/**
 * The search parameter that opens a reading view's augment dialog on arrival
 * — how a link from elsewhere lands in the review of an augment run.
 */
export const AUGMENT_OPEN_PARAM = "augment";

/** The generator page of a campaign. */
export function generatorHref(campaign: string): string {
  return `/campaigns/${campaign}/generate`;
}

/** Where the DM reviews this job. */
export function jobHref(campaign: string, job: GeneratorJob): string {
  const target = augmentTarget(job);
  if (target === undefined) return generatorHref(campaign);
  return `${openTargetHref(campaign, target)}?${AUGMENT_OPEN_PARAM}=review`;
}
