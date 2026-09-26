// The npcs: list, read, create, write and the AI augment run.
//
// AN NPC IS ITS OWN RESOURCE (decisions/resources): `…/npcs` and `…/npcs/:id`, answering
// the `Npc` type — every field of the npc flat, `body` among them, beside its
// `rev`.
//
// An npc in the trash (decisions/trash) is not there for any of these but the
// list with `?deleted=true` and its restore, a PATCH of `deletedMs: null`.

import { Hono } from "hono";
import { npcCreateSchema, npcDeleteSchema } from "@grimoire/shared";
import { ApiError } from "../api-error";
import { serializeJob, startJob } from "../generator-jobs";
import { obtainProvider } from "../generator";
import { applyNpcAugment } from "../npc-augment";
import { createNpc, listNpcs, patchNpc, readNpc, trashNpc } from "../store/npcs";
import { parseRequest } from "../store/shared";
import { deletedFilter, jsonBody, optionalText, requiredText } from "./http";

export const npcRoutes = new Hono();

// GET /api/campaigns/:campaign/npcs[?deleted=true] -> Npc[] — every live npc
// of the campaign, sorted by name, each exactly as its own GET answers it.
// `?deleted=true` answers the npcs in the trash instead, each with its
// `deletedMs`, the latest to go there first. Any other value of `deleted` is
// a 400.
npcRoutes.get("/campaigns/:campaign/npcs", async (c) =>
  c.json(await listNpcs(c.req.param("campaign"), deletedFilter(c.req.query("deleted")))),
);

// GET /api/campaigns/:campaign/npcs/:id -> Npc
// `{ id, name, role?, chapter?, status, statblock?, quickstats?, voice?,
// appearance?, motivation?, body, rev }` — every field of the npc flat, an
// optional one absent when the npc does not carry it, and `rev` the guard its
// PATCH sends back. 404 for an unknown campaign or npc, and for an npc in the
// trash.
npcRoutes.get("/campaigns/:campaign/npcs/:id", async (c) =>
  c.json(await readNpc(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/npcs { name, id?, body? } -> 201 Npc
// The id is derived from `name` unless the request sets it; `body` is the
// npc's markdown (the review sends the note of a log line there) and absent
// means an empty text. `status` is `unknown`: nothing in a name or a note
// says whether the figure lives. An EMPTY npc under the id — one the DM
// created and left empty — is FILLED with the name and the body instead of
// colliding; an npc with content, and an npc in the trash, answers 409
// { code: "slug_taken", kind, id, suggestion } and writes nothing. A key that is none of the three, or a
// value of the wrong shape, is a 400 that names it.
npcRoutes.post("/campaigns/:campaign/npcs", async (c) => {
  const request = parseRequest(npcCreateSchema, await jsonBody(c, null), "npc");
  const name = requiredText(request.name, "name");
  return c.json(
    await createNpc(c.req.param("campaign"), name, optionalText(request.id, "id"), request.body),
    201,
  );
});

// PATCH /api/campaigns/:campaign/npcs/:id
//   { rev, force?, id?, name?, role?, chapter?, status?, statblock?,
//     quickstats?, voice?, appearance?, motivation?, body?, deletedMs? } -> Npc
// THE write of one npc (decisions/writes): any subset of its fields — `body` is one
// of them — in ONE row update against ONE `rev`, checked against the npc's
// schema. `null` clears an optional field; a key that is not a field of an
// npc, or a value of the wrong shape, is a 400 that names it, and a `status`
// outside the four is a 400 { code: "status_not_allowed" }. A request that
// names no field is a 400 { code: "nothing_to_write" }. The `id` may be
// echoed, never changed (400), and a `chapter` has to name a chapter that
// exists (400 with the create-this-first code) — a chapter in the trash is
// none to name.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, npc } and writes nothing
// — `npc` is the npc as it stands now. `force: true` writes the given fields
// on top of that current row instead: only what this request carries is
// written, so a field changed in between survives a forced save of the text.
// 404 for an unknown campaign or npc.
//
// RESTORE. `{ rev, force?, deletedMs: null }` and nothing else takes an npc
// out of the trash, back into the lists, the search and every `[[id]]`, with
// its `rev` moved. Its chapter in the trash is 409 { code: "restore_blocked",
// kind, id, blockers } and writes nothing. Any other patch of an npc in the
// trash is 404. `deletedMs` takes no other value (400): the trash is entered
// by DELETE. On a live npc `deletedMs: null` changes nothing.
npcRoutes.patch("/campaigns/:campaign/npcs/:id", async (c) => {
  const body = await jsonBody(c, null);
  return c.json(await patchNpc(c.req.param("campaign"), c.req.param("id"), body));
});

// DELETE /api/campaigns/:campaign/npcs/:id { rev } -> Npc
// Puts the npc in the TRASH (decisions/trash) and answers it with its
// `deletedMs` and its moved `rev`: it keeps its id and its fields, leaves the
// lists, the tree, the search, the generator's context and every `[[id]]`
// (which then reads like one that names nothing), and is removed for good
// after the trash's retention. Its id stays taken meanwhile, and it is never
// filled. An npc a live scene names stays: 409 { code: "trash_blocked", kind,
// id, blockers } with those scenes, and nothing is written. A stale `rev` is
// 409 { code: "rev_conflict", rev, npc }. 404 for an unknown campaign or npc,
// and for one already in the trash.
npcRoutes.delete("/campaigns/:campaign/npcs/:id", async (c) => {
  const request = parseRequest(npcDeleteSchema, await jsonBody(c, null), "npc delete");
  return c.json(await trashNpc(c.req.param("campaign"), c.req.param("id"), request));
});

// POST /api/campaigns/:campaign/npcs/:id/augment { sourceText?, instruction? }
// -> 202 GeneratorJob — the AI augment run of one npc, on the npc's own
// resource: the same background job model as every other run
// (`kind: "npc-augment"`, the job's `npc` the id), ONE generator job per
// campaign, so a start while ANY run is going answers 409 { generatorJob }. Writes
// NOTHING; the proposal waits in the job as `npcAugmentResult` — the npc as
// the run read it (`current`) beside the npc as the model proposes it
// (`proposed`), both without their guard.
//
// Synchronous, before a job exists: 400 for a malformed body and when
// NEITHER sourceText nor instruction carries text; 404 for an unknown
// campaign or npc, and for one in the trash; 503 without a configured
// provider.
npcRoutes.post("/campaigns/:campaign/npcs/:id/augment", async (c) => {
  const body = await jsonBody(c, ["sourceText", "instruction"]);
  const campaign = c.req.param("campaign");
  const npc = c.req.param("id");
  const sourceText = optionalText(body.sourceText, "sourceText") ?? "";
  const instruction = optionalText(body.instruction, "instruction") ?? "";
  if (sourceText === "" && instruction === "") {
    throw new ApiError(400, "sourceText or instruction is required");
  }
  await readNpc(campaign, npc); // 404 unknown
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "npc-augment",
    campaign,
    npc,
    sourceText,
    instruction,
    provider,
  });
  return c.json(serializeJob(job), 202);
});

// POST /api/campaigns/:campaign/npcs/:id/augment/apply
// { rev, jobId?, name?, role?, chapter?, status?, statblock?, quickstats?,
//   voice?, appearance?, motivation?, body? } -> Npc
// Accepting the reviewed proposal: the fields the DM took and the body they
// assembled from the accepted blocks — the npc's PATCH without `force` and
// without `id` (a proposal never changes it) — written in ONE transaction
// against `rev`: 409 { code: "rev_conflict", rev, npc } when the npc moved
// underneath, and then NOTHING is written. FTS and `[[id]]` reference rows
// follow because this is the npc's ordinary write; `jobId` discards the
// augment job in that same transaction. A request that takes nothing is a
// 400.
npcRoutes.post("/campaigns/:campaign/npcs/:id/augment/apply", async (c) => {
  const { jobId, ...patch } = await jsonBody(c, null);
  if (jobId !== undefined && typeof jobId !== "string") {
    throw new ApiError(400, "jobId must be a string");
  }
  return c.json(await applyNpcAugment(c.req.param("campaign"), c.req.param("id"), patch, jobId));
});
