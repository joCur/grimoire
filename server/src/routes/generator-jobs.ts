// The generator jobs: list, start, read, review and accept, retry a part,
// discard.
//
// A GENERATOR JOB IS ITS OWN RESOURCE (decisions/resources): `…/generator-jobs` and
// `…/generator-jobs/:id`, answering the `GeneratorJob` type. A campaign has at
// most one job, whatever its kind. The parts of a scene run are its children:
// read embedded in the job, and retried on their own resource,
// `…/generator-jobs/:id/parts/:key`. A scene, an npc and a location are
// augmented on their own resources (./scenes.ts, ./npcs.ts, ./locations.ts);
// the job such a run starts is read, reviewed and discarded here like any
// other.

import { Hono } from "hono";
import {
  generatorJobCreateSchema,
  generatorJobDeleteSchema,
  generatorJobPartPatchSchema,
  generatorJobPatchSchema,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import { acceptJobParts } from "../generator-job-accept";
import {
  deleteJob,
  getJob,
  patchJobReview,
  requireJob,
  retryJobPart,
  serializeJob,
  startJob,
} from "../generator-jobs";
import { assertGenerateTarget, assertNpcGenerateTarget, obtainProvider } from "../generator";
import { parseRequest } from "../store/shared";
import { jsonBody, normalizeLineText, requiredText } from "./http";

export const generatorJobRoutes = new Hono();

// GET /api/campaigns/:campaign/generator-jobs -> GeneratorJob[]
// The campaign's job as a list of one or none — none is the ordinary state
// when nothing runs and nothing waits for review, not an error. The campaign
// is NOT re-validated here: "no job" is the honest answer for an unknown
// campaign too. Polled by the generator route while a job runs and read once
// per campaign by the topbar's run indicator.
generatorJobRoutes.get("/campaigns/:campaign/generator-jobs", async (c) => {
  const job = await getJob(c.req.param("campaign"));
  return c.json(job === undefined ? [] : [serializeJob(job)]);
});

// POST /api/campaigns/:campaign/generator-jobs
//   { kind: "scene", chapter, sourceText, newChapter?, chapterTitle? }
//   | { kind: "npc", sourceText, id? } -> 202 GeneratorJob
// Starts a run in the BACKGROUND and answers at once with the job, `running`.
// It writes nothing into the campaign (generator/README.md): what the run
// proposes waits in the job — a scene run's scenes, npcs and locations under
// `result`, an npc run's one npc under `npcResult`.
//
// A SCENE run goes into `chapter`; `newChapter` allows a chapter that does
// not exist yet, which the first accept creates under `chapterTitle` — the
// title is kept ON the job, so the accept does not depend on the browser that
// started the run. An NPC run takes the npc's `id` or, without one, lets the
// model pick it; a collision with an existing npc then becomes a correction
// turn.
//
// Everything cheap stays a synchronous answer, BEFORE a job exists — a
// request error must not turn into a failed job the DM has to go and read:
// 400 for a malformed body (a key the kind does not take, a blank
// `sourceText`, an unsafe chapter id, an npc id that is not a kebab slug),
// 404 for an unknown campaign or chapter (unless `newChapter`), 409 { id }
// when a pinned npc id already holds something (an existing npc is augmented
// on its own resource), 503 when no provider is configured. While ANY run of
// the campaign is going, a start is 409 { generatorJob } with that job, and
// nothing starts — one job per campaign. A finished job is replaced.
// The run's own outcome (incl. the 422 of a truncated or invalid reply) lands
// in the job.
generatorJobRoutes.post("/campaigns/:campaign/generator-jobs", async (c) => {
  const campaign = c.req.param("campaign");
  const body = parseRequest(generatorJobCreateSchema, await jsonBody(c, null), "generator job");
  // The source material travels as the DM pasted it; blank is a 400.
  requiredText(body.sourceText, "sourceText");
  const sourceText = body.sourceText;
  if (body.kind === "scene") {
    requiredText(body.chapter, "chapter");
    const chapter = body.chapter;
    const newChapter = body.newChapter === true;
    const chapterTitle = normalizeLineText(body.chapterTitle);
    await assertGenerateTarget(campaign, chapter, newChapter); // 400/404
    const provider = obtainProvider(); // 503 when nothing is configured
    const job = await startJob({
      kind: "scene",
      campaign,
      chapter,
      sourceText,
      newChapter,
      ...(newChapter && chapterTitle !== undefined ? { newChapterTitle: chapterTitle } : {}),
      provider,
    });
    return c.json(serializeJob(job), 202);
  }
  // An empty id means "the model chooses".
  const npcId = body.id?.trim() || undefined;
  await assertNpcGenerateTarget(campaign, npcId); // 400/404/409
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "npc",
    campaign,
    sourceText,
    ...(npcId === undefined ? {} : { npcId }),
    provider,
  });
  return c.json(serializeJob(job), 202);
});

// GET /api/campaigns/:campaign/generator-jobs/:id -> GeneratorJob
// The job with its status (running/done/failed), its kind and the proposal in
// the field its kind reads — `result`, `npcResult`, `sceneAugmentResult`,
// `npcAugmentResult` or `locationAugmentResult` —, the error body of a failed
// run, the DM's changes to the proposals (`sceneEdits`, `npcEdits`), the
// review and, for a scene run, its parts under `pipeline`. An augment job
// names what it works on (`scene`, `npc` or `location`) from the moment it
// starts. A finished result may carry `namingHints`: the SERVER's own
// findings that a proposal still spells something a naming convention
// replaces — hints for the review, never a reason to fail or block.
// 404 when the campaign has no job under this id.
generatorJobRoutes.get("/campaigns/:campaign/generator-jobs/:id", async (c) =>
  c.json(serializeJob(await requireJob(c.req.param("campaign"), c.req.param("id")))),
);

// PATCH /api/campaigns/:campaign/generator-jobs/:id
//   { rev, id?, sceneEdits?, npcEdits?, review? } -> GeneratorJob
// The review of a run, and its accept. Everything merges, so the app sends
// the ONE thing that just changed — text debounced, decisions immediately:
//
//   - `sceneEdits` and `npcEdits` change a proposed scene or npc, by its id:
//     any subset of the entity's fields, `null` clearing an optional one,
//     merged onto the stored change of that proposal;
//   - `review.npcs` and `review.locations` decide a proposed npc or location
//     (`accepted`, `rejected`, `null` for undecided again), `review.fields`
//     and `review.blocks` decide a field or body block of an augment run, and
//     `review.droppedScenes` is the whole set of dropped scenes;
//   - `review.writtenScenes`, `review.writtenNpcs` and
//     `review.writtenLocations` ACCEPT: every proposal they name is written
//     into the campaign, with the DM's changes on top of the model's, and a
//     scene carries the run's own npcs and location it names. A proposal
//     that is already written is skipped; a dropped or rejected one is 409.
//     A running scene run is acceptable part by part — a `done` part is in
//     the result before its siblings are.
//
// One transaction for an accept: the conflict check lives inside it
// (409 { chapters, scenes, npcs, locations } — rows that already exist), FTS
// and reference rows follow, and the job records what was written in that
// same commit. The first scene accept of a new-chapter run creates the
// chapter. The answer is the job as the write leaves it; once nothing is left
// open the job is gone, and the answer is the job as it ended.
//
// A scene, npc or location id the run did not produce is a 400, and so is
// any other key, a change with a field the entity does not have, or a patch
// that names nothing (`nothing_to_write`). The `id` may be echoed, never
// changed. A stale `rev` is 409 { code: "rev_conflict", rev, generatorJob }
// and nothing is written. 404 when the campaign has no job under this id.
generatorJobRoutes.patch("/campaigns/:campaign/generator-jobs/:id", async (c) => {
  const campaign = c.req.param("campaign");
  const id = c.req.param("id");
  const patch = parseRequest(generatorJobPatchSchema, await jsonBody(c, null), "generator job");
  if (patch.id !== undefined && patch.id !== id) throw new ApiError(400, "id cannot be changed");
  const review = patch.review ?? {};
  if (
    patch.sceneEdits === undefined &&
    patch.npcEdits === undefined &&
    Object.keys(review).length === 0
  ) {
    throw new ApiError(400, "the patch names nothing to write", { code: "nothing_to_write" });
  }
  const accepts =
    review.writtenScenes !== undefined ||
    review.writtenNpcs !== undefined ||
    review.writtenLocations !== undefined;
  const job = accepts
    ? await acceptJobParts(campaign, id, patch)
    : await patchJobReview(campaign, id, patch);
  return c.json(serializeJob(job));
});

// PATCH /api/campaigns/:campaign/generator-jobs/:id/parts/:key
//   { status: "running" } -> 202 GeneratorJob
// Runs ONE failed part of a scene run again. Only that part: the outline
// stays, the finished parts stay reviewable and acceptable, and the part goes
// back through exactly the call it failed on — same outline, same source
// excerpt, same validation. The answer is the job with the part `running`,
// so the app needs no extra read before its next poll.
//
// 404 without a job under this id and for an unknown part key; 409 for a job
// that has no parts (an npc or augment run) and for a part that is already
// running, has not run yet (`pending` — the run's own queue still owns it) or
// is already done — a double click must not spend tokens twice; 503 when no
// provider is configured.
generatorJobRoutes.patch("/campaigns/:campaign/generator-jobs/:id/parts/:key", async (c) => {
  parseRequest(generatorJobPartPatchSchema, await jsonBody(c, null), "generator job part");
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await retryJobPart(
    c.req.param("campaign"),
    c.req.param("id"),
    c.req.param("key"),
    provider,
  );
  return c.json(serializeJob(job), 202);
});

// DELETE /api/campaigns/:campaign/generator-jobs/:id { rev } -> { deleted: true }
// Discards the job, whatever its status — a running run is abandoned, its
// result never lands. What an accept already wrote stays in the campaign. A
// stale `rev` is 409 { code: "rev_conflict", rev, generatorJob } and nothing
// is deleted; 404 when the campaign has no job under this id.
generatorJobRoutes.delete("/campaigns/:campaign/generator-jobs/:id", async (c) => {
  const { rev } = parseRequest(generatorJobDeleteSchema, await jsonBody(c, null), "generator job");
  await deleteJob(c.req.param("campaign"), c.req.param("id"), rev);
  return c.json({ deleted: true });
});
