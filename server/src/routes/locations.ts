// The locations: list, read, create, write and the AI augment run.
//
// A LOCATION IS ITS OWN RESOURCE (ADR #31): `…/locations` and
// `…/locations/:id`, answering the `Location` type — every field of the
// location flat, `body` among them, beside its `rev`.

import { Hono } from "hono";
import { ApiError } from "../api-error";
import { startJob } from "../generate-jobs";
import { obtainProvider } from "../generator";
import { applyLocationAugment } from "../location-augment";
import { createLocation, listLocations, patchLocation, readLocation } from "../store/locations";
import { jsonBody, optionalText, requiredText } from "./http";

export const locationRoutes = new Hono();

// GET /api/campaigns/:campaign/locations -> Location[] — every location of
// the campaign, sorted by name, each exactly as its own GET answers it.
locationRoutes.get("/campaigns/:campaign/locations", async (c) =>
  c.json(await listLocations(c.req.param("campaign"))),
);

// GET /api/campaigns/:campaign/locations/:id -> Location
// `{ id, name, chapter?, roll20Page?, atmosphere?, body, rev }` — every field
// of the location flat, an optional one absent when the location does not
// carry it, and `rev` the guard its PATCH sends back. 404 for an unknown
// campaign or location.
locationRoutes.get("/campaigns/:campaign/locations/:id", async (c) =>
  c.json(await readLocation(c.req.param("campaign"), c.req.param("id"))),
);

// POST /api/campaigns/:campaign/locations { name, id? } -> 201 Location
// (the rules of POST …/npcs in ./npcs.ts)
locationRoutes.post("/campaigns/:campaign/locations", async (c) => {
  const body = await jsonBody(c, ["name", "id"]);
  const name = requiredText(body.name, "name");
  return c.json(
    await createLocation(c.req.param("campaign"), name, optionalText(body.id, "id")),
    201,
  );
});

// PATCH /api/campaigns/:campaign/locations/:id
//   { rev, force?, id?, name?, chapter?, roll20Page?, atmosphere?, body? } -> Location
// THE write of one location (ADR #23): any subset of its fields — `body` is
// one of them — in ONE row update against ONE `rev`, checked against the
// location's schema. `null` clears an optional field; a key that is not a
// field of a location, or a value of the wrong shape, is a 400 that names it.
// A request that names no field is a 400 { code: "nothing_to_write" }. The
// `id` may be echoed, never changed (400), and a `chapter` has to name a
// chapter that exists (400 with the create-this-first code).
//
// A stale `rev` is 409 { code: "rev_conflict", rev, location } and writes
// nothing — `location` is the location as it stands now. `force: true`
// writes the given fields on top of that current row instead: only what this
// request carries is written, so a field changed in between survives a
// forced save of the text. 404 for an unknown campaign or location.
locationRoutes.patch("/campaigns/:campaign/locations/:id", async (c) => {
  const body = await jsonBody(c, null);
  return c.json(await patchLocation(c.req.param("campaign"), c.req.param("id"), body));
});

// POST /api/campaigns/:campaign/locations/:id/augment { sourceText?, instruction? }
// -> 202 { jobId } — the AI augment run of one location, on the location's
// own resource: the same background job model as every other run
// (`kind: "location-augment"`, the job's `location` the id), ONE generator
// job per campaign, so a start while ANY run is going answers 409 { jobId }.
// Writes NOTHING; the proposal waits in the job as `locationAugmentResult` —
// the location as the run read it (`current`) beside the location as the
// model proposes it (`proposed`), both without their guard.
//
// Synchronous, before a job exists: 400 for a malformed body and when
// NEITHER sourceText nor instruction carries text; 404 for an unknown
// campaign or location; 503 without a configured provider.
locationRoutes.post("/campaigns/:campaign/locations/:id/augment", async (c) => {
  const body = await jsonBody(c, ["sourceText", "instruction"]);
  const campaign = c.req.param("campaign");
  const location = c.req.param("id");
  const sourceText = optionalText(body.sourceText, "sourceText") ?? "";
  const instruction = optionalText(body.instruction, "instruction") ?? "";
  if (sourceText === "" && instruction === "") {
    throw new ApiError(400, "sourceText or instruction is required");
  }
  await readLocation(campaign, location); // 404 unknown
  const provider = obtainProvider(); // 503 when nothing is configured
  const job = await startJob({
    kind: "location-augment",
    campaign,
    location,
    sourceText,
    instruction,
    provider,
  });
  return c.json({ jobId: job.id }, 202);
});

// POST /api/campaigns/:campaign/locations/:id/augment/apply
// { rev, jobId?, name?, chapter?, roll20Page?, atmosphere?, body? } -> Location
// Accepting the reviewed proposal: the fields the DM took and the body they
// assembled from the accepted blocks — the location's PATCH without `force`
// and without `id` (a proposal never changes it) — written in ONE
// transaction against `rev`: 409 { code: "rev_conflict", rev, location }
// when the location moved underneath, and then NOTHING is written. FTS and
// `[[id]]` reference rows follow because this is the location's ordinary
// write; `jobId` discards the augment job in that same transaction. A request
// that takes nothing is a 400.
locationRoutes.post("/campaigns/:campaign/locations/:id/augment/apply", async (c) => {
  const { jobId, ...patch } = await jsonBody(c, null);
  if (jobId !== undefined && typeof jobId !== "string") {
    throw new ApiError(400, "jobId must be a string");
  }
  return c.json(
    await applyLocationAugment(c.req.param("campaign"), c.req.param("id"), patch, jobId),
  );
});
