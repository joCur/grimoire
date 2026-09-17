// Critical path 6, the half that only a real restart can show:
// generator jobs are ROWS, so they outlive the process that started them.
//
// Like the first-migration spec this cannot use the per-test `server` fixture:
// it needs TWO servers, one after the other, on the SAME data directory — the
// second boot is the restart. Both talk to the run's real stub LLM through the
// real provider; the only thing arranged is WHEN the stub answers
// (TRIGGER.slow holds the reply, so a job can be caught while it truly runs).
//
// Two claims, and they are the two halves of what "persistent" has to mean:
//
//   1. a run that was IN FLIGHT cannot come back — its provider call died with
//      the process — so the boot fails it with a German sentence the app
//      shows, instead of leaving a `running` row the app polls forever;
//   2. a FINISHED run comes back whole — result, warnings and the review edits
//      — and is still applyable afterwards. That is the loss this guards
//      against: a deploy between „fertig" and „Übernehmen" used to throw a good
//      generation away.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { LOCATION_STUB_ID, SCENE_ID, SCENE_TITLE, TRIGGER } from "../fixtures/replies";
import { pristineDir, runDir } from "../support/paths";
import { apiFor, expect, seedCampaigns, startGrimoireServer, test, type Api } from "../support/test";

/**
 * How the review addresses the draft (`<chapter>/<id>`) and where it LIVES
 * once accepted — the group segment is its `location`.
 */
const DRAFT_PATH = `01-salzhafen/${SCENE_ID}`;
const SCENE_PATH = `01-salzhafen/${LOCATION_STUB_ID}/${SCENE_ID}`;

const SOURCE = `The party watches the quay at low tide. Two lanterns move along the
mole while Fenn's crew shifts a cargo before dawn.`;

/** GET …/generate/job — null on the 404 "there is none". */
async function job(api: Api): Promise<Record<string, unknown> | null> {
  const res = await api.fetch("beispiel/generate/job");
  if (res.status === 404) return null;
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/** Poll until the job leaves `running` (the stub answers in well under 30s). */
async function waitForFinish(api: Api): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = await job(api);
    if (current === null) throw new Error("the job disappeared while waiting");
    if (current.status !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the job never finished");
}

/** A run directory of this test's own, plus its cleanup. */
async function ownDataDir(testId: string, workerIndex: number): Promise<string> {
  const dir = path.join(runDir(), `w${workerIndex}`, testId, "data");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  // The boot imports nothing — the fixture campaign is put in
  // by the seed CLI, once, before either boot of this spec.
  await seedCampaigns(pristineDir(), dir);
  return dir;
}

test("a run interrupted by a restart is reported as failed, not left spinning", async ({}, testInfo) => {
  const dataDir = await ownDataDir(testInfo.testId, testInfo.workerIndex);

  // --- boot 1: start a run the stub will never answer -----------------------
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  let jobId: string;
  try {
    const api = apiFor(first.handle.url);
    const started = await api.send<{ jobId: string }>("POST", "beispiel/generate", {
      chapter: "01-salzhafen",
      sourceText: `${SOURCE}\n\n${TRIGGER.slow}`,
    });
    jobId = started.jobId;
    const running = await job(api);
    expect(running).toMatchObject({ id: jobId, status: "running", kind: "scene" });
  } finally {
    // The restart. Everything about that provider call goes with it.
    await first.proc.stop();
  }

  // --- boot 2: the same database --------------------------------------------
  const second = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    const failed = await job(api);
    // The job is still THERE — a restart used to answer 404 here — and it
    // says what happened.
    expect(failed).toMatchObject({ id: jobId, status: "failed" });
    expect(failed!.finishedAt).toEqual(expect.any(String));
    const error = failed!.error as {
      status: number;
      body: { code?: string; error: string };
    };
    expect(error.status).toBe(503);
    // Language-free: the stable code is the contract, the
    // English text next to it the technical fallback. The SENTENCE the DM
    // reads is the app's (`server.job_restarted` in app/src/i18n) — the
    // language spec asserts that side.
    expect(error.body.code).toBe("job_restarted");
    expect(error.body.error).toBe(
      "the server was restarted while the job was running — start the job again",
    );
    // Nothing was written, and a new run may start right away (no stuck gate).
    expect(await api.exists(SCENE_PATH)).toBe(false);
    expect((await api.fetch("beispiel/generate/job", { method: "DELETE" })).status).toBe(200);
  } finally {
    await second.proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});

test("a finished job survives a restart whole and is still applyable", async ({}, testInfo) => {
  const dataDir = await ownDataDir(testInfo.testId, testInfo.workerIndex);
  const edited = `<!-- nach dem Neustart noch da -->\n`;

  // --- boot 1: run to completion, then edit a draft in the review ----------
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  let before: Record<string, unknown>;
  try {
    const api = apiFor(first.handle.url);
    await api.send("POST", "beispiel/generate", {
      chapter: "01-salzhafen",
      sourceText: SOURCE,
    });
    before = await waitForFinish(api);
    expect(before.status).toBe("done");

    const result = before.result as { scenes: { path: string; markdown: string }[] };
    expect(result.scenes.map((s) => s.path)).toEqual([DRAFT_PATH]);
    // The review PATCH is the one way an edit reaches the job
    // (`PUT …/job/drafts` is gone).
    await api.send("PATCH", `beispiel/generate/job/${before.id as string}/review`, {
      rev: (before.rev as number | undefined) ?? 0,
      edits: { [DRAFT_PATH]: `${result.scenes[0]!.markdown}${edited}` },
    });
    // Still nothing written — the review has not been applied.
    expect(await api.exists(SCENE_PATH)).toBe(false);
  } finally {
    await first.proc.stop();
  }

  // --- boot 2: the review is back, unchanged, and can be applied ------------
  const second = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    const after = (await job(api))!;
    expect(after.id).toBe(before.id);
    expect(after.status).toBe("done");
    expect(after.kind).toBe("scene");
    expect(after.chapter).toBe("01-salzhafen");
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.finishedAt).toBe(before.finishedAt);
    expect(after.result).toEqual(before.result);
    // The DM's own edit came back with it.
    expect((after.draftEdits as Record<string, string>)[DRAFT_PATH]).toContain(edited.trim());

    // The scene AND the entries it references: a proposal is applied as one
    // batch, because a scene cannot name an entry that does not exist
    // (ADR #19).
    const result = after.result as { scenes: unknown[]; stubs: unknown[] };
    const written = await api.send<{ written: string[] }>("POST", "beispiel/generate/apply", {
      scenes: result.scenes,
      stubs: result.stubs,
      jobId: after.id,
    });
    expect(written.written).toContain(SCENE_PATH);
    const stored = await api.properties(SCENE_PATH);
    expect(stored.title).toBe(SCENE_TITLE);
    expect(stored.status).toBe("draft");
    // Applied means done: the job is discarded, as after any successful apply.
    expect(await job(api)).toBeNull();
  } finally {
    await second.proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});
