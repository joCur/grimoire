// Critical path 6, the second half: augmenting an entry with the model.
//
// The create runs of that path live in `generator.e2e.ts`; this spec is the
// same pipeline pointed at an entry that ALREADY EXISTS, and it asserts
// four things:
//
//   a) an EMPTY npc — an entry created and not filled in — is augmented and
//      its holes are filled,
//   b) a PREPARED scene gains a new plot thread as ADDITIONAL blocks while
//      every existing block comes back byte for byte,
//   b2) a FILLED npc — the one entry whose stored shape differs from the
//      reply shape (`quickstats` as a mapping vs. a `{ key, value }` list) —
//      is augmented and keeps its stats as the mapping they are,
//   c) rejecting the proposal writes nothing and takes the job with it,
//   d) an entry that moves while the review is open answers 409 and nothing
//      is written (ADR #4) — the review recovers on the re-read.
//
// Two of them carry the default rule with them, because it is the rule the
// whole feature turns on: by default only empty and new units are accepted,
// and a filled one is never silently replaced. The npc reply therefore
// proposes a mix — three fields the entry has nothing in (the motivation
// among them, a property like any other), two it already has — and the spec
// checks the PRESELECTION, not just the outcome.
//
// Nothing is mocked but the model (fixtures/stub-llm.ts): a real job on a
// real server, the real OpenAICompatProvider, the real write path with its
// `rev` guard.
//
// Path 8 rides along at the bottom: the action is desktop-only (a block diff
// is not a phone surface, UI-BRIEF), and the reading view of both kinds has
// to keep rendering at 390px.

import type { Page } from "@playwright/test";

import {
  AUGMENT_NPC_NAME,
  AUGMENT_NPC_MOTIVATION,
  AUGMENT_NPC_ROLE,
  AUGMENT_NPC_SECRET,
  AUGMENT_NPC_STATUS,
  AUGMENT_NPC_VOICE,
  AUGMENT_THREAD_CONDITION,
  AUGMENT_THREAD_TEXT,
  TRIGGER,
} from "../fixtures/replies";
import { expect, test, type Api } from "../support/test";

/** The prepared scene of the example campaign — the augment target of (b). */
const SCENE = "01-salzhafen/bucht/smuggler-captured";
const SCENE_URL = `/campaigns/beispiel/entries/${SCENE}`;

/** The example campaign's filled npc — the one that carries `quickstats`. */
const FILLED_NPC = "npcs/jorna";

/** The empty npc — created, never filled in. */
const EMPTY_NPC = "spitzel";
const NPC_PATH = `npcs/${EMPTY_NPC}`;
const NPC_URL = `/campaigns/beispiel/entries/${NPC_PATH}`;

const INSTRUCTION = "Führe einen Handlungsstrang um den Schmuggler-Spitzel ein";

/**
 * Create an npc with nothing but the id — how a DM ends up with an entry
 * that exists and says nothing. The scene then references it, which is only
 * possible BECAUSE it exists (ADR #19).
 */
async function createEmptyNpc(api: Api): Promise<void> {
  await api.send("POST", "campaigns/beispiel/npcs", { name: EMPTY_NPC });
  await api.patchProperties(SCENE, { npcs: ["fenn", EMPTY_NPC] });
  const npc = await api.entry(NPC_PATH);
  expect(npc.properties.name).toBe(EMPTY_NPC);
  expect(npc.body).toBe("");
}

/** Open the dialog on the entry the page shows and start a run. */
async function startAugment(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Mit KI ergänzen" }).click();
  await page.getByLabel("Anweisung (optional)").fill(INSTRUCTION);
  await page.getByRole("button", { name: "Ergänzen", exact: true }).click();
}

test("empty npc from a reference: augment fills the holes, keeps what is filled", async ({
  page,
  api,
}) => {
  await createEmptyNpc(api);

  await page.goto(NPC_URL);
  await page.getByRole("button", { name: "Mit KI ergänzen" }).click();
  await expect(page.getByRole("heading", { name: "Mit KI ergänzen" })).toBeVisible();
  // The dialog names the entry it is about by its DISPLAY NAME — the wire
  // address is how it is stored, not how the DM knows it.
  const lead = page.getByText("die KI ergänzt", { exact: false });
  await expect(lead).toBeVisible();
  await expect(lead).toContainText(EMPTY_NPC);
  await expect(lead).not.toContainText("npcs/");

  // Nothing may start without input (source text and/or instruction).
  const startButton = page.getByRole("button", { name: "Ergänzen", exact: true });
  await expect(startButton).toBeDisabled();
  await page.getByLabel("Anweisung (optional)").fill(INSTRUCTION);
  await expect(startButton).toBeEnabled();
  await startButton.click();

  // The server job finishes and the review takes the dialog over.
  await expect(page.getByText("Vorhanden").first()).toBeVisible({ timeout: 30_000 });

  // The defaults: `role`, `voice` and `motivation` are holes -> new,
  // preselected for acceptance; `name` and `status` already carry a value ->
  // changed, KEPT.
  await expectDecision(page, "role", "Neu", "Übernehmen");
  await expectDecision(page, "voice", "Neu", "Übernehmen");
  await expectDecision(page, "motivation", "Neu", "Übernehmen");
  await expectDecision(page, "name", "Geändert", "Behalten");
  await expectDecision(page, "status", "Geändert", "Behalten");
  // The two-column diff really shows both sides.
  await expect(fieldRow(page, "role").getByText("leer")).toBeVisible();
  await expect(fieldRow(page, "role")).toContainText(AUGMENT_NPC_ROLE);
  await expect(fieldRow(page, "name")).toContainText(AUGMENT_NPC_NAME);

  await expect(fieldRow(page, "motivation")).toContainText(AUGMENT_NPC_MOTIVATION);

  // The body is empty, so every proposed block is an addition — preselected.
  const secretBlock = page.locator("li").filter({ hasText: "Meldet" }).last();
  await expect(secretBlock.getByRole("button", { name: /^Übernehmen: / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Nothing is written before the accept.
  expect((await api.properties(NPC_PATH)).role).not.toBe(AUGMENT_NPC_ROLE);

  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: "Mit KI ergänzen" })).toHaveCount(0);

  // One transaction. The holes are filled …
  const npc = await api.entry(NPC_PATH);
  expect(npc.properties.role).toBe(AUGMENT_NPC_ROLE);
  expect(npc.properties.voice).toBe(AUGMENT_NPC_VOICE);
  expect(npc.properties.motivation).toBe(AUGMENT_NPC_MOTIVATION);
  expect(npc.body).not.toContain("## Will");
  expect(npc.body).toContain("> [!secret]");
  // … and what the entry already carried was NOT silently replaced.
  expect(npc.properties.name).toBe(EMPTY_NPC);
  expect(npc.properties.name).not.toBe(AUGMENT_NPC_NAME);
  expect(npc.properties.status).toBe("unknown");
  expect(npc.properties.status).not.toBe(AUGMENT_NPC_STATUS);
  // The job is gone with the same transaction.
  expect((await api.fetch("campaigns/beispiel/generate/job")).status).toBe(404);

  // Path 2: the reading view shows the filled entry at once — the motivation
  // in the header, the callout as a callout with the `[[fenn]]` inside it
  // resolved.
  await expect(page.getByText(AUGMENT_NPC_MOTIVATION)).toBeVisible();
  const secret = page.locator("[data-callout='secret']");
  await expect(secret).toContainText("Meldet");
  await expect(secret.getByRole("link", { name: /NPC:/ })).toBeVisible();
});

test("prepared scene: the new thread is added, every existing block survives", async ({
  page,
  api,
}) => {
  const before = await api.entry(SCENE);

  await page.goto(SCENE_URL);
  await startAugment(page);

  // The scene's properties are untouched by the reply, and the review says so
  // instead of inventing a decision.
  await expect(page.getByText("Keine Änderung an den Eigenschaften vorgeschlagen.")).toBeVisible({
    timeout: 30_000,
  });

  // Exactly ONE decision: the new `## If:` section, as an addition.
  const newBlock = page.locator("li").filter({ hasText: AUGMENT_THREAD_CONDITION }).last();
  await expect(newBlock).toContainText("Falls-Abschnitt");
  await expect(newBlock).toContainText("Neu");
  // The card is the decision, so it has to show the WHOLE section — the DM
  // cannot accept a branch whose body is nowhere on screen.
  await expect(newBlock).toContainText(`## If: ${AUGMENT_THREAD_CONDITION}`);
  await expect(newBlock).toContainText(AUGMENT_THREAD_TEXT);
  await expect(newBlock.getByRole("button", { name: /^Übernehmen: / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The existing blocks are not decisions — they sit behind the toggle that
  // reveals unchanged blocks, and they carry no toggle of their own.
  const flowBlock = () => page.locator("li").filter({ hasText: "Entwaffnet und gefesselt" }).last();
  await expect(flowBlock()).toHaveCount(0);
  await page.getByRole("button", { name: "Unveränderte Blöcke zeigen" }).click();
  await expect(flowBlock()).toBeVisible();
  await expect(flowBlock().getByRole("button", { name: /^Behalten: / })).toHaveCount(0);

  // The raw tab is the second surface of that rule — a line/word diff over the
  // whole body, with the added lines marked.
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByText(`## If: ${AUGMENT_THREAD_CONDITION}`)).toBeVisible();
  await page.getByRole("button", { name: "Blöcke", exact: true }).click();

  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: "Mit KI ergänzen" })).toHaveCount(0);

  // The whole point: the scene GREW. Everything that stood there before
  // stands there unchanged, character for character.
  const after = await api.entry(SCENE);
  expect(after.body).toContain(`## If: ${AUGMENT_THREAD_CONDITION}`);
  expect(after.body).toContain(AUGMENT_THREAD_TEXT);
  expect(after.body.startsWith(before.body.replace(/\n+$/, ""))).toBe(true);
  // The prepared status is not reset to `draft` (that would undo the DM's
  // preparation — the augment validation is narrower than the create run's).
  expect(after.properties.status).toBe("ready");

  // Path 2: the added branch renders as a real `## If:` section.
  await expect(page.locator("details[data-if-section]")).toHaveCount(3);
  await expect(page.getByText(AUGMENT_THREAD_CONDITION)).toBeVisible();
});

test("an npc with quickstats: the run passes and the mapping stays a mapping", async ({
  page,
  api,
}) => {
  // Jorna is the entry whose STORED shape differs from the reply shape:
  // `quickstats` is a mapping in the store and a `{ key, value }` list in a
  // reply. The stub echoes the properties the prompt showed it — so a prompt
  // that shows the wrong one ends this run in a 422 instead of a review.
  const before = await api.entry(FILLED_NPC);
  expect(before.properties.quickstats).toEqual({ insight: 2, "passive-perception": 12 });

  await page.goto(`/campaigns/beispiel/entries/${FILLED_NPC}`);
  await startAugment(page);

  await expect(page.getByText("Keine Änderung an den Eigenschaften vorgeschlagen.")).toBeVisible({
    timeout: 30_000,
  });
  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: "Mit KI ergänzen" })).toHaveCount(0);

  // The body grew, and the stats the DM authored are still the mapping they
  // were — values included, bare numbers and all.
  const after = await api.entry(FILLED_NPC);
  expect(after.body).toContain(`## If: ${AUGMENT_THREAD_CONDITION}`);
  expect(after.properties.quickstats).toEqual({ insight: 2, "passive-perception": 12 });
  expect(after.properties.name).toBe(before.properties.name);
});

test("block decisions survive a reload — the review state is on the job", async ({
  page,
}) => {
  await page.goto(SCENE_URL);
  await startAugment(page);

  // The one decision of this reply is the new `## If:` section, preselected
  // (a new unit is accepted by default).
  const newBlock = () => page.locator("li").filter({ hasText: AUGMENT_THREAD_CONDITION }).last();
  const keep = () => newBlock().getByRole("button", { name: /^Behalten: / });
  await expect(newBlock()).toBeVisible({ timeout: 30_000 });
  await expect(newBlock().getByRole("button", { name: /^Übernehmen: / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Decide AGAINST it and reload: the state lives on the job, so the dialog
  // comes back on the DM's decision instead of on the default.
  await keep().click();
  await expect(keep()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Gespeichert")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Mit KI ergänzen" }).click();
  await expect(newBlock()).toBeVisible({ timeout: 30_000 });
  await expect(keep()).toHaveAttribute("aria-pressed", "true");
});

test("while the run is on, only the run's own controls are there", async ({ page }) => {
  // TRIGGER.slow holds the reply, so the running phase can actually be
  // looked at. The start and cancel buttons belong to the INPUT phase: over a
  // running job the first would start nothing (one job per campaign) and the
  // second reads like a stop that it is not.
  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Mit KI ergänzen" }).click();
  await page.getByLabel("Quelltext", { exact: false }).fill(`${INSTRUCTION}\n\n${TRIGGER.slow}`);
  await page.getByRole("button", { name: "Ergänzen", exact: true }).click();

  const discard = page.getByRole("button", { name: "Lauf verwerfen" });
  await expect(discard).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Ergänzen", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Abbrechen", exact: true })).toHaveCount(0);

  // …and the run can be dropped from there, which is the point of the one
  // button that IS shown.
  await discard.click();
  await expect(page.getByRole("heading", { name: "Mit KI ergänzen" })).toHaveCount(0);
});

test("rejecting the proposal writes nothing and takes the job with it", async ({
  page,
  api,
}) => {
  const before = await api.entry(SCENE);

  await page.goto(SCENE_URL);
  await startAugment(page);
  const rejectButton = page.getByRole("button", { name: "Vorschlag verwerfen" });
  await expect(rejectButton).toBeVisible({ timeout: 30_000 });

  await rejectButton.click();
  await expect(page.getByRole("heading", { name: "Mit KI ergänzen" })).toHaveCount(0);

  // Nothing written — not even a new row version — and the job is gone.
  const after = await api.entry(SCENE);
  expect(after.properties).toEqual(before.properties);
  expect(after.body).toBe(before.body);
  expect(after.rev).toBe(before.rev);
  expect((await api.fetch("campaigns/beispiel/generate/job")).status).toBe(404);

  // And the reading view carries none of the proposal.
  await page.reload();
  await expect(page.getByText(AUGMENT_THREAD_TEXT)).toHaveCount(0);
});

test("409: the entry moves while the review is open — nothing is written", async ({
  page,
  api,
}) => {
  await page.goto(SCENE_URL);
  await startAugment(page);
  await expect(page.getByRole("button", { name: "Vorschlag verwerfen" })).toBeVisible({
    timeout: 30_000,
  });

  // A second writer through the same API is the only way an entry changes
  // under an open review: the review writes against the version it was cut
  // from, so this invalidates it.
  await api.writeBody(SCENE, "## Flow\n\nJemand anderes hat die Szene umgeschrieben.\n");

  await acceptButton(page).click();
  // The shared conflict line — with ONE action here: the accept step posts to
  // the job's own endpoint, which has no forced write, so continuing from what
  // is stored is the only honest answer and forcing is not offered.
  const conflictLine = page.getByRole("alert").filter({ hasText: "Inzwischen geändert" });
  await expect(conflictLine).toBeVisible();
  await expect(conflictLine.getByRole("button", { name: "Neu laden" })).toBeVisible();
  await expect(conflictLine.getByRole("button", { name: "Trotzdem speichern" })).toHaveCount(0);
  // The dialog stays open with the decisions intact, and NOTHING was written.
  const conflicted = await api.body(SCENE);
  expect(conflicted).toContain("Jemand anderes hat die Szene umgeschrieben.");
  expect(conflicted).not.toContain(AUGMENT_THREAD_TEXT);

  // Continuing from what is stored RE-ALIGNS the proposal against it, so the
  // next attempt carries the current version and goes through — a conflict is
  // a detour, not a dead end…
  await conflictLine.getByRole("button", { name: "Neu laden" }).click();
  await expect(conflictLine).toHaveCount(0);
  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: "Mit KI ergänzen" })).toHaveCount(0);
  const written = await api.body(SCENE);
  expect(written).toContain(AUGMENT_THREAD_TEXT);
  // …and the other writer is NOT overwritten by a decision that was cut
  // against the body they replaced.
  expect(written).toContain("Jemand anderes hat die Szene umgeschrieben.");
});

test("the entry point: npc, location and scene — and nothing else", async ({
  page,
}) => {
  const action = page.getByRole("button", { name: "Mit KI ergänzen" });

  await page.goto("/campaigns/beispiel/entries/npcs/jorna");
  await expect(action).toBeVisible();
  await page.goto("/campaigns/beispiel/entries/locations/leuchtturm");
  await expect(action).toBeVisible();
  await page.goto(SCENE_URL);
  await expect(action).toBeVisible();

  // The campaign entry is not augmentable — no augment prompt, no
  // action, and the reading view is untouched.
  await page.goto("/campaigns/beispiel/entries/campaign");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(action).toHaveCount(0);
});

test.describe("at 390px (critical path 8)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the action is desktop-only and both reading views still render", async ({
    page,
    api,
  }) => {
    await createEmptyNpc(api);
    // What a desktop augment run leaves behind, written through the ordinary
    // API — the phone's job is to READ the result, not to review a diff.
    await api.patchEntry(NPC_PATH, {
      properties: { motivation: AUGMENT_NPC_MOTIVATION },
      body: `\n## Weiß\n\n> [!secret] ${AUGMENT_NPC_SECRET}\n`,
    });

    await page.goto(NPC_URL);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(AUGMENT_NPC_MOTIVATION)).toBeVisible();
    await expect(page.locator("[data-callout='secret']")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mit KI ergänzen" })).toBeHidden();

    await page.goto(SCENE_URL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Von den Schmugglern erwischt",
    );
    await expect(page.locator("details[data-if-section]")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Mit KI ergänzen" })).toBeHidden();

    // Nothing may scroll sideways at 390px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/**
 * The dialog leaves the running phase on its own the moment the server job is
 * `done` — no closing and reopening to see the proposal.
 *
 * Two rules carry that (the generator route shares them, see
 * generator.e2e.ts): the phase comes from the JOB and never from the start
 * request, and the job poll keeps running while a run's own job is still on
 * its way — a 404 that overtakes the new row must not switch the interval off
 * for good.
 *
 * Two shapes, because they fail for different reasons:
 *
 *   fast  the job is `done` before its own 202 resolves. The 202 is HELD here
 *         (the real response of the real server, fetched by the real route
 *         and handed on late — nothing is mocked but the model) because with
 *         a response that comes back in 30ms the test would pass either way.
 *   slow  the job is genuinely `running` when the first poll answers and
 *         finishes on a LATER poll (TRIGGER.latePart holds the augment reply
 *         without killing it), so the spinner has to give way on a polled
 *         update.
 */
test("the proposal appears as soon as the job is done — start request still in flight", async ({
  page,
}) => {
  let released = false;
  await page.route("**/api/campaigns/*/generate/augment", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    released = true;
    await route.fulfill({ status: response.status(), body, contentType: "application/json" });
  });

  await page.goto(SCENE_URL);
  await startAugment(page);
  // The honest state right after the click: no job of this run is readable
  // yet, so the dialog says the run is going — and it keeps polling for it.
  await expect(page.getByText("Läuft auf dem Server", { exact: false })).toBeVisible();

  // …and the first poll that answers carries the finished run, so THIS is the
  // review — no closing, no reopening, long before the 202 of the same run.
  await expect(page.getByRole("button", { name: "Vorschlag verwerfen" })).toBeVisible({
    timeout: 7_000,
  });
  await expect(
    page.locator("li").filter({ hasText: AUGMENT_THREAD_CONDITION }).last(),
  ).toBeVisible();
  expect(released).toBe(false);

  // Let the held response go: the arrival of the 202 must not throw the
  // review away again.
  await expect(async () => expect(released).toBe(true)).toPass({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Vorschlag verwerfen" })).toBeVisible();
});

test("the proposal appears on a polled update — a run that is really running", async ({
  page,
}) => {
  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Mit KI ergänzen" }).click();
  await page
    .getByLabel("Quelltext", { exact: false })
    .fill(`${INSTRUCTION}\n\n${TRIGGER.latePart}`);
  await page.getByRole("button", { name: "Ergänzen", exact: true }).click();

  await expect(page.getByText("Läuft auf dem Server", { exact: false })).toBeVisible();
  // No reopening: the poll that finds the finished job swaps the spinner for
  // the review by itself.
  await expect(page.getByRole("button", { name: "Vorschlag verwerfen" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator("li").filter({ hasText: AUGMENT_THREAD_CONDITION }).last(),
  ).toBeVisible();
});

// --- helpers ------------------------------------------------------------------

/**
 * The properties row of one key. The key stands alone in its own mono span,
 * which is what makes it addressable without a test id.
 */
function fieldRow(page: Page, key: string) {
  return page
    .locator("li")
    .filter({ has: page.getByText(key, { exact: true }) })
    .first();
}

/** State badge and preselected decision of one properties field. */
async function expectDecision(
  page: Page,
  key: string,
  state: string,
  chosen: "Übernehmen" | "Behalten",
): Promise<void> {
  const row = fieldRow(page, key);
  await expect(row).toContainText(state);
  // The row buttons are named with their unit, which is what distinguishes
  // them from the footer's accept button.
  await expect(row.getByRole("button", { name: `${chosen}: ${key}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

/**
 * The review's accept button. The per-row toggles share its WORD but not its
 * accessible name — theirs carries the unit as a suffix — so the footer
 * button is addressable exactly.
 */
function acceptButton(page: Page) {
  return page.getByRole("button", { name: "Übernehmen", exact: true });
}