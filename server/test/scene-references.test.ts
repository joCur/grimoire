// A proposed scene is written only once every npc and location of its run it
// names exists (decisions/generator): accepting a scene writes that scene and
// nothing else, and a scene whose `npcs` or `location` name a proposal of the
// run that is not written is refused — until the DM accepts that proposal,
// removes the reference, or drops the scene. A `[[id]]` in the text is not a
// reference.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { GeneratorJob, Scene } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generator-jobs";
import { setProviderForTests } from "../src/generator";
import { dropStore, seedStore } from "./support/store";
import { PipelineFake } from "./support/pipeline-fake";
import { acceptBody, jobsUrl, jobUrl, readJob, writtenBy } from "./support/generator-jobs";

/** The scene that names the run's npc and the run's location. */
const NAMING = "grella-at-the-mole";
/** The scene that only mentions the run's npc in its text. */
const MENTIONING = "rumours-at-the-quay";
const NPC = "grella";
const LOCATION = "old-mole";

const REPLY = JSON.stringify({
  scenes: [
    {
      content: {
        properties: {
          id: NAMING,
          title: "Grella at the Mole",
          type: "planned",
          chapter: "01-salt-harbour",
          location: LOCATION,
          npcs: ["fenn", NPC],
          status: "draft",
        },
        body: "## Flow\n\n[[grella]] waits for [[fenn]].\n",
      },
    },
    {
      content: {
        properties: {
          id: MENTIONING,
          title: "Rumours at the Quay",
          type: "planned",
          chapter: "01-salt-harbour",
          location: "lighthouse",
          npcs: ["fenn"],
          status: "draft",
        },
        body: "## Flow\n\nFenn has heard of [[grella]].\n",
      },
    },
  ],
  entries: [
    {
      kind: "npc",
      content: {
        properties: { id: NPC, name: "Grella", chapter: "01-salt-harbour", status: "alive" },
        body: "## Wants\n\nOut of the trade.\n",
      },
    },
    {
      kind: "location",
      content: {
        properties: { id: LOCATION, name: "The Old Mole", chapter: "01-salt-harbour" },
        body: "## On first entering\n\nFog.\n",
      },
    },
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

const fetchJob = (): Promise<GeneratorJob | null> => readJob("example");

async function runJob(): Promise<GeneratorJob> {
  const res = await send("POST", jobsUrl("example"), {
    kind: "scene",
    chapter: "01-salt-harbour",
    sourceText: "Grella waits at the old mole.",
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

/** PATCH the job with the rev the caller read; answers the job it leaves. */
async function patch(job: GeneratorJob, body: Record<string, unknown>): Promise<GeneratorJob> {
  const res = await send("PATCH", jobUrl("example", job.id), { rev: job.rev, ...body });
  expect(res.status).toBe(200);
  return (await res.json()) as GeneratorJob;
}

async function exists(resource: string, id: string): Promise<boolean> {
  return (await app.request(`/api/campaigns/example/${resource}/${id}`)).status === 200;
}

beforeEach(async () => {
  await seedStore();
  setProviderForTests(new PipelineFake([REPLY]));
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

test("accepting a scene writes that scene and nothing else; a [[id]] mention does not block", async () => {
  const job = await runJob();
  const res = await send("PATCH", jobUrl("example", job.id), acceptBody(job, { scenes: [MENTIONING] }));
  expect(res.status).toBe(200);
  expect(writtenBy(job, (await res.json()) as GeneratorJob)).toEqual({
    scenes: [MENTIONING],
    npcs: [],
    locations: [],
  });
  expect(await exists("scenes", MENTIONING)).toBe(true);
  expect(await exists("npcs", NPC)).toBe(false);
  expect(await exists("locations", LOCATION)).toBe(false);
});

test("a scene naming a run npc that is not written is a 409 naming it, and nothing is written", async () => {
  const started = await runJob();
  const job = await patch(started, { review: { writtenLocations: [LOCATION] } });
  const res = await send("PATCH", jobUrl("example", job.id), acceptBody(job, { scenes: [NAMING] }));
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({
    code: "proposal_not_written",
    scenes: [NAMING],
    npcs: [NPC],
    locations: [],
  });
  expect(await exists("scenes", NAMING)).toBe(false);
  expect(await exists("npcs", NPC)).toBe(false);
  const after = (await fetchJob())!;
  expect(after.rev).toBe(job.rev);
  expect(after.review).toEqual(job.review);
});

test("a rejected npc is accepted after all by taking the decision back in the accept", async () => {
  const started = await runJob();
  const rejected = await patch(started, {
    review: { writtenLocations: [LOCATION], npcs: { [NPC]: "rejected" } },
  });
  // Rejected, it blocks the scene that names it…
  const refused = await send("PATCH", jobUrl("example", rejected.id), acceptBody(rejected, { scenes: [NAMING] }));
  expect(refused.status).toBe(409);
  // …and a plain accept of it is refused as well: it is not open.
  const notOpen = await send("PATCH", jobUrl("example", rejected.id), acceptBody(rejected, { npcs: [NPC] }));
  expect(notOpen.status).toBe(409);

  const accepted = await patch(rejected, { review: { npcs: { [NPC]: null }, writtenNpcs: [NPC] } });
  expect(accepted.review.writtenNpcs).toEqual([NPC]);
  expect(accepted.review.npcs).toEqual({});
  expect(await exists("npcs", NPC)).toBe(true);

  const scene = await patch(accepted, { review: { writtenScenes: [NAMING] } });
  expect(scene.review.writtenScenes).toEqual([NAMING]);
});

test("removing the reference in the review lets the scene be written without it", async () => {
  const started = await runJob();
  const rejected = await patch(started, { review: { npcs: { [NPC]: "rejected" }, locations: { [LOCATION]: "rejected" } } });
  const edited = await patch(rejected, { sceneEdits: { [NAMING]: { npcs: ["fenn"], location: null } } });
  await patch(edited, { review: { writtenScenes: [NAMING] } });
  const written = (await (await app.request(`/api/campaigns/example/scenes/${NAMING}`)).json()) as Scene;
  expect(written.npcs).toEqual(["fenn"]);
  expect(Object.hasOwn(written, "location")).toBe(false);
  expect(await exists("npcs", NPC)).toBe(false);
  expect(await exists("locations", LOCATION)).toBe(false);
});

test("dropping the scene that names a rejected npc settles the run", async () => {
  const started = await runJob();
  const decided = await patch(started, {
    review: { npcs: { [NPC]: "rejected" }, locations: { [LOCATION]: "rejected" }, droppedScenes: [NAMING] },
  });
  await patch(decided, { review: { writtenScenes: [MENTIONING] } });
  expect(await fetchJob()).toBeNull();
  expect(await exists("scenes", NAMING)).toBe(false);
});

test("the stage of the review is stored on the job; an unknown stage is a 400", async () => {
  const job = await runJob();
  expect(job.review.stage).toBe("locations");
  const moved = await patch(job, { review: { stage: "scenes" } });
  expect(moved.review.stage).toBe("scenes");
  expect((await fetchJob())!.review.stage).toBe("scenes");
  const res = await send("PATCH", jobUrl("example", job.id), { rev: moved.rev, review: { stage: "chapters" } });
  expect(res.status).toBe(400);
});
