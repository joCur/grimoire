// Review state on the job and PARTIAL accept.
//
// The harness is the generator suite's: a database seeded from the example
// campaign and a scripted FakeProvider instead of an LLM, so a run really
// goes through the pipeline and the review state sits on a real job row.
// One fresh store PER CASE — several cases write the same scene, and its id
// is the primary key.
//
// What is asserted is the promise: nothing the DM does in the review is lost. The state is a ROW (so it comes back after a restart), a
// second tab loses the race with a 409 instead of overwriting, „Diesen
// übernehmen" writes exactly one part and leaves the rest reviewable, and
// the job disappears by itself the moment nothing is open.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { GenerateJob } from "@grimoire/shared";
import { app } from "../src/server";
import { clearJobsForTests, markWrittenInTx } from "../src/generate-jobs";
import { getDb } from "../src/store/handle";
import { setProviderForTests } from "../src/generator";
import { dropStore, seedStore } from "./support/store";
import { PipelineFake } from "./support/pipeline-fake";
import { entriesUrl } from "./support/urls";

// --- fixtures -----------------------------------------------------------------

// The scenes the run proposes — named by their ids, like the npc below: a
// scene is its own resource (ADR #31) and a proposal carries no address.
const SCENE_A = "treffen-am-kai";
const SCENE_B = "nacht-am-kai";
/** The npc the run proposes — named by its id, on its own resource (ADR #31). */
const NPC_ID = "grella";

interface Draft {
  properties: Record<string, unknown>;
  body: string;
}

const SCENE_BODY = "## Flow\n\nFenn wartet am Kai.\n";

function sceneDraft(id: string, title: string, chapter = "01-salzhafen"): Draft {
  return {
    properties: {
      id,
      title,
      type: "planned",
      chapter,
      location: "leuchtturm",
      npcs: ["fenn"],
      tags: ["social"],
      status: "draft",
    },
    body: SCENE_BODY,
  };
}

function proposedNpc(chapter = "01-salzhafen"): Draft {
  return {
    properties: {
      id: "grella",
      name: "Grella",
      role: "Schmugglerin mit eigenen Plänen",
      chapter,
      status: "alive",
    },
    body: "## Will\n\nIm Quelltext nur erwähnt.\n",
  };
}

const REPLY = JSON.stringify({
  scenes: [
    { content: sceneDraft("treffen-am-kai", "Treffen am Kai") },
    { content: sceneDraft("nacht-am-kai", "Nacht am Kai") },
  ],
  entries: [{ kind: "npc", content: proposedNpc() }],
  warnings: [],
});

// --- plumbing -----------------------------------------------------------------

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
  expect(res.status).toBe(200);
  return (await res.json()) as GenerateJob;
}

/** Start a scene run and wait until its job is finished. */
async function runJob(): Promise<GenerateJob> {
  const res = await send("POST", "/api/campaigns/beispiel/generate", {
    chapter: "01-salzhafen",
    sourceText: "Fenn waits at the docks.",
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

/** PATCH the review with the rev the caller read. */
async function patch(job: GenerateJob, body: Record<string, unknown>): Promise<GenerateJob> {
  const res = await send("PATCH", `/api/campaigns/beispiel/generate/job/${job.id}/review`, {
    rev: job.rev ?? 0,
    ...body,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as GenerateJob;
}

const accept = (job: GenerateJob, body: Record<string, unknown> = {}): Promise<Response> =>
  send("POST", `/api/campaigns/beispiel/generate/job/${job.id}/accept`, { rev: job.rev ?? 0, ...body });

async function exists(id: string): Promise<boolean> {
  const res = await app.request(`/api/campaigns/beispiel/scenes/${id}`);
  return res.status === 200;
}

async function chapterExists(id: string): Promise<boolean> {
  const res = await app.request(entriesUrl("beispiel", id));
  return res.status === 200;
}

async function npcExists(id: string): Promise<boolean> {
  const res = await app.request(`/api/campaigns/beispiel/npcs/${id}`);
  return res.status === 200;
}

beforeEach(async () => {
  await seedStore();
  // Pipeline-aware: a scene run is the outline call plus one
  // call per scene and per proposed npc, and the fake routes this one
  // scripted batch reply over all of them (support/pipeline-fake.ts).
  setProviderForTests(new PipelineFake([REPLY]));
});

afterEach(async () => {
  setProviderForTests(null);
  await clearJobsForTests();
  dropStore();
});

// --- the review patch ----------------------------------------------------------

test("a fresh job carries an empty review state and rev 0", async () => {
  const job = await runJob();
  expect(job.rev).toBe(0);
  expect(job.review).toEqual({
    droppedScenes: [],
    fields: {},
    blocks: {},
    writtenScenes: [],
    npcs: {},
    writtenNpcs: [],
    locations: {},
    writtenLocations: [],
  });
  expect(job.npcEdits).toEqual({});
  expect(job.sceneEdits).toEqual({});
});

test("the patch merges text, decisions and drops — and bumps the rev", async () => {
  let job = await runJob();

  job = await patch(job, { sceneEdits: { [SCENE_A]: { body: "edited body" } } });
  expect(job.sceneEdits[SCENE_A]).toEqual({ body: "edited body" });
  expect(job.rev).toBe(1);

  // Only what the patch names moves — the earlier edit stays.
  job = await patch(job, { npcs: { [NPC_ID]: "rejected" }, droppedScenes: [SCENE_B] });
  expect(job.sceneEdits[SCENE_A]).toEqual({ body: "edited body" });
  expect(job.review?.npcs[NPC_ID]).toBe("rejected");
  expect(job.review?.droppedScenes).toEqual([SCENE_B]);
  expect(job.rev).toBe(2);

  // `null` puts a decided entry back to OPEN — the review's third state.
  job = await patch(job, { npcs: { [NPC_ID]: null } });
  expect(job.review?.npcs).toEqual({});
});

test("augment decisions per property and per block are stored as booleans", async () => {
  let job = await runJob();
  job = await patch(job, { fields: { role: true }, blocks: { aug2: false } });
  expect(job.review?.fields).toEqual({ role: true });
  expect(job.review?.blocks).toEqual({ aug2: false });
});

test("null CLEARS a field or block decision — the keys an augment conflict renames", async () => {
  // A 409 re-aligns the proposal against the body that won, and the block
  // ids move with it. The decisions cut
  // against the old ids have to be removable, not just overwritable.
  let job = await runJob();
  job = await patch(job, { fields: { role: true }, blocks: { aug1: true, aug2: false } });
  job = await patch(job, { blocks: { aug1: null, aug2: null } });
  expect(job.review?.blocks).toEqual({});
  expect(job.review?.fields).toEqual({ role: true });

  job = await patch(job, { fields: { role: null } });
  expect(job.review?.fields).toEqual({});
  // It survives the round trip through the row, like every other decision.
  expect((await fetchJob())?.review?.blocks).toEqual({});
});

test("a field or block value that is neither a boolean nor null is a 400", async () => {
  const job = await runJob();
  const res = await send("PATCH", `/api/campaigns/beispiel/generate/job/${job.id}/review`, {
    rev: job.rev ?? 0,
    blocks: { aug1: "ja" },
  });
  expect(res.status).toBe(400);
});

test("a stale rev is a 409 rev_conflict carrying the current rev; nothing is written", async () => {
  const job = await runJob();
  await patch(job, { sceneEdits: { [SCENE_A]: { body: "first" } } });

  // The second tab still holds rev 0.
  const res = await send("PATCH", `/api/campaigns/beispiel/generate/job/${job.id}/review`, {
    rev: 0,
    sceneEdits: { [SCENE_A]: { body: "second" } },
  });
  expect(res.status).toBe(409);
  const body = (await res.json()) as { code: string; rev: number };
  expect(body.code).toBe("rev_conflict");
  expect(body.rev).toBe(1);
  expect((await fetchJob())?.sceneEdits[SCENE_A]).toEqual({ body: "first" });
});

test("a patch for another job id is a 404", async () => {
  await runJob();
  const res = await send("PATCH", "/api/campaigns/beispiel/generate/job/does-not-exist/review", { rev: 0 });
  expect(res.status).toBe(404);
});

test("the review state comes back from the row — the round trip a restart makes", async () => {
  const started = await runJob();
  const job = await patch(started, {
    sceneEdits: { [SCENE_A]: { body: "survives" } },
    npcs: { [NPC_ID]: "accepted" },
    droppedScenes: [SCENE_B],
  });

  // A restart is nothing but a fresh read of the row: the process keeps no
  // review state of its own, which is the whole point of the column.
  const again = await fetchJob();
  expect(again?.sceneEdits[SCENE_A]).toEqual({ body: "survives" });
  expect(again?.review?.npcs[NPC_ID]).toBe("accepted");
  expect(again?.review?.droppedScenes).toEqual([SCENE_B]);
  expect(again?.rev).toBe(job.rev);
});

test("an npc edit is stored by id, field by field, and is what the accept writes", async () => {
  let job = await runJob();
  job = await patch(job, { npcEdits: { [NPC_ID]: { role: "Schmugglerin, die aussteigen will" } } });
  job = await patch(job, { npcEdits: { [NPC_ID]: { body: "Kennt jeden Steg.\n", chapter: null } } });
  expect(job.npcEdits[NPC_ID]).toEqual({
    role: "Schmugglerin, die aussteigen will",
    body: "Kennt jeden Steg.\n",
    chapter: null,
  });
  // The model's npc stays the model's; the change lives beside it.
  expect(job.result?.npcs[0]?.role).toBe("Schmugglerin mit eigenen Plänen");

  expect((await accept(job, { npcs: [NPC_ID] })).status).toBe(200);
  const res = await app.request(`/api/campaigns/beispiel/npcs/${NPC_ID}`);
  expect(await res.json()).toMatchObject({
    id: NPC_ID,
    name: "Grella",
    role: "Schmugglerin, die aussteigen will",
    status: "alive",
    body: "Kennt jeden Steg.\n",
  });
  expect(Object.hasOwn(await (await app.request(`/api/campaigns/beispiel/npcs/${NPC_ID}`)).json(), "chapter")).toBe(false);
});

test("an npc edit for an npc the run did not propose, or with a foreign field, is a 400", async () => {
  const job = await runJob();
  const url = `/api/campaigns/beispiel/generate/job/${job.id}/review`;
  const unknown = await send("PATCH", url, { rev: job.rev ?? 0, npcEdits: { holm: { role: "X" } } });
  expect(unknown.status).toBe(400);
  const foreign = await send("PATCH", url, { rev: job.rev ?? 0, npcEdits: { [NPC_ID]: { atmosphere: "X" } } });
  expect(foreign.status).toBe(400);
  expect(((await foreign.json()) as { error: string }).error).toContain("atmosphere");
  // The id is what the edit is keyed by — an edit never changes it.
  const renamed = await send("PATCH", url, { rev: job.rev ?? 0, npcEdits: { [NPC_ID]: { id: "x" } } });
  expect(renamed.status).toBe(400);
  expect((await fetchJob())?.npcEdits).toEqual({});
});

// --- partial accept -------------------------------------------------------------

test('„Diesen übernehmen" writes only the selection and marks it on the job', async () => {
  const job = await runJob();
  const res = await accept(job, { scenes: [SCENE_A] });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { scenes: string[]; jobDeleted: boolean };
  expect(body.scenes).toEqual([SCENE_A]);
  expect(body.jobDeleted).toBe(false);

  expect(await exists(SCENE_A)).toBe(true);
  expect(await exists(SCENE_B)).toBe(false);

  // The rest stays reviewable, and the written part is on the job.
  const after = await fetchJob();
  expect(after?.review?.writtenScenes).toEqual([SCENE_A]);
  expect(after?.result?.scenes).toHaveLength(2);
});

test("a scene edit is stored by id, field by field, and is what the accept writes", async () => {
  let job = await runJob();
  job = await patch(job, { sceneEdits: { [SCENE_A]: { title: "Treffen im Regen" } } });
  job = await patch(job, {
    sceneEdits: {
      [SCENE_A]: {
        body: SCENE_BODY.replace("Fenn wartet am Kai.", "Fenn wartet im Regen."),
        location: null,
      },
    },
  });
  expect(job.sceneEdits[SCENE_A]).toEqual({
    title: "Treffen im Regen",
    body: "## Flow\n\nFenn wartet im Regen.\n",
    location: null,
  });
  // The model's scene stays the model's; the change lives beside it.
  expect(job.result?.scenes.find((scene) => scene.id === SCENE_A)?.title).toBe("Treffen am Kai");

  expect((await accept(job, { scenes: [SCENE_A] })).status).toBe(200);
  const res = await app.request(`/api/campaigns/beispiel/scenes/${SCENE_A}`);
  const stored = (await res.json()) as Record<string, unknown>;
  expect(stored).toMatchObject({
    title: "Treffen im Regen",
    body: "## Flow\n\nFenn wartet im Regen.\n",
    npcs: ["fenn"],
    status: "draft",
  });
  expect(Object.hasOwn(stored, "location")).toBe(false);
});

test("a scene edit for a scene the run did not propose, or with a foreign field, is a 400", async () => {
  const job = await runJob();
  const url = `/api/campaigns/beispiel/generate/job/${job.id}/review`;
  const unknown = await send("PATCH", url, { rev: job.rev ?? 0, sceneEdits: { nope: { title: "X" } } });
  expect(unknown.status).toBe(400);
  const foreign = await send("PATCH", url, {
    rev: job.rev ?? 0,
    sceneEdits: { [SCENE_A]: { properties: { title: "X" } } },
  });
  expect(foreign.status).toBe(400);
  expect(((await foreign.json()) as { error: string }).error).toContain("properties");
  const renamed = await send("PATCH", url, { rev: job.rev ?? 0, sceneEdits: { [SCENE_A]: { id: "x" } } });
  expect(renamed.status).toBe(400);
  const dropped = await send("PATCH", url, { rev: job.rev ?? 0, droppedScenes: ["nope"] });
  expect(dropped.status).toBe(400);
  expect((await fetchJob())?.sceneEdits).toEqual({});
});

test("accepting the same part twice answers 200 with nothing written", async () => {
  // A double click, or the second tab clicking what the first already wrote:
  // the caller asked for a state that already holds. The empty answer says so; a 400 said the DM did something
  // wrong and put an error line under a review that was in order.
  const job = await runJob();
  expect((await accept(job, { scenes: [SCENE_A] })).status).toBe(200);
  const again = (await fetchJob()) as GenerateJob;
  const res = await accept(again, { scenes: [SCENE_A] });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ scenes: [], npcs: [], locations: [], jobDeleted: false });
  // Nothing moved: the rest is still reviewable and the job is still there.
  expect((await fetchJob())?.review?.writtenScenes).toEqual([SCENE_A]);
});

test("a bulk accept with nothing open left stays a 400", async () => {
  // Everything dropped or rejected: „Alle übernehmen" names nothing and
  // there is nothing — a client bug, and still an error.
  const job = await patch(await runJob(), {
    droppedScenes: [SCENE_A, SCENE_B],
    npcs: { [NPC_ID]: "rejected" },
  });
  expect((await accept(job, {})).status).toBe(400);
});

test("an unknown scene is a 400", async () => {
  const job = await runJob();
  expect((await accept(job, { scenes: ["nope"] })).status).toBe(400);
});

test("the job deletes itself when every part is written, dropped or rejected", async () => {
  let job = await runJob();
  // The second scene is dropped and the proposed npc rejected — so the
  // ONE remaining part settles the whole run.
  job = await patch(job, { droppedScenes: [SCENE_B], npcs: { [NPC_ID]: "rejected" } });

  const res = await accept(job, { scenes: [SCENE_A] });
  expect(((await res.json()) as { jobDeleted: boolean }).jobDeleted).toBe(true);
  expect(await fetchJob()).toBeNull();
  // Only the accepted part exists.
  expect(await exists(SCENE_A)).toBe(true);
  expect(await exists(SCENE_B)).toBe(false);
  expect(await npcExists(NPC_ID)).toBe(false);
});

test('„Alle übernehmen" writes the open rest — never a dropped or rejected part', async () => {
  let job = await runJob();
  job = await patch(job, { npcs: { [NPC_ID]: "rejected" } });
  expect((await accept(job, { scenes: [SCENE_A] })).status).toBe(200);

  const rest = (await fetchJob()) as GenerateJob;
  const body = (await (await accept(rest, {})).json()) as {
    scenes: string[];
    jobDeleted: boolean;
  };
  expect(body.scenes).toEqual([SCENE_B]);
  expect(body.jobDeleted).toBe(true);
  expect(await npcExists(NPC_ID)).toBe(false);
});

test("a bulk accept skips an UNDECIDED proposed npc, an explicit one writes it", async () => {
  const job = await runJob();
  // Nothing decided about the npc: „Alle übernehmen" writes the scenes and
  // leaves it alone — the earlier rule, and the reason the job stays.
  const bulk = (await (await accept(job, {})).json()) as {
    scenes: string[];
    jobDeleted: boolean;
  };
  // In outline order.
  expect(bulk.scenes).toEqual([SCENE_A, SCENE_B]);
  expect(bulk.jobDeleted).toBe(false);
  expect(await npcExists(NPC_ID)).toBe(false);

  // Naming it is the decision: „Diesen übernehmen" on its row writes it, and
  // then nothing is open.
  const rest = (await fetchJob()) as GenerateJob;
  const one = (await (await accept(rest, { npcs: [NPC_ID] })).json()) as {
    jobDeleted: boolean;
  };
  expect(one.jobDeleted).toBe(true);
  expect(await npcExists(NPC_ID)).toBe(true);
});

test('„Verwerfen" removes only the open rest — what was written stays', async () => {
  const job = await runJob();
  expect((await accept(job, { scenes: [SCENE_A] })).status).toBe(200);

  const res = await send("DELETE", "/api/campaigns/beispiel/generate/job");
  expect(res.status).toBe(200);
  expect(await fetchJob()).toBeNull();
  // The accepted scene is a scene now, not a job.
  expect(await exists(SCENE_A)).toBe(true);
  expect(await exists(SCENE_B)).toBe(false);
});

test("an accept with a stale rev is a 409 rev_conflict and writes nothing", async () => {
  const job = await runJob();
  // Another tab decides something — the rev moves and this one's is stale.
  await patch(job, { npcs: { [NPC_ID]: "rejected" } });

  const res = await send("POST", `/api/campaigns/beispiel/generate/job/${job.id}/accept`, {
    rev: job.rev ?? 0,
    scenes: [SCENE_A],
  });
  expect(res.status).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe("rev_conflict");
  // Rolled back: no scene, and the job still has the part open.
  expect(await exists(SCENE_A)).toBe(false);
  expect((await fetchJob())?.review?.writtenScenes).toEqual([]);
});

test("an accept without a rev is a 400 — a defaulted guard is no guard", async () => {
  const job = await runJob();
  const res = await send("POST", `/api/campaigns/beispiel/generate/job/${job.id}/accept`, {
    scenes: [SCENE_A],
  });
  expect(res.status).toBe(400);
  expect(await exists(SCENE_A)).toBe(false);
});

test("a job that disappears mid-accept rolls the whole write back", async () => {
  const job = await runJob();
  // „Verwerfen" in another tab: the row is gone before the accept starts.
  expect((await send("DELETE", "/api/campaigns/beispiel/generate/job")).status).toBe(200);
  const res = await accept(job, { scenes: [SCENE_A] });
  expect(res.status).toBe(404);
  expect(await exists(SCENE_A)).toBe(false);
});

// The case above is caught by the pre-read; this one is the TRANSACTION's
// own guard — the row vanishing between plan and commit. It is reached
// directly because there is no way to interleave a delete into a synchronous
// SQLite transaction from a test. A quiet `false` here would commit the
// scenes while dropping the bookkeeping.
test("markWrittenInTx throws for a lost job instead of reporting false", async () => {
  const job = await runJob();
  const db = await getDb();
  expect(() =>
    db.transaction((handle) =>
      markWrittenInTx(handle as never, "beispiel", "a-job-that-is-gone", job.rev ?? 0, {
        scenes: [SCENE_A],
        npcs: [],
        locations: [],
      }),
    ),
  ).toThrow();
  expect((await fetchJob())?.review?.writtenScenes).toEqual([]);
});

// --- the new chapter ------------------------------------------------------------
//
// `chapter`/`chapterTitle` come from the JOB, not from the app's OWN state:
// the review state is persistent, so the accept regularly happens in a tab
// that never saw the start form. Scenes written under a chapter that has no
// row are invisible — the overview lists chapters from the chapter table
// and would show neither the chapter nor its scenes.
//
// „Reload" is modelled exactly as it reaches the server: an accept with NO
// chapter fields in the body. Nothing else about these cases is special — same
// run, same accept endpoint.

const NEW_CHAPTER = "03-drachenbrut";

// The same scripted batch as above, but for a run on a chapter that does not
// exist yet — the reply validation compares each scene's chapter against the
// run's, so the proposed scenes have to name this one.
const NEW_CHAPTER_REPLY = JSON.stringify({
  scenes: [
    { content: sceneDraft("treffen-am-kai", "Treffen am Kai", NEW_CHAPTER) },
    { content: sceneDraft("nacht-am-kai", "Nacht am Kai", NEW_CHAPTER) },
  ],
  entries: [{ kind: "npc", content: proposedNpc(NEW_CHAPTER) }],
  warnings: [],
});

/** Start a „Neues Kapitel" run and wait for it, like `runJob`. */
async function runNewChapterJob(
  title?: string,
  provider: PipelineFake = new PipelineFake([NEW_CHAPTER_REPLY]),
): Promise<GenerateJob> {
  setProviderForTests(provider);
  const res = await send("POST", "/api/campaigns/beispiel/generate", {
    chapter: NEW_CHAPTER,
    sourceText: "Eggs in the dark.",
    newChapter: true,
    ...(title === undefined ? {} : { chapterTitle: title }),
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

async function chapterTitles(): Promise<Record<string, string>> {
  const res = await app.request("/api/campaigns/beispiel/tree");
  expect(res.status).toBe(200);
  const tree = (await res.json()) as { chapters: Array<{ id: string; title: string }> };
  return Object.fromEntries(tree.chapters.map((chapter) => [chapter.id, chapter.title]));
}

test("an accept with NO chapter fields creates the chapter from the job's title", async () => {
  const job = await runNewChapterJob("Die Drachenbrut");
  // Exactly what the app sends after a navigation or a reload: a rev and
  // nothing else.
  expect((await accept(job, {})).status).toBe(200);

  expect(await chapterTitles()).toMatchObject({ [NEW_CHAPTER]: "Die Drachenbrut" });
  expect(await chapterExists(NEW_CHAPTER)).toBe(true);
});

test("the accepted scenes hang in that chapter and are visible in the tree", async () => {
  const job = await runNewChapterJob("Die Drachenbrut");
  expect((await accept(job, {})).status).toBe(200);

  const res = await app.request("/api/campaigns/beispiel/tree");
  const tree = (await res.json()) as {
    chapters: Array<{ id: string; scenes: Array<{ id: string }> }>;
  };
  const chapter = tree.chapters.find((c) => c.id === NEW_CHAPTER);
  expect((chapter?.scenes ?? []).length).toBeGreaterThan(0);
});

test("a run started without a title falls back to the chapter id", async () => {
  // An older app build, or a job from before the column existed.
  const job = await runNewChapterJob();
  expect((await accept(job, {})).status).toBe(200);
  expect(await chapterTitles()).toMatchObject({ [NEW_CHAPTER]: NEW_CHAPTER });
});

test("the body fields still override the job — compatibility", async () => {
  const job = await runNewChapterJob("Die Drachenbrut");
  expect(
    (await accept(job, { chapter: NEW_CHAPTER, chapterTitle: "Anders benannt" })).status,
  ).toBe(200);
  expect(await chapterTitles()).toMatchObject({ [NEW_CHAPTER]: "Anders benannt" });
});

test("creating the chapter is idempotent across two partial accepts", async () => {
  let job = await runNewChapterJob("Die Drachenbrut");
  expect((await accept(job, { scenes: [SCENE_A] })).status).toBe(200);
  const again = await fetchJob();
  expect(again).not.toBeNull();
  job = again as GenerateJob;
  // The second accept must not trip over the chapter it created itself.
  expect((await accept(job, {})).status).toBe(200);
  expect(await chapterTitles()).toMatchObject({ [NEW_CHAPTER]: "Die Drachenbrut" });
});

// A partial accept of the proposed npc ALONE — no scene in the batch, so
// nothing in it names the chapter. The chapter is still created, and that is
// intended: the target is decided from the job, not from what the accept
// happens to contain, so the chapter the run is for exists from the first
// accept onwards and the scenes accepted afterwards find it.
test("accepting only the proposed npc already creates the run's chapter", async () => {
  const job = await runNewChapterJob("Die Drachenbrut");
  expect((await accept(job, { npcs: [NPC_ID] })).status).toBe(200);

  expect(await npcExists(NPC_ID)).toBe(true);
  expect(await chapterTitles()).toMatchObject({ [NEW_CHAPTER]: "Die Drachenbrut" });
  expect(await chapterExists(NEW_CHAPTER)).toBe(true);
  // …and no scene was written by this accept.
  expect(await exists(SCENE_A)).toBe(false);

  // The scenes still accept afterwards, into the chapter that now exists.
  const rest = (await fetchJob()) as GenerateJob;
  expect(rest).not.toBeNull();
  expect((await accept(rest, {})).status).toBe(200);
  expect(await chapterTitles()).toMatchObject({ [NEW_CHAPTER]: "Die Drachenbrut" });
});

// --- the chapter description of a new-chapter run ------------------------------
//
// The outline of a „Neues Kapitel" run describes the chapter it creates, and
// that description is the chapter's text once the run is accepted. A run into
// an existing chapter never touches that chapter's text, whatever its outline
// says.

const DESCRIPTION = "Unter dem Leuchtturm brütet etwas. Die Gruppe soll das Gelege finden.";

/** The new-chapter batch with a description — padded, as a model may send it. */
function describedReply(description: string): string {
  return JSON.stringify({ ...JSON.parse(NEW_CHAPTER_REPLY), chapterDescription: `  ${description}\n` });
}

async function chapterBody(chapter: string): Promise<string> {
  const res = await app.request(entriesUrl("beispiel", chapter));
  expect(res.status).toBe(200);
  return ((await res.json()) as { body: string }).body;
}

test("a new-chapter run's description becomes the text of the chapter it creates", async () => {
  const fake = new PipelineFake([describedReply(DESCRIPTION)]);
  const job = await runNewChapterJob("Die Drachenbrut", fake);
  // Only the outline call hears that the chapter is new — it is the call
  // that describes it.
  expect(fake.callsFor("outline")[0]?.req.context.newChapter).toBe(true);
  expect(fake.callsFor("treffen-am-kai")[0]?.req.context.newChapter).toBeUndefined();
  // The review reads the description off the job, trimmed.
  expect(job.pipeline?.chapterDescription).toBe(DESCRIPTION);

  expect((await accept(job, {})).status).toBe(200);
  // Verbatim, one closing newline, and no heading around it.
  expect(await chapterBody(NEW_CHAPTER)).toBe(`${DESCRIPTION}\n`);
});

test("the body override names the chapter; the description still comes from the job", async () => {
  const job = await runNewChapterJob("Die Drachenbrut", new PipelineFake([describedReply(DESCRIPTION)]));
  expect(
    (await accept(job, { chapter: NEW_CHAPTER, chapterTitle: "Anders benannt" })).status,
  ).toBe(200);
  expect(await chapterBody(NEW_CHAPTER)).toBe(`${DESCRIPTION}\n`);
});

test("a new-chapter run without a description creates the chapter with an empty text", async () => {
  const job = await runNewChapterJob("Die Drachenbrut");
  expect(job.pipeline?.chapterDescription).toBeUndefined();
  expect((await accept(job, {})).status).toBe(200);
  expect(await chapterBody(NEW_CHAPTER)).toBe("");
});

test("a run into an existing chapter drops the description and leaves the chapter's text", async () => {
  const before = await chapterBody("01-salzhafen");
  const fake = new PipelineFake([
    JSON.stringify({ ...JSON.parse(REPLY), chapterDescription: "Ein ganz anderes Kapitel." }),
  ]);
  setProviderForTests(fake);
  const job = await runJob();
  expect(fake.callsFor("outline")[0]?.req.context.newChapter).toBeUndefined();
  expect(job.pipeline?.chapterDescription).toBeUndefined();

  expect((await accept(job, {})).status).toBe(200);
  expect(await chapterBody("01-salzhafen")).toBe(before);
});

test("a chapter that exists by the time of the accept keeps its own text", async () => {
  const job = await runNewChapterJob("Die Drachenbrut", new PipelineFake([describedReply(DESCRIPTION)]));
  // The DM created the chapter by hand while the run waited in the review.
  const created = await send("POST", "/api/campaigns/beispiel/chapters", {
    title: "Die Drachenbrut",
    id: NEW_CHAPTER,
    description: "Von Hand geschrieben.",
  });
  expect(created.status).toBe(201);

  expect((await accept(job, {})).status).toBe(200);
  expect(await chapterBody(NEW_CHAPTER)).toBe("Von Hand geschrieben.\n");
});
