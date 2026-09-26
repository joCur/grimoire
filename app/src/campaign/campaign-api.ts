// The API client of a campaign (ADR #31): its resource — read, create,
// write — and its write conflict. Built from the shared HTTP helpers
// (../api.ts). The campaign list (`GET /campaigns`, the switcher and "/")
// answers `CampaignSummary` and is not the campaign itself.

import type { Campaign, CampaignCreate, CampaignPatch } from "@grimoire/shared/campaign";

import { ApiError, campaignPath, getJson, postJson, sendJson } from "@/api";

/** The campaign — every field flat, `body` among them, beside its `rev`. */
export function fetchCampaign(campaign: string): Promise<Campaign> {
  return getJson<Campaign>(campaignPath(campaign));
}

/**
 * The one write of a campaign: any subset of its fields — `body` is one of
 * them, `null` clears the description — against the `rev` the editing session
 * started from. A stale `rev` is 409 with the current campaign
 * (`campaignConflict`); `force` writes the given fields on top of it.
 */
export function patchCampaign(campaign: string, request: CampaignPatch): Promise<Campaign> {
  return sendJson<Campaign>("PATCH", campaignPath(campaign), request);
}

/** The server's campaign at the moment it refused a write. */
export interface CampaignConflict {
  /** The campaign's current version — what a retry would have to carry. */
  rev: number;
  /** The current campaign; undefined when the 409 body did not carry one. */
  campaign?: Campaign;
}

/**
 * Read a campaign write conflict out of a rejection: the 409 of the campaign
 * PATCH, with the version and the campaign the server answered with.
 * `undefined` for anything else. A 409 whose body is shaped differently still
 * counts as a conflict, just without the details.
 */
export function campaignConflict(error: unknown): CampaignConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const { rev, campaign } = error.details;
  return {
    rev: typeof rev === "number" ? rev : Number.NaN,
    ...(isCampaign(campaign) ? { campaign } : {}),
  };
}

function isCampaign(value: unknown): value is Campaign {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Campaign>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.rev === "number"
  );
}

/**
 * A new campaign — the cold start's and the switcher's create; `id` is what
 * the app navigates to. A taken id is 409 `slug_taken` with a free proposal
 * and writes nothing.
 */
export function createCampaign(input: CampaignCreate): Promise<Campaign> {
  return postJson<Campaign>("/campaigns", {
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.id === undefined ? {} : { id: input.id }),
  });
}
