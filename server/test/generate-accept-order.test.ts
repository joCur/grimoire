// In which order an accepted run lands in its chapter.
//
// The outline step decides the dramaturgical sequence of a run's scenes, and
// that sequence is what the DM has to read in the chapter overview (decisions/scene-order)
// — whatever order the review names its scenes in, and however many accepts
// it takes. A scene of the run goes to the run's START plus its outline
// number: the start is the chapter's end at the first scene accept, stored
// on the job; after a hand reorder of the chapter the rest of the run is
// appended at the end instead.
//
// The harness is the generator suite's: one fresh in-memory database per
// case, seeded from the example campaign, and a scripted PipelineFake instead
// of an LLM, so a run really goes through the pipeline. The restart case
// runs on a database file of its own, because a restart is what it is about.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { CampaignTree, ChapterNode, GeneratorJob, Scene } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests } from "../src/generator-jobs";
import { setProviderForTests } from "../src/generator";
import type { CompletionResult, CorrectionTurn, GenerateRequest } from "../src/llm-provider";
import { generateJobs, scenes } from "../src/db/schema";
import { readFixtureCampaign, seedCampaign } from "../src/db/seed";
import { closeStore, getDb, initStore } from "../src/store/handle";
import { dropStore, FIXTURES, seedStore } from "./support/store";
import { PipelineFake } from "./support/pipeline-fake";
import {
  acceptBody,
  jobsUrl,
  jobUrl,
  openSelection,
  readJob,
  type Selection,
} from "./support/generator-jobs";

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

const fetchJob = (): Promise<GeneratorJob | null> => readJob(CAMPAIGN);

/** Start a run on `chapter` and wait until its job is finished. */
async function runJob(chapter: string, newChapter = false): Promise<GeneratorJob> {
  setProviderForTests(new PipelineFake([reply(chapter)]));
  const res = await send("POST", jobsUrl(CAMPAIGN), {
    kind: "scene",
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

/** Accept a selection — or, without one, everything "accept all" names. */
const accept = (job: GeneratorJob, selection: Selection = openSelection(job)): Promise<Response> =>
  send("PATCH", jobUrl(CAMPAIGN, job.id), acceptBody(job, selection));

/** The chapter node of the tree: its scenes in order and the order's guard. */
async function chapterNode(chapter: string): Promise<ChapterNode> {
  const res = await app.request(`/api/campaigns/${CAMPAIGN}/tree`);
  expect(res.status).toBe(200);
  const tree = (await res.json()) as CampaignTree;
  const node = tree.chapters.find((c) => c.id === chapter);
  expect(node).toBeDefined();
  return node!;
}

/** The chapter's scenes in the order the overview reads them. */
async function sceneIds(chapter: string): Promise<string[]> {
  return (await chapterNode(chapter)).scenes.map((scene) => scene.id);
}

/**
 * Accept the named scenes of the CURRENT job, one call per scene and in the
 * order given — each call reads the job afresh, because every accept moves
 * the review rev.
 */
async function acceptOneByOne(chapter: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const job = await fetchJob();
    expect(job).not.toBeNull();
    expect(job!.result?.scenes.find((scene) => scene.id === id)?.chapter).toBe(chapter);
    const res = await accept(job!, { scenes: [id] });
    expect(res.status).toBe(200);
  }
}

/** The start the job row holds for its scenes, straight from the column. */
async function storedSceneStart(): Promise<unknown> {
  const db = await getDb();
  const row = db
    .select({ pipeline: generateJobs.pipeline })
    .from(generateJobs)
    .where(eq(generateJobs.campaignId, CAMPAIGN))
    .all()[0];
  expect(row).toBeDefined();
  return (JSON.parse(row!.pipeline) as { sceneStart?: unknown }).sceneStart;
}

/** The stored `pos` of one scene. */
async function posOf(id: string): Promise<number | undefined> {
  const db = await getDb();
  return db.select({ pos: scenes.pos }).from(scenes).where(eq(scenes.id, id)).all()[0]?.pos;
}

/** Create a scene by hand, through the ordinary create endpoint. */
async function createScene(title: string, chapter: string): Promise<string> {
  const res = await send("POST", `/api/campaigns/${CAMPAIGN}/scenes`, { title, chapter });
  expect(res.status).toBe(201);
  return ((await res.json()) as Scene).id;
}

/** Reorder the chapter by hand, against its current order guard. */
async function reorder(chapter: string, order: string[]): Promise<void> {
  const node = await chapterNode(chapter);
  const res = await send("PUT", `/api/campaigns/${CAMPAIGN}/chapters/${chapter}/scene-order`, {
    scenes: order,
    rev: node.sceneOrderRev,
  });
  expect(res.status).toBe(200);
}

/** The `rev` of a chapter or of a scene, each on its own resource. */
async function revOf(url: string): Promise<number> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return ((await res.json()) as { rev: number }).rev;
}

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
  expect((await accept(job, { scenes: [...OUTLINE].reverse() })).status).toBe(200);

  expect(await sceneIds(NEW_CHAPTER)).toEqual(OUTLINE);
});

test("a run into an existing chapter appends behind its scenes", async () => {
  expect(await sceneIds(EXISTING_CHAPTER)).toEqual(FIXTURE_SCENES);

  const job = await runJob(EXISTING_CHAPTER);
  expect((await accept(job)).status).toBe(200);

  expect(await sceneIds(EXISTING_CHAPTER)).toEqual([...FIXTURE_SCENES, ...OUTLINE]);
});

// --- a run accepted across several calls ------------------------------------

test("scenes accepted one by one in REVERSE land in outline order behind the chapter", async () => {
  await runJob(EXISTING_CHAPTER);
  await acceptOneByOne(EXISTING_CHAPTER, [...OUTLINE].reverse());

  expect(await sceneIds(EXISTING_CHAPTER)).toEqual([...FIXTURE_SCENES, ...OUTLINE]);
});

test("any order across calls ends in outline order — the middle one first", async () => {
  await runJob(EXISTING_CHAPTER);
  await acceptOneByOne(EXISTING_CHAPTER, ["zweite-szene", "dritte-szene", "erste-szene"]);

  expect(await sceneIds(EXISTING_CHAPTER)).toEqual([...FIXTURE_SCENES, ...OUTLINE]);
});

test("a new chapter's run starts at 0 and keeps its order across calls", async () => {
  await runJob(NEW_CHAPTER, true);
  await acceptOneByOne(NEW_CHAPTER, ["dritte-szene"]);
  expect(await storedSceneStart()).toEqual({ pos: 0, sceneOrderRev: 1 });

  await acceptOneByOne(NEW_CHAPTER, ["erste-szene", "zweite-szene"]);
  expect(await sceneIds(NEW_CHAPTER)).toEqual(OUTLINE);
  expect(await posOf("erste-szene")).toBe(0);
  expect(await posOf("dritte-szene")).toBe(2);
});

test("a dropped scene keeps its number and leaves a gap", async () => {
  const job = await runJob(EXISTING_CHAPTER);
  const dropped = await send("PATCH", jobUrl(CAMPAIGN, job.id), {
    rev: job.rev,
    review: { droppedScenes: ["zweite-szene"] },
  });
  expect(dropped.status).toBe(200);
  await acceptOneByOne(EXISTING_CHAPTER, ["dritte-szene", "erste-szene"]);

  expect(await sceneIds(EXISTING_CHAPTER)).toEqual([
    ...FIXTURE_SCENES,
    "erste-szene",
    "dritte-szene",
  ]);
  // Start 2 (behind the two fixture scenes), numbers 0 and 2: the gap is
  // where the dropped scene would have stood.
  expect(await posOf("erste-szene")).toBe(2);
  expect(await posOf("dritte-szene")).toBe(4);
});

// --- the start ----------------------------------------------------------------

test("the start is taken at the FIRST scene accept, not when the run starts", async () => {
  await runJob(EXISTING_CHAPTER);
  // Nothing accepted yet, so nothing is fixed yet.
  expect(await storedSceneStart()).toBeUndefined();

  await acceptOneByOne(EXISTING_CHAPTER, ["dritte-szene"]);
  expect(await storedSceneStart()).toEqual({ pos: 2, sceneOrderRev: 1 });
});

test("a scene created by hand before the first accept stands before the run", async () => {
  await runJob(EXISTING_CHAPTER);
  const handMade = await createScene("Von Hand dazwischen", EXISTING_CHAPTER);
  // Creating a scene is not a reorder: the order guard stays where it was.
  expect((await chapterNode(EXISTING_CHAPTER)).sceneOrderRev).toBe(1);

  await acceptOneByOne(EXISTING_CHAPTER, [...OUTLINE].reverse());
  expect(await sceneIds(EXISTING_CHAPTER)).toEqual([...FIXTURE_SCENES, handMade, ...OUTLINE]);
});

test("the start is not recomputed: a later accept of an earlier scene takes its place", async () => {
  await runJob(EXISTING_CHAPTER);
  await acceptOneByOne(EXISTING_CHAPTER, ["dritte-szene"]);
  // A scene created by hand now goes to the END — behind the accepted one.
  // A start recomputed from here would put the two earlier scenes behind it.
  const handMade = await createScene("Von Hand danach", EXISTING_CHAPTER);

  await acceptOneByOne(EXISTING_CHAPTER, ["zweite-szene"]);
  expect(await storedSceneStart()).toEqual({ pos: 2, sceneOrderRev: 1 });
  await acceptOneByOne(EXISTING_CHAPTER, ["erste-szene"]);
  expect(await sceneIds(EXISTING_CHAPTER)).toEqual([...FIXTURE_SCENES, ...OUTLINE, handMade]);
});

test("the start survives a server restart between two accepts", async () => {
  // A database FILE, so the second open is a real reopen of the same data.
  const dir = mkdtempSync(path.join(tmpdir(), "grimoire-accept-order-"));
  const dbFile = path.join(dir, "grimoire.db");
  try {
    closeStore();
    const db = await initStore({ dbFile });
    seedCampaign(db, await readFixtureCampaign(path.join(FIXTURES, "beispiel")));
    await runJob(EXISTING_CHAPTER);
    await acceptOneByOne(EXISTING_CHAPTER, ["dritte-szene"]);
    const start = await storedSceneStart();
    expect(start).toEqual({ pos: 2, sceneOrderRev: 1 });

    closeStore();
    await initStore({ dbFile });
    expect(await storedSceneStart()).toEqual(start);
    // The chapter's end moved with the first accept — only the stored start
    // can put the two earlier scenes in front of it.
    await acceptOneByOne(EXISTING_CHAPTER, ["zweite-szene", "erste-szene"]);
    expect(await sceneIds(EXISTING_CHAPTER)).toEqual([...FIXTURE_SCENES, ...OUTLINE]);
  } finally {
    await clearJobsForTests();
    closeStore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the start outlasts the run's own writes while a part is still running", async () => {
  // The LAST scene's call is held, so the first accept happens mid-run and
  // the part that finishes afterwards rewrites the pipeline column.
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  class HoldingFake extends PipelineFake {
    override async complete(
      req: GenerateRequest,
      corrections: CorrectionTurn[] = [],
    ): Promise<CompletionResult> {
      if (req.assignment?.startsWith("dritte-szene ") === true) await held;
      return super.complete(req, corrections);
    }
  }
  setProviderForTests(new HoldingFake([reply(EXISTING_CHAPTER)]));
  const res = await send("POST", jobsUrl(CAMPAIGN), {
    kind: "scene",
    chapter: EXISTING_CHAPTER,
    sourceText: "Fenn waits at the docks.",
  });
  expect(res.status).toBe(202);
  for (let i = 0; i < 2000; i++) {
    const job = await fetchJob();
    if ((job?.pipeline?.parts.filter((p) => p.status === "done").length ?? 0) === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  await acceptOneByOne(EXISTING_CHAPTER, ["zweite-szene"]);
  expect(await storedSceneStart()).toEqual({ pos: 2, sceneOrderRev: 1 });

  release?.();
  for (let i = 0; i < 2000; i++) {
    if ((await fetchJob())?.status === "done") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  expect(await storedSceneStart()).toEqual({ pos: 2, sceneOrderRev: 1 });

  await acceptOneByOne(EXISTING_CHAPTER, ["dritte-szene", "erste-szene"]);
  expect(await sceneIds(EXISTING_CHAPTER)).toEqual([...FIXTURE_SCENES, ...OUTLINE]);
});

// --- the hand order wins ------------------------------------------------------

test("after a hand reorder the rest of the run goes to the end", async () => {
  await runJob(EXISTING_CHAPTER);
  await acceptOneByOne(EXISTING_CHAPTER, ["dritte-szene"]);
  const handOrder = ["dritte-szene", ...FIXTURE_SCENES];
  await reorder(EXISTING_CHAPTER, handOrder);
  const guard = (await chapterNode(EXISTING_CHAPTER)).sceneOrderRev;

  await acceptOneByOne(EXISTING_CHAPTER, ["zweite-szene", "erste-szene"]);
  // The DM's order stays as it was, and what came after it is appended in
  // the order it was accepted — like any new scene.
  expect(await sceneIds(EXISTING_CHAPTER)).toEqual([...handOrder, "zweite-szene", "erste-szene"]);
  // The start is not re-based either, and the accepts left the guard alone.
  expect((await chapterNode(EXISTING_CHAPTER)).sceneOrderRev).toBe(guard);
});

// --- what an accept does not touch -------------------------------------------

test("no accept moves the order guard, the chapter's rev or an existing scene's rev", async () => {
  const arrival = `/api/campaigns/${CAMPAIGN}/scenes/lighthouse-arrival`;
  const before = {
    order: (await chapterNode(EXISTING_CHAPTER)).sceneOrderRev,
    chapter: await revOf(`/api/campaigns/${CAMPAIGN}/chapters/${EXISTING_CHAPTER}`),
    scene: await revOf(arrival),
  };

  await runJob(EXISTING_CHAPTER);
  await acceptOneByOne(EXISTING_CHAPTER, ["dritte-szene", "erste-szene"]);
  const after = {
    order: (await chapterNode(EXISTING_CHAPTER)).sceneOrderRev,
    chapter: await revOf(`/api/campaigns/${CAMPAIGN}/chapters/${EXISTING_CHAPTER}`),
    scene: await revOf(arrival),
  };
  expect(after).toEqual(before);
});
