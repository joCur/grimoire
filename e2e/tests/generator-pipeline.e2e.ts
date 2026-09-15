// Critical path 6, the half issue #102 adds: a scene run is a PIPELINE, so it
// does not stand or fall as one answer.
//
// The claims, in the order a DM meets them:
//
//   1. a run with three scenes where one fails leaves the other two
//      reviewable and acceptable, with the failed part carrying its error and
//      a „Erneut versuchen“ of its own,
//   2. that retry re-runs only that part, and afterwards all three are there,
//   3. accepting one part and then the rest empties the run and the job is
//      gone,
//   4. a restart mid-run keeps the finished parts and fails the one that was
//      in flight (the other half of generator-restart.e2e.ts, one level
//      deeper),
//   5. „Verwerfen" during a run stops the open parts.
//
// Nothing is mocked but the model: the browser drives the real app, the real
// server calls the real stub endpoint over the real provider, and the stub
// only decides WHICH canned document comes back for which part
// (e2e/fixtures/stub-llm.ts).

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { FAILING_SCENE_ID, THREE_SCENES, TRIGGER } from "../fixtures/replies";
import { pristineDir, runDir } from "../support/paths";
import { apiFor, expect, seedCampaigns, startGrimoireServer, test, type Api } from "../support/test";

const CHAPTER = "01-salzhafen";

const SOURCE = `The party watches the quay at low tide. Two lanterns move along the
mole while Fenn's crew shifts a cargo before dawn. At dawn the characters slip
away through the mudflats.`;

/** The review's address of one part — `<chapter>/<id>` (issue #100). */
const draftPath = (id: string) => `${CHAPTER}/${id}`;

/**
 * A source text that makes the run three scenes and breaks the middle one's
 * FIRST call. The nonce keys the stub's counter, so parallel workers never
 * consume each other's failure (the stub is one endpoint for the whole run).
 */
function threeSceneSource(nonce: string, extra = ""): string {
  return [SOURCE, TRIGGER.threeScenes, `${TRIGGER.partFail}:${nonce}`, extra]
    .filter((part) => part !== "")
    .join("\n\n");
}

test("three scenes, one fails: the other two are reviewable, the retry fixes it", async ({
  page,
  api,
}, testInfo) => {
  await page.goto(`/beispiel/generate`);
  await page.getByLabel("Quelltext (EN)").fill(threeSceneSource(`w${testInfo.workerIndex}a`));
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  // --- (1) the review fills up: two drafts, one failed part ----------------
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  for (const scene of THREE_SCENES) {
    if (scene.id === FAILING_SCENE_ID) continue;
    await expect(page.getByRole("heading", { level: 2, name: scene.title })).toBeVisible();
  }
  // The failed part says what happened and offers ONE button — the outline is
  // nowhere to be seen, because the DM never gets to edit it (PO, 15.09.).
  const failedTitle = THREE_SCENES.find((s) => s.id === FAILING_SCENE_ID)!.title;
  const failedCard = page.locator("section").filter({ hasText: failedTitle }).last();
  await expect(failedCard).toContainText("nicht geschrieben");
  await expect(failedCard.getByText('"status" must be "draft"', { exact: false })).toBeVisible();
  // The cost of the whole run is one quiet line, counting CALLS (AK5).
  await expect(page.getByText(/~[\d.]+ Tokens · \d+ Aufrufe/)).toBeVisible();

  // --- (2) a finished part is acceptable while one is still open (AK2) ----
  const firstId = THREE_SCENES[0].id;
  expect(await api.exists(draftPath(firstId))).toBe(false);
  await page
    .locator("div")
    .filter({ hasText: draftPath(firstId) })
    .last()
    .getByRole("button", { name: "Diesen übernehmen" })
    .click();
  await expect(page.getByRole("link", { name: draftPath(firstId) })).toBeVisible();
  expect(await api.exists(draftPath(firstId))).toBe(true);
  // The job is still there — the failed part is not settled.
  expect((await api.fetch("beispiel/generate/job")).status).toBe(200);

  // --- (3) „Erneut versuchen“ restarts THAT part only ---------------------
  await failedCard.getByRole("button", { name: "Erneut versuchen" }).click();
  await expect(page.getByRole("heading", { level: 2, name: failedTitle })).toBeVisible({
    timeout: 30_000,
  });
  // All three are there now; the one already accepted stayed accepted.
  for (const scene of THREE_SCENES) {
    await expect(page.getByRole("heading", { level: 2, name: scene.title })).toBeVisible();
  }
  await expect(page.getByText("nicht geschrieben")).toHaveCount(0);

  // --- (4) „Rest übernehmen“ writes what is left and the job is gone -----
  await page.getByRole("button", { name: /^Rest übernehmen/ }).click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  for (const scene of THREE_SCENES) {
    const stored = await api.raw(draftPath(scene.id));
    expect(stored).toContain(`title: ${scene.title}`);
    expect(stored).toContain("status: draft");
  }
  expect((await api.fetch("beispiel/generate/job")).status).toBe(404);
});

test("„Verwerfen\" during a run stops the open parts", async ({ page, api }, testInfo) => {
  await page.goto("/beispiel/generate");
  // The last scene's reply is HELD, so the run is genuinely still going while
  // the DM is already looking at the two that answered.
  await page
    .getByLabel("Quelltext (EN)")
    .fill(threeSceneSource(`w${testInfo.workerIndex}b`, TRIGGER.slowPart));
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  // The run says how far it got — and that what is here can already be taken.
  await expect(page.getByText(/von 3 Szenen fertig/)).toBeVisible();
  await expect(page.getByText("Der Lauf ist noch nicht fertig", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: /^(Verwerfen|Rest verwerfen)$/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Szenen generieren");
  expect((await api.fetch("beispiel/generate/job")).status).toBe(404);
  // Nothing of the abandoned run lands afterwards.
  for (const scene of THREE_SCENES) {
    expect(await api.exists(draftPath(scene.id))).toBe(false);
  }
});

// --- the restart, one level deeper than generator-restart.e2e.ts -------------

/** GET …/generate/job — null on the 404 "there is none". */
async function job(api: Api): Promise<Record<string, unknown> | null> {
  const res = await api.fetch("beispiel/generate/job");
  if (res.status === 404) return null;
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

interface JobPart {
  key: string;
  status: string;
  error?: string;
}

function parts(payload: Record<string, unknown> | null): JobPart[] {
  const pipeline = payload?.pipeline as { parts?: JobPart[] } | undefined;
  return pipeline?.parts ?? [];
}

/** A run directory of this test's own, plus its cleanup. */
async function ownDataDir(testId: string, workerIndex: number): Promise<string> {
  const dir = path.join(runDir(), `w${workerIndex}`, testId, "data");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await seedCampaigns(pristineDir(), dir);
  return dir;
}

test("a restart mid-run keeps the finished parts and fails the one in flight", async ({}, testInfo) => {
  const dataDir = await ownDataDir(testInfo.testId, testInfo.workerIndex);
  const nonce = `w${testInfo.workerIndex}c`;

  // --- boot 1: two parts answer, the third one never does -----------------
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  let jobId: string;
  try {
    const api = apiFor(first.handle.url);
    const started = await api.send<{ jobId: string }>("POST", "beispiel/generate", {
      chapter: CHAPTER,
      // No failure trigger here: every part is well-formed, and only the LAST
      // one's reply is held — the shape a restart has to survive.
      sourceText: [SOURCE, TRIGGER.threeScenes, TRIGGER.slowPart].join("\n\n"),
    });
    jobId = started.jobId;
    // Wait until the two answering parts have landed.
    const deadline = Date.now() + 30_000;
    for (;;) {
      const current = await job(api);
      const done = parts(current).filter((part) => part.status === "done");
      if (done.length === 2) break;
      if (Date.now() > deadline) throw new Error("the first two parts never finished");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    // The restart. The held provider call goes with it.
    await first.proc.stop();
  }

  // --- boot 2: the same database ------------------------------------------
  const second = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  try {
    const api = apiFor(second.handle.url);
    const after = (await job(api))!;
    expect(after.id).toBe(jobId);
    // Two parts survived, so the run is finished rather than failed — and the
    // one that was in flight says why it is not there.
    expect(after.status).toBe("done");
    expect(parts(after).map((part) => part.status)).toEqual(["done", "done", "failed"]);
    expect(parts(after)[2]!.error).toBe(
      "the server was restarted while the job was running — start the job again",
    );
    const result = after.result as { scenes: Array<{ path: string }> };
    expect(result.scenes.map((s) => s.path)).toEqual([
      draftPath(THREE_SCENES[0].id),
      draftPath(THREE_SCENES[1].id),
    ]);

    // And the part is retryable on the NEW process — the outline came back
    // with the row, which is the whole reason it is stored. (What the retry
    // then answers is the stub's business: this run's source text still holds
    // the last part's reply, which is exactly why the restart could interrupt
    // it in the first place.)
    const retried = await api.send<Record<string, unknown>>(
      "POST",
      `beispiel/generate/job/${jobId}/parts/${parts(after)[2]!.key}/retry`,
      {},
    );
    expect(retried.status).toBe("running");
    expect(parts(retried).map((part) => part.status)).toEqual(["done", "done", "running"]);
    // Nothing was written by any of it — only „Übernehmen“ writes.
    expect(await api.exists(draftPath(THREE_SCENES[0].id))).toBe(false);
    void nonce;
  } finally {
    await second.proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});
