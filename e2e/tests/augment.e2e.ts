// Critical path 6, the second half: augmenting with the model.
//
// The create runs of that path live in `generator.e2e.ts`; this spec is the
// same pipeline pointed at a scene, an npc or a location that ALREADY EXISTS,
// and it asserts these things:
//
//   a) an EMPTY npc — one created and not filled in — is augmented on its own
//      resource (decisions/resources) and its holes are filled,
//   b) a PREPARED scene is augmented on its own resource (decisions/resources) and gains
//      a new plot thread as ADDITIONAL blocks while every existing block
//      comes back byte for byte,
//   b2) a FILLED npc — whose stored shape differs from the reply shape
//      (`quickstats` as a mapping vs. a `{ key, value }` list) — is
//      augmented and keeps its stats as the mapping they are,
//   c) rejecting the proposal writes nothing and takes the job with it,
//   d) a scene that moves while the review is open answers 409 and nothing
//      is written (decisions/writes) — the review recovers on the re-read,
//   e) a proposal that names an id nobody has (`[[…]]`) costs one correction
//      turn, and the DM reviews the corrected one,
//   f) a LOCATION is augmented on its own resource (decisions/resources): its run starts
//      on `…/locations/:id/augment`, its proposal is the location as read
//      beside the location as proposed, and the accept writes the location.
//
// Two of them carry the default rule with them, because it is the rule the
// whole feature turns on: by default only empty and new units are accepted,
// and a filled one is never silently replaced. The npc reply therefore
// proposes a mix — three fields the npc has nothing in (the motivation among
// them, a field like any other), two it already has — and the spec checks
// the PRESELECTION, not just the outcome.
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
  AUGMENT_NPC_SECRET_OPENING,
  AUGMENT_NPC_STATUS,
  AUGMENT_NPC_VOICE,
  AUGMENT_THREAD_CONDITION,
  AUGMENT_THREAD_TEXT,
  TRIGGER,
  UNKNOWN_REF_ID,
} from "../fixtures/replies";
import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { getCampaign } from "../support/campaign";
import { getChapter } from "../support/chapter";
import { getGeneratorJob, readGeneratorJob } from "../support/generator-job";
import { getLocation } from "../support/location";
import { createNpc, getNpc, patchNpc } from "../support/npc";
import { getScene, patchScene } from "../support/scene";
import { ui, uiPattern } from "../support/ui";
import type { MessageKey } from "../../app/src/i18n/messages";

/** The prepared scene of the example campaign — the augment target of (b). */
const SCENE = "smuggler-captured";
const SCENE_URL = `/campaigns/beispiel/scenes/${SCENE}`;

/** The example campaign's filled npc — the one that carries `quickstats`. */
const FILLED_NPC = "jorna";
const FILLED_NPC_URL = `/campaigns/beispiel/npcs/${FILLED_NPC}`;

/** The empty npc — created, never filled in. */
const EMPTY_NPC = "informer";
const NPC_URL = `/campaigns/beispiel/npcs/${EMPTY_NPC}`;

const INSTRUCTION = "Introduce a plot thread around the smugglers' informer";

/** The example campaign's location — the augment target of (f). */
const LOCATION = "leuchtturm";
const LOCATION_URL = `/campaigns/beispiel/locations/${LOCATION}`;

/** What a second writer puts into the scene while the review is open. */
const OTHER_WRITER_TEXT = "Someone else rewrote the scene.";

/** Any unit's take and keep toggle, whatever unit it names. */
const TAKE_UNIT = uiPattern("augment.decision.takeUnit", { label: /.*/ }, { exact: true });
const KEEP_UNIT = uiPattern("augment.decision.keepUnit", { label: /.*/ }, { exact: true });

/** The accessible name of a `[[ref]]` to an npc. */
function npcRefName(name: string): string {
  return ui("markdown.ref.aria", { kind: ui("kind.npc"), name });
}

/** The first line of the paragraph under a heading of a body — seeded prose, read as data. */
function firstLineAfter(body: string, heading: string): string {
  return body.split(`${heading}\n\n`)[1]!.split("\n")[0]!;
}

/**
 * Create an npc with nothing but the id — how a DM ends up with an npc that
 * exists and says nothing. The scene then references it, which is only
 * possible BECAUSE it exists (decisions/constraints).
 */
async function createEmptyNpc(api: Api): Promise<void> {
  await createNpc(api, { name: EMPTY_NPC });
  await patchScene(api, SCENE, { npcs: ["fenn", EMPTY_NPC] });
  const npc = await getNpc(api, EMPTY_NPC);
  expect(npc.name).toBe(EMPTY_NPC);
  expect(npc.body).toBe("");
}

/** Open the dialog on what the page shows and start a run. */
async function startAugment(page: Page): Promise<void> {
  await page.getByRole("button", { name: ui("augment.action") }).click();
  await page.getByLabel(ui("augment.instruction.label")).fill(INSTRUCTION);
  await page.getByRole("button", { name: ui("augment.start"), exact: true }).click();
}

test("empty npc from a reference: augment fills the holes, keeps what is filled", async ({
  page,
  api,
}) => {
  await createEmptyNpc(api);

  await page.goto(NPC_URL);
  await page.getByRole("button", { name: ui("augment.action") }).click();
  await expect(page.getByRole("heading", { name: ui("augment.title") })).toBeVisible();
  // The dialog names the npc it is about by its DISPLAY NAME — the resource
  // segment is how it is stored, not how the DM knows it.
  const lead = page.getByText(ui("augment.description", { name: EMPTY_NPC }));
  await expect(lead).toBeVisible();
  await expect(lead).not.toContainText("npcs/");

  // Nothing may start without input (source text and/or instruction).
  const startButton = page.getByRole("button", { name: ui("augment.start"), exact: true });
  await expect(startButton).toBeDisabled();
  await page.getByLabel(ui("augment.instruction.label")).fill(INSTRUCTION);
  await expect(startButton).toBeEnabled();
  await startButton.click();

  // The server job finishes and the review takes the dialog over.
  await expect(page.getByText(ui("augment.field.current")).first()).toBeVisible({
    timeout: 30_000,
  });

  // The defaults: `role`, `voice` and `motivation` are holes -> new,
  // preselected for acceptance; `name` and `status` already carry a value ->
  // changed, KEPT.
  await expectDecision(page, "role", "augment.state.new", "take");
  await expectDecision(page, "voice", "augment.state.new", "take");
  await expectDecision(page, "motivation", "augment.state.new", "take");
  await expectDecision(page, "name", "augment.state.changed", "keep");
  await expectDecision(page, "status", "augment.state.changed", "keep");
  // The two-column diff really shows both sides.
  await expect(fieldRow(page, "role").getByText(ui("augment.field.empty"))).toBeVisible();
  await expect(fieldRow(page, "role")).toContainText(AUGMENT_NPC_ROLE);
  await expect(fieldRow(page, "name")).toContainText(AUGMENT_NPC_NAME);

  await expect(fieldRow(page, "motivation")).toContainText(AUGMENT_NPC_MOTIVATION);

  // The body is empty, so every proposed block is an addition — preselected.
  const secretBlock = page.locator("li").filter({ hasText: AUGMENT_NPC_SECRET_OPENING }).last();
  await expect(secretBlock.getByRole("button", { name: TAKE_UNIT })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The job is the npc's own run (decisions/resources): kind, id and a typed proposal —
  // the npc as read beside the npc as proposed, no address anywhere.
  const job: Record<string, unknown> = await getGeneratorJob(api);
  expect(job.kind).toBe("npc-augment");
  expect(job.npc).toBe(EMPTY_NPC);
  expect(job.target).toBeUndefined();
  expect(job.augmentResult).toBeUndefined();
  const proposal = job.npcAugmentResult as {
    id: string;
    current: Record<string, unknown>;
    proposed: Record<string, unknown>;
  };
  expect(proposal.id).toBe(EMPTY_NPC);
  const { rev: _rev, ...current } = await getNpc(api, EMPTY_NPC);
  expect(proposal.current).toEqual(current);
  expect(proposal.proposed.role).toBe(AUGMENT_NPC_ROLE);
  for (const side of [proposal.current, proposal.proposed]) {
    expect(Object.keys(side)).not.toContain("path");
    expect(Object.keys(side)).not.toContain("kind");
    expect(Object.keys(side)).not.toContain("properties");
    // A field the npc does not carry is absent, never `null`.
    expect(Object.values(side)).not.toContain(null);
  }

  // Nothing is written before the accept.
  expect((await getNpc(api, EMPTY_NPC)).role).toBeUndefined();

  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: ui("augment.title") })).toHaveCount(0);

  // One transaction. The holes are filled …
  const npc = await getNpc(api, EMPTY_NPC);
  expect(npc.role).toBe(AUGMENT_NPC_ROLE);
  expect(npc.voice).toBe(AUGMENT_NPC_VOICE);
  expect(npc.motivation).toBe(AUGMENT_NPC_MOTIVATION);
  expect(npc.body).not.toContain("## Will");
  expect(npc.body).toContain("> [!secret]");
  // … and what the npc already carried was NOT silently replaced.
  expect(npc.name).toBe(EMPTY_NPC);
  expect(npc.name).not.toBe(AUGMENT_NPC_NAME);
  expect(npc.status).toBe("unknown");
  expect(npc.status).not.toBe(AUGMENT_NPC_STATUS);
  // The job is gone with the same transaction.
  expect(await readGeneratorJob(api)).toBeNull();

  // Path 2: the reading view shows the filled npc at once — the motivation
  // in the header, the callout as a callout with the `[[fenn]]` inside it
  // resolved.
  await expect(page.getByText(AUGMENT_NPC_MOTIVATION)).toBeVisible();
  const secret = page.locator("[data-callout='secret']");
  await expect(secret).toContainText(AUGMENT_NPC_SECRET_OPENING);
  const fenn = (await getNpc(api, "fenn")).name;
  await expect(secret.getByRole("link", { name: npcRefName(fenn) })).toBeVisible();
});

test("prepared scene: the new thread is added, every existing block survives", async ({
  page,
  api,
}) => {
  const before = await getScene(api, SCENE);

  await page.goto(SCENE_URL);
  await startAugment(page);

  // The scene's other fields are untouched by the reply, and the review says
  // so instead of inventing a decision.
  await expect(page.getByText(ui("augment.properties.none"))).toBeVisible({
    timeout: 30_000,
  });

  // The job is the scene's own run (decisions/resources): kind, id and a typed proposal —
  // the scene as read beside the scene as proposed, flat, no address anywhere.
  const job: Record<string, unknown> = await getGeneratorJob(api);
  expect(job.kind).toBe("scene-augment");
  expect(job.scene).toBe(SCENE);
  const proposal = job.sceneAugmentResult as {
    id: string;
    current: Record<string, unknown>;
    proposed: Record<string, unknown>;
  };
  expect(proposal.id).toBe(SCENE);
  const { rev: _rev, ...current } = before;
  expect(proposal.current).toEqual(current);
  for (const side of [proposal.current, proposal.proposed]) {
    for (const key of ["path", "kind", "properties"]) expect(Object.keys(side)).not.toContain(key);
    expect(Object.values(side)).not.toContain(null);
  }

  // Exactly ONE decision: the new `## If:` section, as an addition.
  const newBlock = page.locator("li").filter({ hasText: AUGMENT_THREAD_CONDITION }).last();
  await expect(newBlock).toContainText(ui("composer.blockType.ifSection"));
  await expect(newBlock).toContainText(ui("augment.state.new"));
  // The card is the decision, so it has to show the WHOLE section — the DM
  // cannot accept a branch whose body is nowhere on screen.
  await expect(newBlock).toContainText(`## If: ${AUGMENT_THREAD_CONDITION}`);
  await expect(newBlock).toContainText(AUGMENT_THREAD_TEXT);
  await expect(newBlock.getByRole("button", { name: TAKE_UNIT })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The existing blocks are not decisions — they sit behind the toggle that
  // reveals unchanged blocks, and they carry no toggle of their own.
  const flowOpening = firstLineAfter(before.body, "## Flow");
  const flowBlock = () => page.locator("li").filter({ hasText: flowOpening }).last();
  await expect(flowBlock()).toHaveCount(0);
  await page.getByRole("button", { name: ui("augment.body.showUnchanged") }).click();
  await expect(flowBlock()).toBeVisible();
  await expect(flowBlock().getByRole("button", { name: KEEP_UNIT })).toHaveCount(0);

  // The raw tab is the second surface of that rule — a line/word diff over the
  // whole body, with the added lines marked.
  const modes = page.getByRole("group", { name: ui("augment.body.modeGroup") });
  await modes.getByRole("button", { name: ui("augment.body.markdown"), exact: true }).click();
  await expect(page.getByText(`## If: ${AUGMENT_THREAD_CONDITION}`)).toBeVisible();
  await modes.getByRole("button", { name: ui("augment.body.blocks"), exact: true }).click();

  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: ui("augment.title") })).toHaveCount(0);

  // The whole point: the scene GREW. Everything that stood there before
  // stands there unchanged, character for character.
  const after = await getScene(api, SCENE);
  expect(after.body).toContain(`## If: ${AUGMENT_THREAD_CONDITION}`);
  expect(after.body).toContain(AUGMENT_THREAD_TEXT);
  expect(after.body.startsWith(before.body.replace(/\n+$/, ""))).toBe(true);
  // The prepared status is not reset to `draft` (that would undo the DM's
  // preparation — the augment validation is narrower than the create run's).
  expect(after.status).toBe("ready");

  // Path 2: the added branch renders as a real `## If:` section.
  await expect(page.locator("details[data-if-section]")).toHaveCount(3);
  await expect(page.getByText(AUGMENT_THREAD_CONDITION)).toBeVisible();
});

test("an npc with quickstats: the run passes and the mapping stays a mapping", async ({
  page,
  api,
}) => {
  // Jorna is the npc whose STORED shape differs from the reply shape:
  // `quickstats` is a mapping in the store and a `{ key, value }` list in a
  // reply. The stub echoes the fields the prompt showed it — so a prompt that
  // shows the wrong one ends this run in a 422 instead of a review.
  const before = await getNpc(api, FILLED_NPC);
  expect(before.quickstats).toEqual({ insight: 2, "passive-perception": 12 });

  await page.goto(FILLED_NPC_URL);
  await startAugment(page);

  await expect(page.getByText(ui("augment.properties.none"))).toBeVisible({
    timeout: 30_000,
  });
  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: ui("augment.title") })).toHaveCount(0);

  // The body grew, and the stats the DM authored are still the mapping they
  // were — values included, bare numbers and all.
  const after = await getNpc(api, FILLED_NPC);
  expect(after.body).toContain(`## If: ${AUGMENT_THREAD_CONDITION}`);
  expect(after.quickstats).toEqual({ insight: 2, "passive-perception": 12 });
  expect(after.name).toBe(before.name);
  expect(after.rev).toBe(before.rev + 1);
});

test("an unknown [[id]] in the proposal costs one correction turn", async ({ page, api }) => {
  // The stub's first reply adds a sentence naming `[[the-stranger]]`; the
  // correction turn answers the good proposal. What the review shows — and
  // what the accept writes — is the corrected one.
  await page.goto(FILLED_NPC_URL);
  await page.getByRole("button", { name: ui("augment.action") }).click();
  await page
    .getByLabel(ui("augment.source.label"))
    .fill(`${INSTRUCTION}\n\n${TRIGGER.unknownRef}`);
  await page.getByRole("button", { name: ui("augment.start"), exact: true }).click();

  await expect(page.getByText(ui("augment.properties.none"))).toBeVisible({
    timeout: 30_000,
  });
  const job = await getGeneratorJob(api);
  expect(job.npcAugmentResult!.usage?.attempts).toBe(2);
  expect(job.npcAugmentResult!.proposed.body).not.toContain(UNKNOWN_REF_ID);
  await expect(page.getByRole("dialog")).not.toContainText(UNKNOWN_REF_ID);

  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: ui("augment.title") })).toHaveCount(0);
  const after = (await getNpc(api, FILLED_NPC)).body;
  expect(after).toContain(AUGMENT_THREAD_TEXT);
  expect(after).not.toContain(UNKNOWN_REF_ID);
});

test("block decisions survive a reload — the review state is on the job", async ({
  page,
}) => {
  await page.goto(SCENE_URL);
  await startAugment(page);

  // The one decision of this reply is the new `## If:` section, preselected
  // (a new unit is accepted by default).
  const newBlock = () => page.locator("li").filter({ hasText: AUGMENT_THREAD_CONDITION }).last();
  const keep = () => newBlock().getByRole("button", { name: KEEP_UNIT });
  await expect(newBlock()).toBeVisible({ timeout: 30_000 });
  await expect(newBlock().getByRole("button", { name: TAKE_UNIT })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Decide AGAINST it and reload: the state lives on the job, so the dialog
  // comes back on the DM's decision instead of on the default.
  await keep().click();
  await expect(keep()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(ui("generate.review.saved"))).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: ui("augment.action") }).click();
  await expect(newBlock()).toBeVisible({ timeout: 30_000 });
  await expect(keep()).toHaveAttribute("aria-pressed", "true");
});

test("while the run is on, only the run's own controls are there", async ({ page }) => {
  // TRIGGER.slow holds the reply, so the running phase can actually be
  // looked at. The start and cancel buttons belong to the INPUT phase: over a
  // running job the first would start nothing (one job per campaign) and the
  // second reads like a stop that it is not.
  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: ui("augment.action") }).click();
  await page.getByLabel(ui("augment.source.label")).fill(`${INSTRUCTION}\n\n${TRIGGER.slow}`);
  await page.getByRole("button", { name: ui("augment.start"), exact: true }).click();

  const discard = page.getByRole("button", { name: ui("augment.discard") });
  await expect(discard).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: ui("augment.start"), exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: ui("common.cancel"), exact: true })).toHaveCount(0);

  // …and the run can be dropped from there, which is the point of the one
  // button that IS shown.
  await discard.click();
  await expect(page.getByRole("heading", { name: ui("augment.title") })).toHaveCount(0);
});

test("rejecting the proposal writes nothing and takes the job with it", async ({
  page,
  api,
}) => {
  const before = await getScene(api, SCENE);

  await page.goto(SCENE_URL);
  await startAugment(page);
  const rejectButton = page.getByRole("button", { name: ui("augment.reject") });
  await expect(rejectButton).toBeVisible({ timeout: 30_000 });

  await rejectButton.click();
  await expect(page.getByRole("heading", { name: ui("augment.title") })).toHaveCount(0);

  // Nothing written — not even a new row version — and the job is gone.
  expect(await getScene(api, SCENE)).toEqual(before);
  expect(await readGeneratorJob(api)).toBeNull();

  // And the reading view carries none of the proposal.
  await page.reload();
  await expect(page.getByText(AUGMENT_THREAD_TEXT)).toHaveCount(0);
});

test("409: the scene moves while the review is open — nothing is written", async ({
  page,
  api,
}) => {
  await page.goto(SCENE_URL);
  await startAugment(page);
  await expect(page.getByRole("button", { name: ui("augment.reject") })).toBeVisible({
    timeout: 30_000,
  });

  // A second writer through the same API is the only way a scene changes
  // under an open review: the review writes against the version it was cut
  // from, so this invalidates it.
  await patchScene(api, SCENE, { body: `## Flow\n\n${OTHER_WRITER_TEXT}\n` });

  await acceptButton(page).click();
  // The shared conflict line — with ONE action here: the accept step posts to
  // the job's own endpoint, which has no forced write, so continuing from what
  // is stored is the only honest answer and forcing is not offered.
  const conflictLine = page.getByRole("alert").filter({ hasText: ui("editConflict.line") });
  await expect(conflictLine).toBeVisible();
  await expect(conflictLine.getByRole("button", { name: ui("editConflict.reload") })).toBeVisible();
  await expect(conflictLine.getByRole("button", { name: ui("editConflict.force") })).toHaveCount(0);
  // The dialog stays open with the decisions intact, and NOTHING was written.
  const conflicted = (await getScene(api, SCENE)).body;
  expect(conflicted).toContain(OTHER_WRITER_TEXT);
  expect(conflicted).not.toContain(AUGMENT_THREAD_TEXT);

  // Continuing from what is stored RE-ALIGNS the proposal against it, so the
  // next attempt carries the current version and goes through — a conflict is
  // a detour, not a dead end…
  await conflictLine.getByRole("button", { name: ui("editConflict.reload") }).click();
  await expect(conflictLine).toHaveCount(0);
  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: ui("augment.title") })).toHaveCount(0);
  const written = (await getScene(api, SCENE)).body;
  expect(written).toContain(AUGMENT_THREAD_TEXT);
  // …and the other writer is NOT overwritten by a decision that was cut
  // against the body they replaced.
  expect(written).toContain(OTHER_WRITER_TEXT);
});

test("the entry point: npc, location and scene — and nothing else", async ({
  page,
  api,
}) => {
  const action = page.getByRole("button", { name: ui("augment.action") });

  await page.goto(FILLED_NPC_URL);
  await expect(action).toBeVisible();
  await page.goto(LOCATION_URL);
  await expect(action).toBeVisible();
  await page.goto(SCENE_URL);
  await expect(action).toBeVisible();

  // A chapter and the campaign are not augmentable — no augment prompt, no
  // action on the chapter's reading view or the campaign's route.
  await page.goto("/campaigns/beispiel/chapters/01-salzhafen");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    (await getChapter(api, "01-salzhafen")).title,
  );
  await expect(action).toHaveCount(0);
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText((await getCampaign(api)).name);
  await expect(action).toHaveCount(0);
});

test("a location is augmented on its own resource: the proposal, then one write", async ({
  page,
  api,
}) => {
  const before = await getLocation(api, LOCATION);
  expect(before.roll20Page).toEqual(expect.any(String));
  await page.goto(LOCATION_URL);
  await startAugment(page);
  await expect(page.getByRole("button", { name: ui("augment.reject") })).toBeVisible({
    timeout: 30_000,
  });

  // The job is the location's own run: kind, id and a typed proposal — the
  // location as read beside the location as proposed, no address anywhere.
  const job: Record<string, unknown> = await getGeneratorJob(api);
  expect(job.kind).toBe("location-augment");
  expect(job.location).toBe(LOCATION);
  expect(job.target).toBeUndefined();
  expect(job.augmentResult).toBeUndefined();
  const proposal = job.locationAugmentResult as {
    id: string;
    current: Record<string, unknown>;
    proposed: Record<string, unknown>;
  };
  expect(proposal.id).toBe(LOCATION);
  const { rev: _rev, ...current } = before;
  expect(proposal.current).toEqual(current);
  expect(proposal.proposed.roll20Page).toBe(before.roll20Page);
  for (const side of [proposal.current, proposal.proposed]) {
    expect(Object.keys(side)).not.toContain("path");
    expect(Object.keys(side)).not.toContain("kind");
    expect(Object.keys(side)).not.toContain("properties");
  }

  // The new plot thread is an addition — preselected; nothing is written yet.
  const thread = page.locator("li").filter({ hasText: AUGMENT_THREAD_CONDITION }).last();
  await expect(thread.getByRole("button", { name: TAKE_UNIT })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect((await getLocation(api, LOCATION)).body).toBe(before.body);

  await acceptButton(page).click();
  await expect(page.getByRole("heading", { name: ui("augment.title") })).toHaveCount(0);
  const after = await getLocation(api, LOCATION);
  expect(after.body).toContain(AUGMENT_THREAD_TEXT);
  expect(after.body.trimStart().startsWith(before.body.trim())).toBe(true);
  expect(after.atmosphere).toBe(before.atmosphere);
  expect(after.rev).toBe(before.rev + 1);
  // The job went with the write, and the reading view shows the new text.
  expect(await readGeneratorJob(api)).toBeNull();
  await expect(page.getByRole("article")).toContainText(AUGMENT_THREAD_CONDITION);
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
    await patchNpc(api, EMPTY_NPC, {
      motivation: AUGMENT_NPC_MOTIVATION,
      body: `\n## Weiß\n\n> [!secret] ${AUGMENT_NPC_SECRET}\n`,
    });

    await page.goto(NPC_URL);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(AUGMENT_NPC_MOTIVATION)).toBeVisible();
    await expect(page.locator("[data-callout='secret']")).toBeVisible();
    await expect(page.getByRole("button", { name: ui("augment.action") })).toBeHidden();

    await page.goto(SCENE_URL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      (await getScene(api, SCENE)).title,
    );
    await expect(page.locator("details[data-if-section]")).toHaveCount(2);
    await expect(page.getByRole("button", { name: ui("augment.action") })).toBeHidden();

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
  await page.route("**/api/campaigns/*/scenes/*/augment", async (route) => {
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
  await expect(page.getByText(ui("augment.running"))).toBeVisible();

  // …and the first poll that answers carries the finished run, so THIS is the
  // review — no closing, no reopening, long before the 202 of the same run.
  await expect(page.getByRole("button", { name: ui("augment.reject") })).toBeVisible({
    timeout: 7_000,
  });
  await expect(
    page.locator("li").filter({ hasText: AUGMENT_THREAD_CONDITION }).last(),
  ).toBeVisible();
  expect(released).toBe(false);

  // Let the held response go: the arrival of the 202 must not throw the
  // review away again.
  await expect(async () => expect(released).toBe(true)).toPass({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: ui("augment.reject") })).toBeVisible();
});

test("the proposal appears on a polled update — a run that is really running", async ({
  page,
}) => {
  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: ui("augment.action") }).click();
  await page
    .getByLabel(ui("augment.source.label"))
    .fill(`${INSTRUCTION}\n\n${TRIGGER.latePart}`);
  await page.getByRole("button", { name: ui("augment.start"), exact: true }).click();

  await expect(page.getByText(ui("augment.running"))).toBeVisible();
  // No reopening: the poll that finds the finished job swaps the spinner for
  // the review by itself.
  await expect(page.getByRole("button", { name: ui("augment.reject") })).toBeVisible({
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
  state: Extract<MessageKey, "augment.state.new" | "augment.state.changed">,
  chosen: "take" | "keep",
): Promise<void> {
  const row = fieldRow(page, key);
  await expect(row).toContainText(ui(state));
  // The row buttons are named with their unit, which is what distinguishes
  // them from the footer's accept button.
  const toggle = chosen === "take" ? "augment.decision.takeUnit" : "augment.decision.keepUnit";
  await expect(
    row.getByRole("button", { name: ui(toggle, { label: key }), exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
}

/**
 * The review's accept button. The per-row toggles share its WORD but not its
 * accessible name — theirs carries the unit as a suffix — so the footer
 * button is addressable exactly.
 */
function acceptButton(page: Page) {
  return page.getByRole("button", { name: ui("augment.accept"), exact: true });
}