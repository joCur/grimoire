// The proposed locations of a scene run (ADR #31): their own typed list
// `result.locations`, decided by id (`review.locations`), accepted by id
// (`accept { locations }`) and recorded by id (`review.writtenLocations`).

import { afterEach, beforeEach, expect, test } from "bun:test";
import { locationProposalSchema, type GenerateJob, type Location } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generate-jobs";
import { setProviderForTests } from "../src/generator";
import { dropStore, seedStore } from "./support/store";
import { PipelineFake } from "./support/pipeline-fake";

const SCENE_AT_MOLE = "01-salzhafen/an-der-mole";
const SCENE_AT_TOWER = "01-salzhafen/am-turm";

function scene(id: string, title: string, location: string) {
  return {
    properties: {
      id,
      title,
      type: "planned",
      chapter: "01-salzhafen",
      location,
      npcs: ["fenn"],
      status: "draft",
    },
    body: "## Flow\n\nFenn wartet.\n",
  };
}

const MOLE = {
  id: "alte-mole",
  name: "Die alte Mole",
  chapter: "01-salzhafen",
  atmosphere: "Morsches Holz, Möwen.",
};

const REPLY = JSON.stringify({
  scenes: [
    { content: scene("an-der-mole", "An der Mole", "alte-mole") },
    { content: scene("am-turm", "Am Turm", "leuchtturm") },
  ],
  entries: [
    { kind: "location", content: { properties: MOLE, body: "## Beim ersten Betreten\n\nNebel.\n" } },
  ],
  warnings: [],
});

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

async function fetchJob(): Promise<GenerateJob | null> {
  const res = await app.request("/api/campaigns/beispiel/generate/job");
  if (res.status === 404) return null;
  return (await res.json()) as GenerateJob;
}

async function runJob(): Promise<GenerateJob> {
  const res = await send("POST", "/api/campaigns/beispiel/generate", {
    chapter: "01-salzhafen",
    sourceText: "Fenn waits at the old mole.",
  });
  expect(res.status).toBe(202);
  for (let i = 0; i < 2000; i++) {
    const job = await fetchJob();
    if (job === null) throw new Error("job disappeared");
    if (job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("job never finished");
}

async function readLocation(id: string): Promise<Location | undefined> {
  const res = await app.request(`/api/campaigns/beispiel/locations/${id}`);
  return res.status === 200 ? ((await res.json()) as Location) : undefined;
}

const patchReview = (job: GenerateJob, body: Record<string, unknown>): Promise<Response> =>
  send("PATCH", `/api/campaigns/beispiel/generate/job/${job.id}/review`, { rev: job.rev ?? 0, ...body });

const accept = (job: GenerateJob, body: Record<string, unknown> = {}): Promise<Response> =>
  send("POST", `/api/campaigns/beispiel/generate/job/${job.id}/accept`, { rev: job.rev ?? 0, ...body });

beforeEach(async () => {
  await seedStore();
  setProviderForTests(new PipelineFake([REPLY]));
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

test("a proposed location is a location of its own list — no kind, no path", async () => {
  const job = await runJob();
  expect(job.result?.npcs).toEqual([]);
  expect(job.result?.locations).toEqual([
    { ...MOLE, body: "## Beim ersten Betreten\n\nNebel.\n" },
  ]);
  // The reply said `roll20Page: null` ("not given"); the proposal is the
  // location without its guard, where an optional field is absent instead.
  for (const location of job.result?.locations ?? []) {
    expect(Object.keys(location)).not.toContain("roll20Page");
    expect(Object.values(location)).not.toContain(null);
    expect(locationProposalSchema.safeParse(location).success).toBe(true);
  }
  expect(job.review?.locations).toEqual({});
  expect(job.review?.writtenLocations).toEqual([]);
});

test("the decision is stored by id; an id the run did not propose is a 400", async () => {
  const job = await runJob();
  const decided = await patchReview(job, { locations: { "alte-mole": "rejected" } });
  expect(decided.status).toBe(200);
  const after = (await decided.json()) as GenerateJob;
  expect(after.review?.locations).toEqual({ "alte-mole": "rejected" });
  const undone = (await (await patchReview(after, { locations: { "alte-mole": null } })).json()) as GenerateJob;
  expect(undone.review?.locations).toEqual({});
  expect((await patchReview(undone, { locations: { "gibt-es-nicht": "accepted" } })).status).toBe(400);
});

test("accepting one location by id writes it to the location resource", async () => {
  const job = await runJob();
  const res = await accept(job, { locations: ["alte-mole"] });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    written: {},
    npcs: [],
    locations: ["alte-mole"],
    jobDeleted: false,
  });
  const written = await readLocation("alte-mole");
  expect(written).toMatchObject({ ...MOLE, body: "## Beim ersten Betreten\n\nNebel.\n" });
  const after = (await fetchJob())!;
  expect(after.review?.writtenLocations).toEqual(["alte-mole"]);
  // Accepted twice is nothing to do, not an error.
  const again = await accept(after, { locations: ["alte-mole"] });
  expect(await again.json()).toEqual({ written: {}, npcs: [], locations: [], jobDeleted: false });
  expect((await accept(after, { locations: ["gibt-es-nicht"] })).status).toBe(400);
});

test("a scene carries the location it is set at; the other scene does not", async () => {
  const job = await runJob();
  const tower = await accept(job, { paths: [SCENE_AT_TOWER] });
  expect(((await tower.json()) as { locations: string[] }).locations).toEqual([]);
  expect(await readLocation("alte-mole")).toBeUndefined();

  const mole = await accept((await fetchJob())!, { paths: [SCENE_AT_MOLE] });
  expect(mole.status).toBe(200);
  // Everything is written now, so the job disappears by itself.
  expect(await mole.json()).toEqual({
    written: { [SCENE_AT_MOLE]: "01-salzhafen/alte-mole/an-der-mole" },
    npcs: [],
    locations: ["alte-mole"],
    jobDeleted: true,
  });
  expect(await readLocation("alte-mole")).toBeDefined();
});

test("accept-all writes an ACCEPTED location, never an undecided or a rejected one", async () => {
  const undecided = await runJob();
  const scenesOnly = (await (await patchReview(undecided, { dropped: [SCENE_AT_MOLE] })).json()) as GenerateJob;
  const bulk = await accept(scenesOnly);
  expect(((await bulk.json()) as { locations: string[] }).locations).toEqual([]);
  expect(await readLocation("alte-mole")).toBeUndefined();

  const open = (await fetchJob())!;
  const accepted = (await (await patchReview(open, { locations: { "alte-mole": "accepted" } })).json()) as GenerateJob;
  const second = await accept(accepted);
  expect(await second.json()).toMatchObject({ locations: ["alte-mole"], jobDeleted: true });
  expect(await readLocation("alte-mole")).toBeDefined();
});

test("a location that already holds content is a conflict, reported by id", async () => {
  const job = await runJob();
  const created = await send("POST", "/api/campaigns/beispiel/locations", {
    name: "Die alte Mole",
    id: "alte-mole",
  });
  expect(created.status).toBe(201);
  const location = (await created.json()) as Location;
  const filled = await send("PATCH", "/api/campaigns/beispiel/locations/alte-mole", {
    rev: location.rev,
    body: "Schon beschrieben.\n",
  });
  expect(filled.status).toBe(200);

  const res = await accept(job, { locations: ["alte-mole"] });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ conflicts: [], locations: ["alte-mole"] });
  expect((await readLocation("alte-mole"))?.body).toBe("Schon beschrieben.\n");
});
