// The proposed locations of a scene run (decisions/resources): their own typed list
// `result.locations`, decided by id (`review.locations`), accepted by id
// (`review.writtenLocations` on the job's PATCH), which is also the record of
// what is written.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { locationProposalSchema, type GeneratorJob, type Location } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generator-jobs";
import { setProviderForTests } from "../src/generator";
import { dropStore, seedStore } from "./support/store";
import { PipelineFake } from "./support/pipeline-fake";
import {
  acceptBody,
  jobsUrl,
  jobUrl,
  openSelection,
  readJob,
  writtenBy,
  type Selection,
} from "./support/generator-jobs";

const SCENE_AT_MOLE = "an-der-mole";
const SCENE_AT_TOWER = "am-turm";

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

const fetchJob = (): Promise<GeneratorJob | null> => readJob("beispiel");

async function runJob(): Promise<GeneratorJob> {
  const res = await send("POST", jobsUrl("beispiel"), {
    kind: "scene",
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

/** PATCH the job's review decisions with the rev the caller read. */
const patchReview = (job: GeneratorJob, review: Record<string, unknown>): Promise<Response> =>
  send("PATCH", jobUrl("beispiel", job.id), { rev: job.rev, review });

/** Accept a selection — or, without one, everything "accept all" names. */
const accept = (job: GeneratorJob, selection: Selection = openSelection(job)): Promise<Response> =>
  send("PATCH", jobUrl("beispiel", job.id), acceptBody(job, selection));

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
  const after = (await decided.json()) as GeneratorJob;
  expect(after.review?.locations).toEqual({ "alte-mole": "rejected" });
  const undone = (await (await patchReview(after, { locations: { "alte-mole": null } })).json()) as GeneratorJob;
  expect(undone.review?.locations).toEqual({});
  expect((await patchReview(undone, { locations: { "gibt-es-nicht": "accepted" } })).status).toBe(400);
});

test("accepting one location by id writes it to the location resource", async () => {
  const job = await runJob();
  const res = await accept(job, { locations: ["alte-mole"] });
  expect(res.status).toBe(200);
  expect(writtenBy(job, (await res.json()) as GeneratorJob)).toEqual({
    scenes: [],
    npcs: [],
    locations: ["alte-mole"],
  });
  const written = await readLocation("alte-mole");
  expect(written).toMatchObject({ ...MOLE, body: "## Beim ersten Betreten\n\nNebel.\n" });
  const after = (await fetchJob())!;
  expect(after.review?.writtenLocations).toEqual(["alte-mole"]);
  // Accepted twice is nothing to do, not an error — and the job stays.
  const again = await accept(after, { locations: ["alte-mole"] });
  expect(again.status).toBe(200);
  const unchanged = (await again.json()) as GeneratorJob;
  expect(writtenBy(after, unchanged)).toEqual({ scenes: [], npcs: [], locations: [] });
  expect(await fetchJob()).not.toBeNull();
  expect((await accept(unchanged, { locations: ["gibt-es-nicht"] })).status).toBe(400);
});

test("a scene carries the location it is set at; the other scene does not", async () => {
  const job = await runJob();
  const tower = await accept(job, { scenes: [SCENE_AT_TOWER] });
  expect(writtenBy(job, (await tower.json()) as GeneratorJob).locations).toEqual([]);
  expect(await readLocation("alte-mole")).toBeUndefined();

  const before = (await fetchJob())!;
  const mole = await accept(before, { scenes: [SCENE_AT_MOLE] });
  expect(mole.status).toBe(200);
  expect(writtenBy(before, (await mole.json()) as GeneratorJob)).toEqual({
    scenes: [SCENE_AT_MOLE],
    npcs: [],
    locations: ["alte-mole"],
  });
  // Everything is written now, so the job is gone.
  expect(await fetchJob()).toBeNull();
  expect(await readLocation("alte-mole")).toBeDefined();
});

test("accepting all that is open names an ACCEPTED location, never an undecided one", async () => {
  const undecided = await runJob();
  const scenesOnly = (await (await patchReview(undecided, { droppedScenes: [SCENE_AT_MOLE] })).json()) as GeneratorJob;
  const all = await accept(scenesOnly);
  expect(writtenBy(scenesOnly, (await all.json()) as GeneratorJob).locations).toEqual([]);
  expect(await readLocation("alte-mole")).toBeUndefined();

  const open = (await fetchJob())!;
  const accepted = (await (await patchReview(open, { locations: { "alte-mole": "accepted" } })).json()) as GeneratorJob;
  const second = await accept(accepted);
  expect(writtenBy(accepted, (await second.json()) as GeneratorJob).locations).toEqual(["alte-mole"]);
  expect(await fetchJob()).toBeNull();
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
  expect(await res.json()).toMatchObject({ chapters: [], scenes: [], locations: ["alte-mole"] });
  expect((await readLocation("alte-mole"))?.body).toBe("Schon beschrieben.\n");
});
