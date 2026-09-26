// The API client of an npc (ADR #31): its resource — read, list, create,
// write — its write conflict and the augment run on it. Built from the shared HTTP helpers (../api.ts).

import type { Npc, NpcPatch } from "@grimoire/shared/npc";
import type { GeneratorJob } from "@grimoire/shared/generator-job";

import {
  ApiError,
  campaignPath,
  getJson,
  postJson,
  runTexts,
  sendJson,
  startJob,
} from "@/api";

/** The request path of a campaign's npcs, or of one of them. */
function npcsUrl(campaign: string, id?: string): string {
  const base = `${campaignPath(campaign)}/npcs`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** One npc — every field flat, `body` among them, beside its `rev`. */
export function fetchNpc(campaign: string, id: string): Promise<Npc> {
  return getJson<Npc>(npcsUrl(campaign, id));
}

/** Every npc of the campaign, sorted by name. */
export function fetchNpcs(campaign: string): Promise<Npc[]> {
  return getJson<Npc[]>(npcsUrl(campaign));
}

/**
 * The one write of an npc: any subset of its fields — `body` is one of them,
 * `null` clears an optional one — against the `rev` the editing session
 * started from. A stale `rev` is 409 with the current npc (`npcConflict`);
 * `force` writes the given fields on top of it.
 */
export function patchNpc(campaign: string, id: string, request: NpcPatch): Promise<Npc> {
  return sendJson<Npc>("PATCH", npcsUrl(campaign, id), request);
}

/** The server's npc at the moment it refused a write. */
export interface NpcConflict {
  /** The npc's current version — what a retry would have to carry. */
  rev: number;
  /** The current npc; undefined when the 409 body did not carry one. */
  npc?: Npc;
}

/**
 * Read an npc write conflict out of a rejection: the 409 of the npc PATCH
 * (and of accepting an augment proposal), with the version and the npc the
 * server answered with. `undefined` for anything else. A 409 whose body is
 * shaped differently still counts as a conflict, just without the details.
 */
export function npcConflict(error: unknown): NpcConflict | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  const { rev, npc } = error.details;
  return {
    rev: typeof rev === "number" ? rev : Number.NaN,
    ...(isNpc(npc) ? { npc } : {}),
  };
}

function isNpc(value: unknown): value is Npc {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<Npc>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.body === "string" &&
    typeof candidate.rev === "number"
  );
}

/**
 * A new npc, answered as the npc itself. `id` is the one the DM set (absent:
 * derived from the name) and `body` its text — the review sends the note of a
 * log line there. An EMPTY npc under the id is filled; one with content is a
 * 409 `slug_taken` with a free `suggestion`, and nothing is written.
 */
export function createNpc(
  campaign: string,
  input: { name: string; id?: string; body?: string },
): Promise<Npc> {
  return postJson<Npc>(npcsUrl(campaign), {
    name: input.name,
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.body === undefined ? {} : { body: input.body }),
  });
}

/**
 * Start an augment run on an npc, on the npc's own resource — the same job
 * model as every other run (`startJob`); the proposal is read on the job
 * (`kind: "npc-augment"`, `npcAugmentResult`).
 */
export function startNpcAugmentJob(
  campaign: string,
  id: string,
  input: { sourceText?: string; instruction?: string },
): Promise<GeneratorJob> {
  return startJob(`${npcsUrl(campaign, id)}/augment`, runTexts(input));
}

/**
 * Accept a reviewed npc proposal: the fields the DM took and the body
 * assembled from the accepted blocks — the npc's PATCH without `force` —
 * written in ONE transaction against `rev`; `jobId` discards the job in the
 * same transaction. A 409 is the npc conflict (`npcConflict`).
 */
export function applyNpcAugment(
  campaign: string,
  id: string,
  input: Omit<NpcPatch, "force" | "id"> & { jobId?: string },
): Promise<Npc> {
  return postJson<Npc>(`${npcsUrl(campaign, id)}/augment/apply`, input);
}
