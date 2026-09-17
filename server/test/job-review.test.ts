// Review state on the job and PARTIAL accept.
//
// The harness is the generator suite's: a database seeded from the example
// campaign and a scripted FakeProvider instead of an LLM, so a run really
// goes through the pipeline and the review state sits on a real job row.
// One fresh store PER CASE — several cases write the same scene, and the
// address is the primary key.
//
// What is asserted is the ticket's own promise: nothing the DM does in the
// review is lost. The state is a ROW (so it comes back after a restart), a
// second tab loses the race with a 409 instead of overwriting, „Diesen
// übernehmen" writes exactly one part and leaves the rest reviewable, and
// the job disappears by itself the moment nothing is open any more.

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

// The paths the REVIEW addresses the drafts with — `<chapter>/<id>`, built
// by the server from the run's chapter and the draft's id (the
// model names no address at all). The stored ADDRESS adds the group, which
// is the draft's `location` — so the two differ here on purpose, and the
// accept answers `{ <review path>: <written address> }`.
const SCENE_A = "01-salzhafen/treffen-am-kai";
const SCENE_B = "01-salzhafen/nacht-am-kai";
const ADDRESS_A = "01-salzhafen/leuchtturm/treffen-am-kai";
const ADDRESS_B = "01-salzhafen/leuchtturm/nacht-am-kai";
const STUB_PATH = "npcs/grella";

function sceneMarkdown(id: string, title: string): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "type: planned",
    "chapter: 01-salzhafen",
    "location: leuchtturm",
    "npcs: [fenn]",
    "tags: [social]",
    "status: draft",
    "---",
    "",
    "## Flow",
    "",
    "Fenn wartet am Kai.",
    "",
  ].join("\n");
}

const STUB_MARKDOWN = [
  "---",
  "id: grella",
  "name: Grella",
  "role: Schmugglerin mit eigenen Plänen",
  "chapter: 01-salzhafen",
  "status: alive",
  "---",
  "",
  "## Will",
  "",
  "Im Quelltext nur erwähnt.",
  "",
].join("\n");

const REPLY = JSON.stringify({
  scenes: [
    { content: sceneMarkdown("treffen-am-kai", "Treffen am Kai") },
    { content: sceneMarkdown("nacht-am-kai", "Nacht am Kai") },
  ],
  entries: [{ kind: "npc", content: STUB_MARKDOWN }],
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

async function exists(rel: string): Promise<boolean> {
  const res = await app.request(entriesUrl("beispiel", rel));
  return res.status === 200;
}

beforeEach(async () => {
  await seedStore();
  // Pipeline-aware: a scene run is the outline call plus one
  // call per scene and per suggested entry, and the fake routes this one
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
  expect(job.review).toEqual({ entries: {}, dropped: [], fields: {}, blocks: {}, written: {} });
});

test("the patch merges text, decisions and drops — and bumps the rev", async () => {
  let job = await runJob();

  job = await patch(job, { edits: { [SCENE_A]: "edited body" } });
  expect(job.draftEdits[SCENE_A]).toBe("edited body");
  expect(job.rev).toBe(1);

  // Only what the patch names moves — the earlier edit stays.
  job = await patch(job, { entries: { [STUB_PATH]: "rejected" }, dropped: [SCENE_B] });
  expect(job.draftEdits[SCENE_A]).toBe("edited body");
  expect(job.review?.entries[STUB_PATH]).toBe("rejected");
  expect(job.review?.dropped).toEqual([SCENE_B]);
  expect(job.rev).toBe(2);

  // `null` puts a decided entry back to OPEN — the review's third state.
  job = await patch(job, { entries: { [STUB_PATH]: null } });
  expect(job.review?.entries).toEqual({});
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
  await patch(job, { edits: { [SCENE_A]: "first" } });

  // The second tab still holds rev 0.
  const res = await send("PATCH", `/api/campaigns/beispiel/generate/job/${job.id}/review`, {
    rev: 0,
    edits: { [SCENE_A]: "second" },
  });
  expect(res.status).toBe(409);
  const body = (await res.json()) as { code: string; rev: number };
  expect(body.code).toBe("rev_conflict");
  expect(body.rev).toBe(1);
  expect((await fetchJob())?.draftEdits[SCENE_A]).toBe("first");
});

test("a patch for another job id is a 404", async () => {
  await runJob();
  const res = await send("PATCH", "/api/campaigns/beispiel/generate/job/does-not-exist/review", { rev: 0 });
  expect(res.status).toBe(404);
});

test("the review state comes back from the row — the round trip a restart makes", async () => {
  const started = await runJob();
  const job = await patch(started, {
    edits: { [SCENE_A]: "survives" },
    entries: { [STUB_PATH]: "accepted" },
    dropped: [SCENE_B],
  });

  // A restart is nothing but a fresh read of the row: the process keeps no
  // review state of its own, which is the whole point of the column.
  const again = await fetchJob();
  expect(again?.draftEdits[SCENE_A]).toBe("survives");
  expect(again?.review?.entries[STUB_PATH]).toBe("accepted");
  expect(again?.review?.dropped).toEqual([SCENE_B]);
  expect(again?.rev).toBe(job.rev);
});

// --- partial accept -------------------------------------------------------------

test('„Diesen übernehmen" writes only the selection and marks it on the job', async () => {
  const job = await runJob();
  const res = await accept(job, { paths: [SCENE_A] });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { written: Record<string, string>; jobDeleted: boolean };
  expect(body.written).toEqual({ [SCENE_A]: ADDRESS_A });
  expect(body.jobDeleted).toBe(false);

  expect(await exists(ADDRESS_A)).toBe(true);
  expect(await exists(ADDRESS_B)).toBe(false);

  // The rest stays reviewable, and the written part is on the job.
  const after = await fetchJob();
  expect(after?.review?.written).toEqual({ [SCENE_A]: ADDRESS_A });
  expect(after?.result?.scenes).toHaveLength(2);
});

test("the edited text is what a partial accept writes", async () => {
  let job = await runJob();
  job = await patch(job, {
    edits: { [SCENE_A]: sceneMarkdown("treffen-am-kai", "Treffen am Kai").replace("Fenn wartet am Kai.", "Fenn wartet im Regen.") },
  });
  expect((await accept(job, { paths: [SCENE_A] })).status).toBe(200);
  const res = await app.request(entriesUrl("beispiel", ADDRESS_A));
  expect(((await res.json()) as { body: string }).body).toContain("Fenn wartet im Regen.");
});

test("accepting the same part twice answers 200 with nothing written", async () => {
  // A double click, or the second tab clicking what the first already wrote:
  // the caller asked for a state that already holds. The empty answer says so; a 400 said the DM did something
  // wrong and put an error line under a review that was in order.
  const job = await runJob();
  expect((await accept(job, { paths: [SCENE_A] })).status).toBe(200);
  const again = (await fetchJob()) as GenerateJob;
  const res = await accept(again, { paths: [SCENE_A] });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ written: {}, jobDeleted: false });
  // Nothing moved: the rest is still reviewable and the job is still there.
  expect((await fetchJob())?.review?.written).toEqual({ [SCENE_A]: ADDRESS_A });
});

test("a bulk accept with nothing open left stays a 400", async () => {
  // Everything dropped or rejected: „Alle übernehmen" names nothing and
  // there is nothing — a client bug, and still an error.
  const job = await patch(await runJob(), {
    dropped: [SCENE_A, SCENE_B],
    entries: { [STUB_PATH]: "rejected" },
  });
  expect((await accept(job, {})).status).toBe(400);
});

test("an unknown path is a 400", async () => {
  const job = await runJob();
  expect((await accept(job, { paths: ["01-salzhafen/nope"] })).status).toBe(400);
});

test("the job deletes itself when every part is written, dropped or rejected", async () => {
  let job = await runJob();
  // The second scene is dropped and the suggested entry rejected — so the
  // ONE remaining part settles the whole run.
  job = await patch(job, { dropped: [SCENE_B], entries: { [STUB_PATH]: "rejected" } });

  const res = await accept(job, { paths: [SCENE_A] });
  expect(((await res.json()) as { jobDeleted: boolean }).jobDeleted).toBe(true);
  expect(await fetchJob()).toBeNull();
  // Only the accepted part exists.
  expect(await exists(ADDRESS_A)).toBe(true);
  expect(await exists(ADDRESS_B)).toBe(false);
  expect(await exists(STUB_PATH)).toBe(false);
});

test('„Alle übernehmen" writes the open rest — never a dropped or rejected part', async () => {
  let job = await runJob();
  job = await patch(job, { entries: { [STUB_PATH]: "rejected" } });
  expect((await accept(job, { paths: [SCENE_A] })).status).toBe(200);

  const rest = (await fetchJob()) as GenerateJob;
  const body = (await (await accept(rest, {})).json()) as {
    written: Record<string, string>;
    jobDeleted: boolean;
  };
  expect(Object.keys(body.written)).toEqual([SCENE_B]);
  expect(body.jobDeleted).toBe(true);
  expect(await exists(STUB_PATH)).toBe(false);
});

test("a bulk accept skips an UNDECIDED suggested entry, an explicit one writes it", async () => {
  const job = await runJob();
  // Nothing decided about the entry: „Alle übernehmen" writes the scenes and
  // leaves it alone — the earlier rule, and the reason the job stays.
  const bulk = (await (await accept(job, {})).json()) as {
    written: Record<string, string>;
    jobDeleted: boolean;
  };
  expect(Object.keys(bulk.written).sort()).toEqual([SCENE_B, SCENE_A].sort());
  expect(bulk.jobDeleted).toBe(false);
  expect(await exists(STUB_PATH)).toBe(false);

  // Naming it is the decision: „Diesen übernehmen" on its row writes it, and
  // then nothing is open any more.
  const rest = (await fetchJob()) as GenerateJob;
  const one = (await (await accept(rest, { paths: [STUB_PATH] })).json()) as {
    jobDeleted: boolean;
  };
  expect(one.jobDeleted).toBe(true);
  expect(await exists(STUB_PATH)).toBe(true);
});

test('„Verwerfen" removes only the open rest — what was written stays', async () => {
  const job = await runJob();
  expect((await accept(job, { paths: [SCENE_A] })).status).toBe(200);

  const res = await send("DELETE", "/api/campaigns/beispiel/generate/job");
  expect(res.status).toBe(200);
  expect(await fetchJob()).toBeNull();
  // The accepted scene is an entry now, not a job.
  expect(await exists(ADDRESS_A)).toBe(true);
  expect(await exists(ADDRESS_B)).toBe(false);
});

test("an accept with a stale rev is a 409 rev_conflict and writes nothing", async () => {
  const job = await runJob();
  // Another tab decides something — the rev moves and this one's is stale.
  await patch(job, { entries: { [STUB_PATH]: "rejected" } });

  const res = await send("POST", `/api/campaigns/beispiel/generate/job/${job.id}/accept`, {
    rev: job.rev ?? 0,
    paths: [SCENE_A],
  });
  expect(res.status).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe("rev_conflict");
  // Rolled back: no entry, and the job still has the part open.
  expect(await exists(ADDRESS_A)).toBe(false);
  expect((await fetchJob())?.review?.written).toEqual({});
});

test("an accept without a rev is a 400 — a defaulted guard is no guard", async () => {
  const job = await runJob();
  const res = await send("POST", `/api/campaigns/beispiel/generate/job/${job.id}/accept`, {
    paths: [SCENE_A],
  });
  expect(res.status).toBe(400);
  expect(await exists(ADDRESS_A)).toBe(false);
});

test("a job that disappears mid-accept rolls the whole write back", async () => {
  const job = await runJob();
  // „Verwerfen" in another tab: the row is gone before the accept starts.
  expect((await send("DELETE", "/api/campaigns/beispiel/generate/job")).status).toBe(200);
  const res = await accept(job, { paths: [SCENE_A] });
  expect(res.status).toBe(404);
  expect(await exists(ADDRESS_A)).toBe(false);
});

// The case above is caught by the pre-read; this one is the TRANSACTION's
// own guard — the row vanishing between plan and commit. It is reached
// directly because there is no way to interleave a delete into a synchronous
// SQLite transaction from a test. A quiet `false` here used to commit the
// drafts while dropping the bookkeeping.
test("markWrittenInTx throws for a lost job instead of reporting false", async () => {
  const job = await runJob();
  const db = await getDb();
  expect(() =>
    db.transaction((handle) =>
      markWrittenInTx(handle as never, "beispiel", "a-job-that-is-gone", job.rev ?? 0, {
        [SCENE_A]: ADDRESS_A,
      }),
    ),
  ).toThrow();
  expect((await fetchJob())?.review?.written).toEqual({});
});

// --- the new chapter ------------------------------------------------------------
//
// The app used to send `chapter`/`chapterTitle` on accept from its OWN state,
// and the review state is persistent — so the accept regularly happens in a
// tab that never saw the start form. The scenes were then written under a
// chapter that had no entry, and the overview (which lists chapters from the
// chapter table) showed neither the chapter nor its scenes.
//
// „Reload" is modelled exactly as it reaches the server: an accept with NO
// chapter fields in the body. Nothing else about these cases is special — same
// run, same accept endpoint.

const NEW_CHAPTER = "03-drachenbrut";

// The same scripted batch as above, but for a run on a chapter that does not
// exist yet — the reply validation compares each scene's chapter against the
// run's, so the drafts have to name this one.
const NEW_CHAPTER_REPLY = JSON.stringify({
  scenes: [
    { content: sceneMarkdown("treffen-am-kai", "Treffen am Kai").replace("01-salzhafen", NEW_CHAPTER) },
    { content: sceneMarkdown("nacht-am-kai", "Nacht am Kai").replace("01-salzhafen", NEW_CHAPTER) },
  ],
  entries: [{ kind: "npc", content: STUB_MARKDOWN.replace("01-salzhafen", NEW_CHAPTER) }],
  warnings: [],
});

/** Start a „Neues Kapitel" run and wait for it, like `runJob`. */
async function runNewChapterJob(title?: string): Promise<GenerateJob> {
  setProviderForTests(new PipelineFake([NEW_CHAPTER_REPLY]));
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
  expect(await exists(NEW_CHAPTER)).toBe(true);
});

test("the accepted scenes hang in that chapter and are visible in the tree", async () => {
  const job = await runNewChapterJob("Die Drachenbrut");
  expect((await accept(job, {})).status).toBe(200);

  const res = await app.request("/api/campaigns/beispiel/tree");
  const tree = (await res.json()) as {
    chapters: Array<{ id: string; groups: Array<{ scenes: Array<{ id: string }> }> }>;
  };
  const chapter = tree.chapters.find((c) => c.id === NEW_CHAPTER);
  expect((chapter?.groups.flatMap((g) => g.scenes) ?? []).length).toBeGreaterThan(0);
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
  expect((await accept(job, { paths: [`${NEW_CHAPTER}/treffen-am-kai`] })).status).toBe(200);
  const again = await fetchJob();
  expect(again).not.toBeNull();
  job = again as GenerateJob;
  // The second accept must not trip over the chapter it created itself.
  expect((await accept(job, {})).status).toBe(200);
  expect(await chapterTitles()).toMatchObject({ [NEW_CHAPTER]: "Die Drachenbrut" });
});

// A partial accept of the suggested entry ALONE — no scene in the batch, so
// nothing in it names the chapter. The chapter is still created, and that is
// intended: the target is decided from the job, not from what the accept
// happens to contain, so the chapter the run is for exists from the first
// accept onwards and the scenes accepted afterwards find it.
test("accepting only the suggested entry already creates the run's chapter", async () => {
  const job = await runNewChapterJob("Die Drachenbrut");
  expect((await accept(job, { paths: [STUB_PATH] })).status).toBe(200);

  expect(await exists(STUB_PATH)).toBe(true);
  expect(await chapterTitles()).toMatchObject({ [NEW_CHAPTER]: "Die Drachenbrut" });
  expect(await exists(NEW_CHAPTER)).toBe(true);
  // …and no scene was written by this accept.
  expect(await exists(`${NEW_CHAPTER}/leuchtturm/treffen-am-kai`)).toBe(false);

  // The scenes still accept afterwards, into the chapter that now exists.
  const rest = (await fetchJob()) as GenerateJob;
  expect(rest).not.toBeNull();
  expect((await accept(rest, {})).status).toBe(200);
  expect(await chapterTitles()).toMatchObject({ [NEW_CHAPTER]: "Die Drachenbrut" });
});
