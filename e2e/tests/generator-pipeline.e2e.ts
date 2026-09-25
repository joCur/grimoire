// Critical path 6, one level deeper: a scene run is a PIPELINE, so it does
// not stand or fall as one answer.
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
//   5. „Verwerfen" during a run stops the open parts,
//   6. the scenes of a run accepted one by one in REVERSE stand in the
//      chapter overview in outline order, behind the chapter's own scenes.
//
// Nothing is mocked but the model: the browser drives the real app, the real
// server calls the real stub endpoint over the real provider, and the stub
// only decides WHICH canned reply comes back for which part
// (e2e/fixtures/stub-llm.ts).

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

import { FAILING_SCENE_ID, THREE_SCENES, TRIGGER } from "../fixtures/replies";
import { pristineDir, runDir } from "../support/paths";
import { apiFor, expect, seedCampaigns, startGrimoireServer, test, type Api } from "../support/test";

const CHAPTER = "01-salzhafen";

const SOURCE = `The party watches the quay at low tide. Two lanterns move along the
mole while Fenn's crew shifts a cargo before dawn. At dawn the characters slip
away through the mudflats.`;

/** How the review names one proposed scene — its resource segment and id. */
const sceneLabel = (id: string) => `scenes/${id}`;

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
  await page.goto(`/campaigns/beispiel/generate`);
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
  // nowhere to be seen, because the DM never gets to edit it.
  const failedTitle = THREE_SCENES.find((s) => s.id === FAILING_SCENE_ID)!.title;
  const failedCard = page.locator("section").filter({ hasText: failedTitle }).last();
  await expect(failedCard).toContainText("nicht geschrieben");
  await expect(
    failedCard.getByText('"status": Ungültige Eingabe: erwartet "draft"', { exact: false }),
  ).toBeVisible();
  // The cost of the whole run is one quiet line, counting CALLS.
  await expect(page.getByText(/~[\d.]+ Tokens · \d+ Aufrufe?/)).toBeVisible();

  // --- (2) a finished part is acceptable while one is still open ----------
  const firstId = THREE_SCENES[0].id;
  expect(await api.sceneExists(firstId)).toBe(false);
  await page
    .locator("div")
    .filter({ hasText: sceneLabel(firstId) })
    .last()
    .getByRole("button", { name: "Diesen übernehmen" })
    .click();
  // Written, the card links to the scene it became, on the scene's own route.
  await expect(page.getByRole("link", { name: sceneLabel(firstId) })).toHaveAttribute(
    "href",
    `/campaigns/beispiel/scenes/${firstId}`,
  );
  expect(await api.sceneExists(firstId)).toBe(true);
  // The job is still there — the failed part is not settled.
  expect((await api.fetch("campaigns/beispiel/generate/job")).status).toBe(200);

  // --- (3) „Erneut versuchen“ restarts THAT part only ---------------------
  await failedCard.getByRole("button", { name: "Erneut versuchen" }).click();
  // The focus went with the click: the button unmounts the moment the part
  // runs again, and the status card itself is replaced by the draft card the
  // moment the part is done — so the focus FOLLOWS the part across both swaps
  // instead of falling to `body`.
  const retriedCard = page
    .locator("[tabindex='-1']")
    .filter({ hasText: failedTitle })
    .last();
  await expect(retriedCard).toBeFocused();
  await expect(page.getByRole("heading", { level: 2, name: failedTitle })).toBeVisible({
    timeout: 30_000,
  });
  // …and it is still on the card once the retried part is its draft.
  await expect(retriedCard).toBeFocused();
  // All three are there now; the one already accepted stayed accepted.
  for (const scene of THREE_SCENES) {
    await expect(page.getByRole("heading", { level: 2, name: scene.title })).toBeVisible();
  }
  await expect(page.getByText("nicht geschrieben")).toHaveCount(0);

  // --- (4) „Rest übernehmen“ writes what is left and the job is gone -----
  await page.getByRole("button", { name: /^Rest übernehmen/ }).click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  for (const scene of THREE_SCENES) {
    const stored = await api.scene(scene.id);
    expect(stored.title).toBe(scene.title);
    expect(stored.status).toBe("draft");
  }
  expect((await api.fetch("campaigns/beispiel/generate/job")).status).toBe(404);
});

/**
 * The rows of the chapter overview in DOM order, by the title they show —
 * read off the move controls, which carry the row's title in their name.
 */
async function shownOrder(page: Page): Promise<string[]> {
  const labels = await page
    .getByRole("button", { name: /nach unten$/ })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  return labels.map((label) => label.replace(/^„|“ nach unten$/g, ""));
}

test("scenes accepted one by one in reverse stand in outline order", async ({ page, api }) => {
  type Tree = { chapters: Array<{ id: string; scenes: Array<{ id: string; title: string }> }> };
  const chapterScenes = async () =>
    (await api.get<Tree>("campaigns/beispiel/tree")).chapters.find((c) => c.id === CHAPTER)!
      .scenes;
  const before = await chapterScenes();

  await page.goto("/campaigns/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill([SOURCE, TRIGGER.threeScenes].join("\n\n"));
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  for (const scene of THREE_SCENES) {
    await expect(page.getByRole("heading", { level: 2, name: scene.title })).toBeVisible();
  }

  // Last first: every accept is its own call, and each one would have
  // appended its scene behind the one before. The last accept empties the
  // run, so it answers with the written summary instead of a link.
  const reversed = [...THREE_SCENES].reverse();
  for (const [index, scene] of reversed.entries()) {
    await page
      .locator("div")
      .filter({ hasText: sceneLabel(scene.id) })
      .last()
      .getByRole("button", { name: "Diesen übernehmen" })
      .click();
    if (index < reversed.length - 1) {
      await expect(page.getByRole("link", { name: sceneLabel(scene.id) })).toBeVisible();
    } else {
      await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
    }
  }
  expect((await api.fetch("campaigns/beispiel/generate/job")).status).toBe(404);

  // Stored: the chapter's own scenes, then the run in outline order.
  const runIds = THREE_SCENES.map((scene) => scene.id);
  expect((await chapterScenes()).map((scene) => scene.id)).toEqual([
    ...before.map((scene) => scene.id),
    ...runIds,
  ]);

  // Shown: the planned rows of the overview put the run behind the planned
  // scene the chapter already had, in outline order (the contingency keeps
  // its own block at the end).
  await page.goto("/campaigns/beispiel");
  const runTitles: string[] = THREE_SCENES.map((scene) => scene.title);
  await expect
    .poll(async () => (await shownOrder(page)).filter((title) => runTitles.includes(title)))
    .toEqual(runTitles);
  const shown = await shownOrder(page);
  const firstOwn = before[0]!.title;
  expect(shown.indexOf(firstOwn)).toBeLessThan(shown.indexOf(runTitles[0]!));
});

test("a finished part is acceptable while the run is still running", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel/generate");
  // The LAST scene's reply is held, so the run is genuinely `running` while
  // the DM accepts one of the two that answered — which is the claim: „was
  // hier steht, kannst du schon übernehmen", not „warte, bis alles da ist".
  await page
    .getByLabel("Quelltext (EN)")
    .fill([SOURCE, TRIGGER.threeScenes, TRIGGER.slowPart].join("\n\n"));
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  await expect(page.getByText("Der Lauf ist noch nicht fertig", { exact: false })).toBeVisible();

  const firstId = THREE_SCENES[0].id;
  const before = (await api.fetch("campaigns/beispiel/generate/job").then((r) => r.json())) as {
    status: string;
  };
  expect(before.status).toBe("running");

  expect(await api.sceneExists(firstId)).toBe(false);
  await page
    .locator("div")
    .filter({ hasText: sceneLabel(firstId) })
    .last()
    .getByRole("button", { name: "Diesen übernehmen" })
    .click();
  await expect(page.getByRole("link", { name: sceneLabel(firstId) })).toBeVisible();
  expect(await api.sceneExists(firstId)).toBe(true);

  // …and the run is STILL running: accepting a part does not end it, and the
  // open rest keeps the job alive.
  const after = (await api.fetch("campaigns/beispiel/generate/job").then((r) => r.json())) as {
    status: string;
    pipeline?: { parts: Array<{ status: string }> };
  };
  expect(after.status).toBe("running");
  expect(after.pipeline!.parts.at(-1)!.status).toBe("running");

  // Cleanup: the held call must not outlive the test's server.
  await page.getByRole("button", { name: /^(Verwerfen|Rest verwerfen)$/ }).click();
});

test("the review replaces the spinner on a POLL, without a reload", async ({
  page,
  api,
}, testInfo) => {
  // The regression this claim exists for: every part answers so fast that the
  // review can be the FIRST thing the page ever renders, so nothing would
  // watch the spinner turn into it. With late parts the browser really sees
  // „Entwürfe werden generiert …" first and the switch has to happen on a
  // polled job — never on a reload.
  await page.goto("/campaigns/beispiel/generate");
  await page
    .getByLabel("Quelltext (EN)")
    .fill([SOURCE, TRIGGER.threeScenes, TRIGGER.latePart, TRIGGER.slowPart].join("\n\n"));
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  // The spinner first — with nothing to review, that is the honest state.
  await expect(page.getByText("Entwürfe werden generiert", { exact: false })).toBeVisible();
  // …and the run is genuinely `running` while it stands there.
  const during = (await api.fetch("campaigns/beispiel/generate/job").then((r) => r.json())) as {
    status: string;
  };
  expect(during.status).toBe("running");

  // No reload, no goto: the poll alone has to carry the view into the review.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  const firstTitle = THREE_SCENES[0].title;
  await expect(page.getByRole("heading", { level: 2, name: firstTitle })).toBeVisible();
  await expect(page.getByText("Entwürfe werden generiert", { exact: false })).toBeHidden();
  // And the run is STILL going while the review stands there: the switch was
  // made by a poll of a `running` job, not by its end.
  const shown = (await api.fetch("campaigns/beispiel/generate/job").then((r) => r.json())) as {
    status: string;
  };
  expect(shown.status).toBe("running");

  // Cleanup — nothing of this run needs to be written.
  await page.getByRole("button", { name: /^(Verwerfen|Rest verwerfen)$/ }).click();
});

test("a FAILED part alone is already the review (no empty page)", async ({
  page,
  api,
}, testInfo) => {
  // The other half of the same regression: the parts are the review's spine,
  // the drafts only fill it in. While the two good parts are still late, the
  // failed one is the only thing there is — and it is something the DM can act
  // on. Gating the review on a RESULT would render this state as an empty page
  // that only appears on a reload.
  await page.goto("/campaigns/beispiel/generate");
  await page
    .getByLabel("Quelltext (EN)")
    .fill(threeSceneSource(`w${testInfo.workerIndex}d`, TRIGGER.latePart));
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  const failedTitle = THREE_SCENES.find((s) => s.id === FAILING_SCENE_ID)!.title;
  // No reload: the failed part carries the view into the review on its own,
  // with its error and its own „Erneut versuchen".
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  const failedCard = page.locator("section").filter({ hasText: failedTitle }).last();
  await expect(failedCard).toContainText("nicht geschrieben");
  await expect(failedCard.getByRole("button", { name: "Erneut versuchen" })).toBeVisible();
  // The pin of the claim: at this moment NO part has produced a draft yet —
  // the review is on the screen because a part FAILED, not because one
  // succeeded. (Waiting for the late parts first would pass either way.)
  const early = (await api.fetch("campaigns/beispiel/generate/job").then((r) => r.json())) as {
    status: string;
    result?: { scenes: unknown[] };
    pipeline: { parts: Array<{ status: string }> };
  };
  expect(early.status).toBe("running");
  expect(early.pipeline.parts.map((part) => part.status)).not.toContain("done");
  expect(early.result?.scenes ?? []).toEqual([]);
  // …and the two late parts arrive afterwards, into the same review: their
  // PROPOSED SCENES, named by their label — the part's own title is on its
  // status card while it is still open, so only the label says the scene is
  // there.
  for (const scene of THREE_SCENES) {
    if (scene.id === FAILING_SCENE_ID) continue;
    await expect(page.getByText(sceneLabel(scene.id), { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
  }

  await page.getByRole("button", { name: /^(Verwerfen|Rest verwerfen)$/ }).click();
});

test("„Verwerfen\" during a run stops the open parts", async ({ page, api }, testInfo) => {
  await page.goto("/campaigns/beispiel/generate");
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
  expect((await api.fetch("campaigns/beispiel/generate/job")).status).toBe(404);
  // Nothing of the abandoned run lands afterwards.
  for (const scene of THREE_SCENES) {
    expect(await api.sceneExists(scene.id)).toBe(false);
  }
});

// --- the restart, one level deeper than generator-restart.e2e.ts -------------

/** GET …/generate/job — null on the 404 "there is none". */
async function job(api: Api): Promise<Record<string, unknown> | null> {
  const res = await api.fetch("campaigns/beispiel/generate/job");
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

  // --- boot 1: two parts answer, the third one never does -----------------
  const first = await startGrimoireServer(pristineDir(), dataDir, testInfo.workerIndex);
  let jobId: string;
  try {
    const api = apiFor(first.handle.url);
    const started = await api.send<{ jobId: string }>("POST", "campaigns/beispiel/generate", {
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
    const result = after.result as { scenes: Array<{ id: string }> };
    expect(result.scenes.map((s) => s.id)).toEqual([
      THREE_SCENES[0].id,
      THREE_SCENES[1].id,
    ]);

    // And the part is retryable on the NEW process — the outline came back
    // with the row, which is the whole reason it is stored. (What the retry
    // then answers is the stub's business: this run's source text still holds
    // the last part's reply, which is exactly why the restart could interrupt
    // it in the first place.)
    const retried = await api.send<Record<string, unknown>>(
      "POST",
      `campaigns/beispiel/generate/job/${jobId}/parts/${parts(after)[2]!.key}/retry`,
      {},
    );
    expect(retried.status).toBe("running");
    expect(parts(retried).map((part) => part.status)).toEqual(["done", "done", "running"]);
    // Nothing was written by any of it — only „Übernehmen“ writes.
    expect(await api.sceneExists(THREE_SCENES[0].id)).toBe(false);
  } finally {
    await second.proc.stop();
  }

  if (process.env.E2E_KEEP !== "1") await rm(dataDir, { recursive: true, force: true });
});
