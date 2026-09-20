// In which order an accepted run lands in its chapter.
//
// The outline step decides the dramaturgical sequence of a run's scenes, and
// `job.result.scenes` carries it. Accepting writes each scene to the end of
// its chapter, so the WRITE order is the order the DM then reads in the
// chapter overview (ADR #27) — and it has to be the outline's, whatever order
// the review names its paths in.
//
// The harness is the generator suite's: one fresh in-memory database per
// case, seeded from the example campaign, and a scripted PipelineFake instead
// of an LLM, so a run really goes through the pipeline.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { CampaignTree, GenerateJob } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generate-jobs";
import { setProviderForTests } from "../src/generator";
import { dropStore, seedStore } from "./support/store";
import { PipelineFake } from "./support/pipeline-fake";

const CAMPAIGN = "beispiel";
/** The chapter the example campaign brings, with its two fixture scenes. */
const EXISTING_CHAPTER = "01-salzhafen";
const FIXTURE_SCENES = ["lighthouse-arrival", "smuggler-captured"];
/** A chapter that does not exist yet — the accept creates it. */
const NEW_CHAPTER = "04-tiefwasser";

/** The outline order of the scripted run: first, second, third. */
const OUTLINE = ["erste-szene", "zweite-szene", "dritte-szene"];

function sceneDraft(id: string, chapter: string): { properties: Record<string, unknown>; body: string } {
  return {
    properties: {
      id,
      title: id,
      type: "planned",
      chapter,
      location: "leuchtturm",
      npcs: ["fenn"],
      tags: ["social"],
      status: "draft",
    },
    body: "## Flow\n\nFenn wartet am Kai.\n",
  };
}

/**
 * The scripted batch: three scenes in outline order and no suggested entries,
 * so the only thing that can move a scene is the accept's own ordering.
 */
function reply(chapter: string): string {
  return JSON.stringify({
    scenes: OUTLINE.map((id) => ({ content: sceneDraft(id, chapter) })),
    entries: [],
    warnings: [],
  });
}

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

async function fetchJob(): Promise<GenerateJob | null> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/generate/job`);
  if (res.status === 404) return null;
  expect(res.status).toBe(200);
  return (await res.json()) as GenerateJob;
}

/** Start a run on `chapter` and wait until its job is finished. */
async function runJob(chapter: string, newChapter = false): Promise<GenerateJob> {
  setProviderForTests(new PipelineFake([reply(chapter)]));
  const res = await send("POST", `/api/campaigns/${CAMPAIGN}/generate`, {
    chapter,
    sourceText: "Fenn waits at the docks.",
    ...(newChapter ? { newChapter: true, chapterTitle: "Tiefwasser" } : {}),
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

const accept = (job: GenerateJob, body: Record<string, unknown> = {}): Promise<Response> =>
  send("POST", `/api/campaigns/${CAMPAIGN}/generate/job/${job.id}/accept`, {
    rev: job.rev ?? 0,
    ...body,
  });

/** The chapter's scenes in the order the overview reads them. */
async function sceneIds(chapter: string): Promise<string[]> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/tree`);
  expect(res.status).toBe(200);
  const tree = (await res.json()) as CampaignTree;
  const node = tree.chapters.find((c) => c.id === chapter);
  expect(node).toBeDefined();
  return node!.scenes.map((scene) => scene.id);
}

/** The path the review addresses a scene draft with. */
const reviewPath = (chapter: string, id: string): string => `${chapter}/${id}`;

beforeEach(async () => {
  await seedStore();
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

test("a complete accept writes the scenes in outline order", async () => {
  const job = await runJob(NEW_CHAPTER, true);
  expect((await accept(job)).status).toBe(200);

  expect(await sceneIds(NEW_CHAPTER)).toEqual(OUTLINE);
});

test("a selection sent in REVERSE order still lands in outline order", async () => {
  const job = await runJob(NEW_CHAPTER, true);
  const paths = [...OUTLINE].reverse().map((id) => reviewPath(NEW_CHAPTER, id));
  expect((await accept(job, { paths })).status).toBe(200);

  expect(await sceneIds(NEW_CHAPTER)).toEqual(OUTLINE);
});

test("a run into an existing chapter appends behind its scenes", async () => {
  expect(await sceneIds(EXISTING_CHAPTER)).toEqual(FIXTURE_SCENES);

  const job = await runJob(EXISTING_CHAPTER);
  expect((await accept(job)).status).toBe(200);

  expect(await sceneIds(EXISTING_CHAPTER)).toEqual([...FIXTURE_SCENES, ...OUTLINE]);
});
