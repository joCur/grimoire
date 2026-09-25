// The scenes: list, read, create, write and the AI augment run.
//
// A SCENE IS ITS OWN RESOURCE (ADR #31): `…/scenes` and `…/scenes/:id`,
// answering the `Scene` type — every field of the scene flat, `body` among
// them, beside its `rev`. It lies flat under its campaign: its id is unique
// per campaign, and its chapter is a field. Where a scene stands in its
// chapter is the chapter's scene order (`PUT …/chapters/:chapter/scene-order`,
// ./chapters.ts).

import { Hono } from "hono";
import { sceneCreateSchema } from "@grimoire/shared";
import { ApiError } from "../api-error";
import { startJob } from "../generate-jobs";
import { obtainProvider } from "../generator";
import { applySceneAugment } from "../scene-augment";
import { createScene, listScenes, patchScene, readScene } from "../store/scenes";
import { parseRequest } from "../store/shared";
import { jsonBody, optionalText, requiredText } from "./http";

export const sceneRoutes = new Hono();

// GET /api/campaigns/:campaign/scenes -> Scene[] — every scene of the
// campaign, chapter by chapter in the chapters' order and inside a chapter in
// the order the DM set, each exactly as its own GET answers it.
sceneRoutes.get("/campaigns/:campaign/scenes", async (c) =>
  c.json(await listScenes(c.req.param("campaign"))),
);

// GET /api/campaigns/:campaign/scenes/:id -> Scene
// `{ id, title, type, trigger?, chapter, location?, npcs, handouts, tags,
// status, body, rev }` — every field of the scene flat, an optional one
// absent when the scene does not carry it, the three lists empty when the
// scene names nothing, and `rev` the guard its PATCH sends back. 404 for an
// unknown campaign or scene.
sceneRoutes.get("/campaigns/:campaign/scenes/:id", async (c) =>
  c.json(await readScene(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/scenes { title, chapter, id? } -> 201 Scene
// The id is derived from `title` unless the request sets it. `chapter` is
// required and must exist (400 { code: "chapter_unknown" }) — a scene belongs
// to a chapter, and chapters are never created by being named (ADR #19). The
// scene is appended to the END of its chapter and holds its title and nothing
// else. A taken id is 409 { code: "slug_taken", kind, id, suggestion } and
// writes nothing. A key that is none of the three, or a value of the wrong
// shape, is a 400 that names it.
sceneRoutes.post("/campaigns/:campaign/scenes", async (c) => {
  const request = parseRequest(sceneCreateSchema, await jsonBody(c, null), "scene");
  const title = requiredText(request.title, "title");
  const chapter = requiredText(request.chapter, "chapter");
  return c.json(
    await createScene(c.req.param("campaign"), title, chapter, optionalText(request.id, "id")),
    201,
  );
});

// PATCH /api/campaigns/:campaign/scenes/:id
//   { rev, force?, id?, title?, type?, trigger?, chapter?, location?, npcs?,
//     handouts?, tags?, status?, body? } -> Scene
// THE write of one scene (ADR #23): any subset of its fields — `body` is one
// of them — in ONE row update against ONE `rev`, checked against the scene's
// schema. `null` clears an optional field (`trigger`, `location`); a key that
// is not a field of a scene, or a value of the wrong shape, is a 400 that
// names it. A `status` outside the four is 400 { code: "status_not_allowed" },
// a `type` outside the two 400 { code: "scene_type_not_allowed" }. A request
// that names no field is 400 { code: "nothing_to_write" }. The `id` may be
// echoed, never changed (400).
//
// Every reference has to name something that exists, or the write is 400
// with the create-this-first code (`chapter_unknown`, `location_unknown`,
// `npc_unknown`); a `location` that is not an id at all is 400
// { code: "location_not_an_id", suggestion }. The `chapter` can change but
// never be cleared (400 { code: "chapter_required" }). A scene that changes
// chapter lands at the END of the new one; the scene order's own guard
// (`scene_order_rev`) does not move.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, scene } and writes nothing
// — `scene` is the scene as it stands now. `force: true` writes the given
// fields on top of that current row instead: only what this request carries
// is written, so a field changed in between survives a forced save of the
// text. 404 for an unknown campaign or scene.
sceneRoutes.patch("/campaigns/:campaign/scenes/:id", async (c) => {
  const body = await jsonBody(c, null);
  return c.json(await patchScene(c.req.param("campaign"), c.req.param("id"), body));
});

// POST /api/campaigns/:campaign/scenes/:id/augment { sourceText?, instruction? }
// -> 202 { jobId } — the AI augment run of one scene, on the scene's own
// resource: the same background job model as every other run
// (`kind: "scene-augment"`, the job's `scene` the id), ONE generator job per
// campaign, so a start while ANY run is going answers 409 { jobId }. Writes
// NOTHING; the proposal waits in the job as `sceneAugmentResult` — the scene
// as the run read it (`current`) beside the scene as the model proposes it
// (`proposed`), both without their guard.
//
// Synchronous, before a job exists: 400 for a malformed body and when
// NEITHER sourceText nor instruction carries text; 404 for an unknown
// campaign or scene; 503 without a configured provider.
sceneRoutes.post("/campaigns/:campaign/scenes/:id/augment", async (c) => {
  const body = await jsonBody(c, ["sourceText", "instruction"]);
  const campaign = c.req.param("campaign");
  const scene = c.req.param("id");
  const sourceText = optionalText(body.sourceText, "sourceText") ?? "";
  const instruction = optionalText(body.instruction, "instruction") ?? "";
  if (sourceText === "" && instruction === "") {
    throw new ApiError(400, "sourceText or instruction is required");
  }
  await readScene(campaign, scene); // 404 unknown
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "scene-augment",
    campaign,
    scene,
    sourceText,
    instruction,
    provider,
  });
  return c.json({ jobId: job.id }, 202);
});

// POST /api/campaigns/:campaign/scenes/:id/augment/apply
// { rev, jobId?, title?, type?, trigger?, chapter?, location?, npcs?,
//   handouts?, tags?, status?, body? } -> Scene
// Accepting the reviewed proposal: the fields the DM took and the body they
// assembled from the accepted blocks — the scene's PATCH without `force` and
// without `id` (a proposal never changes it) — written in ONE transaction
// against `rev`: 409 { code: "rev_conflict", rev, scene } when the scene moved
// underneath, and then NOTHING is written. FTS and `[[id]]` reference rows
// follow because this is the scene's ordinary write; `jobId` discards the
// augment job in that same transaction. A request that takes nothing is a
// 400.
sceneRoutes.post("/campaigns/:campaign/scenes/:id/augment/apply", async (c) => {
  const { jobId, ...patch } = await jsonBody(c, null);
  if (jobId !== undefined && typeof jobId !== "string") {
    throw new ApiError(400, "jobId must be a string");
  }
  return c.json(
    await applySceneAugment(c.req.param("campaign"), c.req.param("id"), patch, jobId),
  );
});
