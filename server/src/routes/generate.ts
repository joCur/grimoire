// The generator: the background runs (scenes, one npc), the job with its
// review state, and the writes that accept what a run proposed. A scene, an
// npc and a location are augmented on their own resources (./scenes.ts,
// ./npcs.ts, ./locations.ts).

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { acceptJobParts } from "../generate-accept";
import {
  deleteJob,
  getJob,
  patchJobReview,
  retryJobPart,
  serializeJob,
  type ReviewPatch,
  startJob,
} from "../generate-jobs";
import {
  applyGenerated,
  assertGenerateTarget,
  assertNpcGenerateTarget,
  obtainProvider,
} from "../generator";
import { isPlainObject, jsonBody, optionalText, requireRev } from "./http";

export const generateRoutes = new Hono();

// POST /api/campaigns/:campaign/generate { chapter, sourceText, newChapter?,
//                                chapterTitle? } ->
// 202 { jobId }. Starts a BACKGROUND job and returns
// immediately; the result is picked up via GET …/generate/job. Writes
// NOTHING (generator/README.md).
//
// Everything cheap stays a synchronous answer, BEFORE a job exists — a
// request error must not turn into a failed job the DM has to go and read:
// 400 for a malformed body/unsafe chapter id, 404 for an unknown
// campaign/chapter (unless newChapter marks the app's new-chapter flow,
// where the directory is created on apply), 503 when no provider is
// configured (e.g. ANTHROPIC_API_KEY missing). 409 { error, jobId } while a
// job for this campaign is still running — one job per campaign.
// The run's own outcome (incl. the 422 of a truncated or invalid reply)
// lands in the job.
//
// `chapterTitle` belongs to a `newChapter` run and is stored ON the job: the
// accept step must not read the title out of the browser, because the
// browser's copy does not survive a navigation or a reload — and the chapter
// would go with it. Optional, so a client that omits it still starts runs;
// the accept then falls back to the chapter id.
generateRoutes.post("/campaigns/:campaign/generate", async (c) => {
  const body = await jsonBody(c, ["chapter", "sourceText", "newChapter", "chapterTitle"]);
  const campaign = c.req.param("campaign");
  const chapter = body.chapter;
  const sourceText = body.sourceText;
  const newChapter = body.newChapter;
  const chapterTitle = optionalText(body.chapterTitle, "chapterTitle");
  if (typeof chapter !== "string" || chapter.trim() === "") {
    throw new ApiError(400, "chapter must be a non-empty string");
  }
  if (typeof sourceText !== "string" || sourceText.trim() === "") {
    throw new ApiError(400, "sourceText must be a non-empty string");
  }
  if (newChapter !== undefined && typeof newChapter !== "boolean") {
    throw new ApiError(400, "newChapter must be a boolean");
  }
  await assertGenerateTarget(campaign, chapter, newChapter === true); // 400/404
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "scene",
    campaign,
    chapter,
    sourceText,
    newChapter: newChapter === true,
    ...(newChapter === true && chapterTitle !== undefined ? { newChapterTitle: chapterTitle } : {}),
    provider,
  });
  return c.json({ jobId: job.id }, 202);
});

// POST /api/campaigns/:campaign/generate/npc { sourceText, id? } -> 202 { jobId }
// One npc from source material — the same background job model as the scene
// run: ONE generator job per campaign, so a start while ANY run (scene or
// npc) is going answers 409 { jobId }. Writes NOTHING; the proposed npc waits
// in the job as `npcResult.npc`, the npc without its guard.
//
// Synchronous, before a job exists: 400 for a malformed body or an id that is
// not a kebab slug, 404 for an unknown campaign, 409 { id } when the pinned
// id's npc already holds something (never overwrite — an existing npc is
// augmented on its own resource), 503 without a configured provider.
// `id` is optional: without it the model picks the id, and a collision with
// an existing npc becomes a correction turn.
generateRoutes.post("/campaigns/:campaign/generate/npc", async (c) => {
  const body = await jsonBody(c, ["sourceText", "id"]);
  const campaign = c.req.param("campaign");
  const sourceText = body.sourceText;
  if (typeof sourceText !== "string" || sourceText.trim() === "") {
    throw new ApiError(400, "sourceText must be a non-empty string");
  }
  let npcId: string | undefined;
  if (body.id !== undefined && body.id !== null) {
    if (typeof body.id !== "string") throw new ApiError(400, "id must be a string");
    npcId = body.id.trim();
    if (npcId === "") npcId = undefined; // an empty field means "model chooses"
  }
  await assertNpcGenerateTarget(campaign, npcId); // 400/404/409
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "npc",
    campaign,
    sourceText,
    ...(npcId === undefined ? {} : { npcId }),
    provider,
  });
  return c.json({ jobId: job.id }, 202);
});

/** One `{ key: value }` map out of a review patch body, value-checked. */
function reviewRecord<T>(
  value: unknown,
  label: string,
  check: (v: unknown) => v is T,
): Record<string, T> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, `${label} must be an object`);
  }
  const out: Record<string, T> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!check(item)) throw new ApiError(400, `${label}.${key} has an unusable value`);
    out[key] = item;
  }
  return out;
}

/**
 * One scene or npc edit of a review patch — its fields are checked against
 * the entity's schema in the job store.
 */
const isChange = (v: unknown): v is Record<string, unknown> => isPlainObject(v);
/** A field/block decision, or `null` for no decision any more. */
const isDecidedFlag = (v: unknown): v is boolean | null => v === null || typeof v === "boolean";
/** `null` is undecided again — the review's third state. */
const isDecision = (v: unknown): v is "accepted" | "rejected" | null =>
  v === null || v === "accepted" || v === "rejected";

// PATCH /api/campaigns/:campaign/generate/job/:id/review { rev, sceneEdits?,
// npcEdits?, npcs?, locations?, droppedScenes?, fields?, blocks? } -> the job.
// The review state of a run lives ON THE JOB: the DM's changes per proposed
// scene (`sceneEdits`) and per proposed npc (`npcEdits`), each by id and any
// subset of the entity's fields, `null` clearing an optional one; the
// decision per proposed npc (`npcs`, by id) and per proposed location
// (`locations`, by id), the dropped scenes (`droppedScenes`, ids) and (for an
// augment run) the decision per field/block. Everything merges, so the app
// sends the ONE thing that just changed — text debounced, decisions
// immediately. A scene, npc or location id the run did not produce is a 400,
// and so is an edit with a field the entity does not have.
//
// `rev` is the job's review rev as the client read it: a second tab that
// decided first makes this a 409 { code: "rev_conflict", rev } and nothing
// is written — the app reloads the state instead of silently winning.
// 404 when the campaign has no job, or when :id names a different one (a
// patch for a replaced run must not land on its successor).
generateRoutes.patch("/campaigns/:campaign/generate/job/:id/review", async (c) => {
  const body = await jsonBody(c, [
    "rev",
    "sceneEdits",
    "npcEdits",
    "npcs",
    "locations",
    "droppedScenes",
    "fields",
    "blocks",
  ]);
  const rev = body.rev;
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) {
    throw new ApiError(400, "rev must be a non-negative integer");
  }
  const patch: ReviewPatch = {};
  if (body.sceneEdits !== undefined) {
    patch.sceneEdits = reviewRecord(body.sceneEdits, "sceneEdits", isChange);
  }
  if (body.npcEdits !== undefined) {
    patch.npcEdits = reviewRecord(body.npcEdits, "npcEdits", isChange);
  }
  if (body.npcs !== undefined) patch.npcs = reviewRecord(body.npcs, "npcs", isDecision);
  if (body.locations !== undefined) {
    patch.locations = reviewRecord(body.locations, "locations", isDecision);
  }
  if (body.droppedScenes !== undefined) {
    const dropped = body.droppedScenes;
    if (!Array.isArray(dropped) || dropped.some((v) => typeof v !== "string")) {
      throw new ApiError(400, "droppedScenes must be an array of strings");
    }
    patch.droppedScenes = dropped as string[];
  }
  if (body.fields !== undefined) patch.fields = reviewRecord(body.fields, "fields", isDecidedFlag);
  if (body.blocks !== undefined) patch.blocks = reviewRecord(body.blocks, "blocks", isDecidedFlag);
  const job = await patchJobReview(c.req.param("campaign"), c.req.param("id"), rev, patch);
  return c.json(serializeJob(job));
});

// POST /api/campaigns/:campaign/generate/job/:id/accept
// { rev, scenes?, npcs?, locations?, chapter?, chapterTitle? }
//   -> { scenes, npcs, locations, jobDeleted }
// The single-accept action per proposed scene / npc / location, and the
// accept-all action for the rest. `scenes`, `npcs` and `locations` select
// proposals by id — the NPC run's one npc among the npcs; with none of them,
// EVERY scene still open is written plus every npc and location the DM
// accepted, and the NPC run's npc unless it was rejected — a dropped scene
// and a rejected npc or location are not open, so the bulk action never
// resurrects a "no". A selected scene carries the run's own npcs and
// location it names. A scene and an npc are written with the DM's changes
// (`sceneEdits`, `npcEdits`) on top of the model's. The answer lists the
// written ids.
//
// One transaction with the ordinary generator write: the conflict check
// lives inside it (409 { chapters, scenes, npcs, locations }), FTS and
// reference rows follow, and the job records what was written in that same
// commit. The job row disappears the moment nothing is left open
// (`jobDeleted`). `rev` is the review rev the client read and is re-checked
// inside that transaction: a decision made in between is a 409
// `rev_conflict` and nothing is written. 404 without a job or for a stale
// :id, 409 for a job that has no result, 400 for an unknown scene, npc or
// location id and for a BULK accept with nothing left to do. A named
// selection that is already written is not an error — a double click gets
// 200 with empty lists.
//
// A RUNNING pipelined run is acceptable part by part: it
// stays `running` while parts are open, and a `done` part is in the result
// and therefore acceptable before its siblings are. The 409 "no result" is
// kept for a failed run, and for a run that has not finished a single part.
generateRoutes.post("/campaigns/:campaign/generate/job/:id/accept", async (c) => {
  const body = await jsonBody(c, ["rev", "scenes", "npcs", "locations", "chapter", "chapterTitle"]);
  const rev = requireRev(body.rev);
  return c.json(await acceptJobParts(c.req.param("campaign"), c.req.param("id"), rev, body));
});

// POST /api/campaigns/:campaign/generate/job/:id/parts/:key/retry -> the job (202)
// The retry action for ONE part of a pipelined scene run.
// Only that part is re-run: the outline stays, the finished parts stay
// reviewable and acceptable, and the retried part goes back through exactly
// the call it failed on — same outline, same source excerpt, same
// validation. The answer is the job with the part back in `running`, so the
// app needs no extra read before its next poll.
//
// 404 without a job, for a stale :id and for an unknown part key; 409 for a
// job that has no pipeline (a single-call npc or augment run) and for a part
// that is already running, has not run yet (`pending` — the run's own queue
// still owns it) or is already done — a double click must not spend tokens
// twice; 503 when no provider is configured.
generateRoutes.post("/campaigns/:campaign/generate/job/:id/parts/:key/retry", async (c) => {
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await retryJobPart(
    c.req.param("campaign"),
    c.req.param("id"),
    c.req.param("key"),
    provider,
  );
  return c.json(serializeJob(job), 202);
});

// GET /api/campaigns/:campaign/generate/job -> GenerateJob (404 when there is none).
// The job carries its status (running/done/failed) with `kind`,
// result/npcResult/sceneAugmentResult/npcAugmentResult/locationAugmentResult,
// the error body and the review edits (`sceneEdits`, `npcEdits`); a
// `scene-augment` job also carries `scene`, an `npc-augment` job `npc` and a
// `location-augment` job `location` — the id — from the moment it STARTS. A
// scene run's `result` lists its proposed scenes under `scenes`, its
// proposed npcs under `npcs` and its proposed locations under `locations`
// (each the entity without its guard); an NPC run's `npcResult` carries its
// one npc the same way. A finished result may carry `namingHints`: the
// SERVER's own findings that a proposal still spells something a naming
// convention replaces — hints for the review, never a reason to fail or
// block. And it carries the REVIEW STATE with that state's `rev`: the
// decision per proposed npc and location, the dropped scenes, the per
// field/block decisions of an augment run and the parts a partial accept
// already wrote (`review.writtenScenes`, `review.writtenNpcs` and
// `review.writtenLocations`, ids).
// The campaign is NOT re-validated here: the job store is the authority for
// this endpoint, and "no job" is the honest answer for an unknown campaign
// too. Polled by the generator route while a job runs (~3s) and once per
// campaign mount by the topbar's run indicator.
generateRoutes.get("/campaigns/:campaign/generate/job", async (c) => {
  const job = await getJob(c.req.param("campaign"));
  if (job === undefined) throw new ApiError(404, "no generate job for this campaign");
  return c.json(serializeJob(job));
});

// DELETE /api/campaigns/:campaign/generate/job -> { deleted: true } (discarding the run).
// Works for every status — a running job is abandoned, its result never
// lands (see finish() in generate-jobs.ts). 404 when there is none.
generateRoutes.delete("/campaigns/:campaign/generate/job", async (c) => {
  if (!(await deleteJob(c.req.param("campaign")))) {
    throw new ApiError(404, "no generate job for this campaign");
  }
  return c.json({ deleted: true });
});

// POST /api/campaigns/:campaign/generate/apply
// { scenes?, npcs?, locations?, chapter?, chapterTitle?, jobId? }
//   -> { scenes, npcs, locations }
// Writes the reviewed run — synchronous on purpose: this is a short write,
// and the DM waits for its result. A proposed scene, npc or location is the
// entity without its guard, checked against its schema and re-validated
// server-side (a scene is a draft) — a scene run's npcs and the NPC run's
// one npc alike. 409 { chapters, scenes, npcs, locations } when any target
// holds something — then nothing is written at all. chapter +
// chapterTitle (both or neither) additionally create the chapter when it
// is missing, in the same all-or-nothing batch (the app's new-chapter
// flow).
// `jobId` ties the apply to the background job it came from: a
// SUCCESSFUL apply discards that job — the proposals are stored, there is
// nothing left to restore. A stale id (a newer run started meanwhile) is
// ignored rather than dropping the wrong job. That discard is
// part of the write TRANSACTION (store/generated.ts writeGenerated), so the
// written rows and the job can never disagree after a crash.
generateRoutes.post("/campaigns/:campaign/generate/apply", async (c) => {
  const body = await jsonBody(c, [
    "scenes",
    "npcs",
    "locations",
    "chapter",
    "chapterTitle",
    "jobId",
  ]);
  const campaign = c.req.param("campaign");
  const jobId = body.jobId;
  if (jobId !== undefined && typeof jobId !== "string") {
    throw new ApiError(400, "jobId must be a string");
  }
  const written = await applyGenerated(campaign, body, jobId);
  return c.json(written);
});
