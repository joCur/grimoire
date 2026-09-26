// Critical path 9, second spec: the BLOCK COMPOSER — the edit action opens the
// scene's text as a list of typed cards rather than a wall of markdown, and
// the raw textarea is one click away as the fallback (the markdown mode).
// `tests/entry-edit.e2e.ts` owns that fallback and the whole save/409/discard
// machinery seen from it; this spec owns the composer.
//
// What has to hold, and why every test below reads the scene back through the API:
//
//   * OPENING AND CLOSING A SCENE MUST NOT COST A BYTE. The composer parses the
//     body and serializes it again, so the round trip is the one thing that
//     could quietly reformat a hand-written scene. The save action stays
//     disabled after a blocks → markdown → blocks detour, and every save is
//     asserted as "this one block's bytes changed, all the others did not" —
//     never as a `toContain` on the new text, which would pass on a reflowed
//     body too.
//   * THE FORMAT DEGRADES (README). An unknown callout and a markdown table are
//     not modelled by the composer; they must show up as cards, survive a save
//     of a NEIGHBOURING block byte for byte, and never raise an error.
//   * NOTHING NEW IN THE LOSS DEPARTMENT. A 409 in the blocks mode keeps the
//     draft AND the open form, cancelling asks before it throws work away, and
//     the phone-sized layout can do all of it.
//
// Block cards are addressed through their controls' accessible names — the
// card name is the block's label plus its position — because that is the only
// place where a card's TYPE and its POSITION are both visible from outside, and
// asserting them is asserting the vocabulary of the reading view (the callout
// labels plus heading, text, if-section and markdown block). `exact: true`
// everywhere: the text card's name is a substring of the read-aloud card's.
//
// The scene texts quoted below are the example campaign's in fixtures/, which
// is German; every text a test types itself is English.

import type { Locator, Page } from "@playwright/test";

import type { SceneProposal } from "@grimoire/shared/scene";
import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { getScene, patchScene } from "../support/scene";
import type { MessageKey } from "../../app/src/i18n/messages";
import { ui } from "../support/ui";

/** Six blocks, one per type the reading view knows — the composer's reference. */
const SCENE = "lighthouse-arrival";
const SCENE_URL = `/campaigns/beispiel/scenes/${SCENE}`;
const SCENE_TITLE = "Ankunft am Leuchtturm";
/** The reference scene WITH two `## If:` sections and their children. */
const IF_SCENE = "smuggler-captured";
const IF_SCENE_URL = `/campaigns/beispiel/scenes/${IF_SCENE}`;
/** The first read-aloud line of SCENE. */
const TOWER_LINE = "Der Turm ragt schwarz gegen den Abendhimmel auf.";
/** The condition of IF_SCENE's first section. */
const FIRST_CONDITION = "sie geben zu, für Jorna zu arbeiten";

/** The label a block type shows: the reading view's callout labels and the four structural ones. */
const LABEL = {
  readaloud: ui("markdown.callout.readaloud"),
  check: ui("markdown.callout.check"),
  secret: ui("markdown.callout.secret"),
  outcome: ui("markdown.callout.outcome"),
  loot: ui("markdown.callout.loot"),
  note: ui("markdown.callout.note"),
  heading: ui("composer.blockType.heading"),
  text: ui("composer.blockType.text"),
  ifSection: ui("composer.blockType.ifSection"),
  markdown: ui("composer.blockType.markdown"),
};

/** A card's name: its label and its position in its list. */
function block(label: string, position: number): string {
  return ui("composer.card.name", { label, position });
}

/** The cards of SCENE, in document order, as the composer names them. */
const SCENE_BLOCKS = [
  block(LABEL.heading, 1),
  block(LABEL.text, 2),
  block(LABEL.readaloud, 3),
  block(LABEL.check, 4),
  block(LABEL.secret, 5),
  block(LABEL.note, 6),
];

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A catalog text around one parameter, split at it. */
function around(key: MessageKey, param: string): [string, string] {
  const marker = "\u0000";
  const [before = "", after = ""] = ui(key, { [param]: marker }).split(marker);
  return [before, after];
}

/**
 * Read the scene: its text, and every other field beside it — a save of the
 * text has to leave those alone, which is what the assertions look at.
 */
async function split(api: Api, id: string) {
  const { body, rev: _rev, ...fields } = await getScene(api, id);
  return { fields, body };
}

/** The scene's text. */
async function bodyOf(api: Api, id: string): Promise<string> {
  return (await getScene(api, id)).body;
}

/**
 * The verbatim markdown of ONE block of a body: the run of lines that starts
 * with the first line beginning with `head`, up to (not including) the next
 * blank line. "Byte-identical" in the assertions below means exactly this
 * string — which also catches a re-wrapped paragraph, not just a lost one.
 */
function blockOf(text: string, head: string): string {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => line.startsWith(head));
  expect(from, `no block starting with ${JSON.stringify(head)}`).toBeGreaterThanOrEqual(0);
  let to = from;
  while (to + 1 < lines.length && (lines[to + 1] ?? "").trim() !== "") to += 1;
  return lines.slice(from, to + 1).join("\n");
}

/** The composer's region — present exactly while the blocks mode is the surface. */
function composer(page: Page): Locator {
  const [before] = around("composer.list.aria", "label");
  return page.getByRole("region", { name: new RegExp(`^${escaped(before)}`) });
}

/** The text editor's frame: mode switch, and the composer or the raw textarea. */
function textEditor(page: Page): Locator {
  return page.getByTestId("text-editor");
}

/** The raw textarea of the markdown mode (labelled with the scene's title). */
function rawTextarea(page: Page): Locator {
  const [before] = around("bodyEditor.markdown.aria", "path");
  return page.getByRole("textbox", { name: new RegExp(`^${escaped(before)}`) });
}

/** The form field of an open card, named by the card's label. */
function contentField(page: Page, label: string): Locator {
  return page.getByRole("textbox", { name: ui("composer.block.content.aria", { label }), exact: true });
}

/** The controls of one card, addressed by its name. */
function card(page: Page, name: string) {
  const button = (key: MessageKey) =>
    page.getByRole("button", { name: ui(key, { name }), exact: true });
  return {
    /** ✎ — opens the typed form. Only present while the card is collapsed. */
    edit: button("composer.card.edit.aria"),
    /** The same button with the form open. */
    collapse: button("composer.card.collapse.aria"),
    up: button("composer.card.moveUp.aria"),
    down: button("composer.card.moveDown.aria"),
    remove: button("composer.card.delete.aria"),
  };
}

/**
 * The cards on screen in DOM order, named as the UI names them. An If-section's
 * children follow their section and count from 1 again, so the returned list
 * shows the nesting as well.
 */
async function blockNames(page: Page): Promise<string[]> {
  const suffixes = [
    around("composer.card.edit.aria", "name")[1],
    around("composer.card.collapse.aria", "name")[1],
  ];
  const pattern = new RegExp(`(${suffixes.map(escaped).join("|")})$`);
  const labels = await composer(page)
    .getByRole("button", { name: pattern })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  return labels.map((label) => label.replace(pattern, ""));
}

/** The rendered callouts of the reading view, in document order. */
function calloutOrder(page: Page): Promise<string[]> {
  return page
    .locator("[data-callout]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-callout") ?? ""));
}

function editAction(page: Page): Locator {
  return page.getByRole("button", { name: ui("common.edit") });
}

function saveAction(page: Page): Locator {
  return page.getByRole("button", { name: ui("common.save"), exact: true });
}

// --- a: the composer IS edit mode -------------------------------------------

test("the edit action opens the block composer — one card per block, no textarea", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);
  await expect(page.locator("[data-callout='readaloud']")).toHaveCount(1);

  await editAction(page).click();

  // The DEFAULT surface is the block list — there is no textarea in the text
  // editor at all, and the preview (which belongs to the markdown mode) is not
  // offered.
  await expect(composer(page)).toBeVisible();
  await expect(textEditor(page).locator("textarea")).toHaveCount(0);
  await expect(rawTextarea(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: ui("editor.preview") })).toHaveCount(0);
  const modes = page.getByRole("group", { name: ui("composer.mode.aria") });
  await expect(
    modes.getByRole("button", { name: ui("composer.mode.blocks"), exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    modes.getByRole("button", { name: ui("composer.mode.markdown"), exact: true }),
  ).toHaveAttribute("aria-pressed", "false");

  // One card per block of the body, in document order, labelled with the same
  // vocabulary the reading view uses.
  expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
  // A "+" before, between and after them: six blocks, seven slots.
  const [, insertSuffix] = around("composer.insert.aria", "position");
  await expect(
    composer(page).getByRole("button", { name: new RegExp(`${escaped(insertSuffix)}$`) }),
  ).toHaveCount(7);

  // Collapsed cards show their own text, unrendered — the structure view, not
  // a second renderer: no callout boxes while the composer runs.
  await expect(page.locator("[data-callout]")).toHaveCount(0);
  await expect(composer(page)).toContainText(TOWER_LINE);
  await expect(composer(page)).toContainText("Wisdom (Perception) DC 13");
  await expect(composer(page)).toContainText("Flow");
  // The header keeps standing around it (as in the markdown mode): title, status control.
  await expect(
    page.getByRole("button", {
      name: ui("status.change.aria", { current: ui("status.scene.ready") }),
    }),
  ).toBeVisible();

  // Nothing typed, so nothing to save — and nothing stored moved.
  await expect(saveAction(page)).toBeDisabled();
  expect(await split(api, SCENE)).toEqual(before);
});

// --- b: the round trip is a no-op -------------------------------------------

test("blocks → markdown → blocks is not a change — the save stays disabled", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);
  await editAction(page).click();
  const save = saveAction(page);
  await expect(save).toBeDisabled();

  // Blocks → markdown: the serialized block list, byte-identical to the stored
  // body — the round-trip invariant, seen from outside the app.
  await page.getByRole("button", { name: ui("composer.mode.markdown"), exact: true }).click();
  await expect(composer(page)).toHaveCount(0);
  await expect(rawTextarea(page)).toHaveValue(before.body);
  await expect(save).toBeDisabled();
  // The preview exists only here — the composer's cards already show content.
  await expect(page.getByRole("button", { name: ui("editor.preview") })).toBeVisible();

  // Markdown → blocks: the same cards again, all collapsed, still nothing to save.
  await page.getByRole("button", { name: ui("composer.mode.blocks"), exact: true }).click();
  await expect(rawTextarea(page)).toHaveCount(0);
  await expect(textEditor(page).locator("textarea")).toHaveCount(0);
  expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
  await expect(save).toBeDisabled();

  // One draft, two surfaces: the detour cannot have written anything.
  expect(await split(api, SCENE)).toEqual(before);
});

// --- c: editing one block -----------------------------------------------------

test("editing a read-aloud card writes THAT block and nothing else", async ({ page, api }) => {
  const before = await split(api, SCENE);
  const added = "A tarnished brass whistle lies in the sand at the foot of the stairs.";

  await page.goto(SCENE_URL);
  await editAction(page).click();

  const readaloud = card(page, block(LABEL.readaloud, 3));
  await readaloud.edit.click();
  await expect(readaloud.collapse).toHaveAttribute("aria-expanded", "true");

  // The form holds the callout's TEXT: no `>` markers, no `[!readaloud]` — the
  // markers are the serializer's business (that is the point of the composer).
  const field = contentField(page, LABEL.readaloud);
  await expect(field).toHaveValue(new RegExp(`^${escaped(TOWER_LINE)}`));
  await expect(field).not.toHaveValue(/\[!readaloud\]/);
  await expect(field).not.toHaveValue(/>/);
  const text = await field.inputValue();
  await field.fill(`${text}\n${added}`);

  const save = saveAction(page);
  await expect(save).toBeEnabled();
  await save.click();

  // The editor closes and the sentence is INSIDE the readaloud callout — not a
  // paragraph of its own next to it.
  await expect(composer(page)).toHaveCount(0);
  const callout = page.locator("[data-callout='readaloud']");
  await expect(callout).toContainText(TOWER_LINE);
  await expect(callout).toContainText(added);

  // Stored: the readaloud block gained ONE quoted line, and that is the whole
  // diff — asserted as the full body, so a reflowed neighbour would fail here.
  await expect.poll(() => bodyOf(api, SCENE)).toContain(added);
  const after = await split(api, SCENE);
  expect(after.fields).toEqual(before.fields);
  const readaloudBefore = blockOf(before.body, "> [!readaloud]");
  expect(after.body).toBe(
    before.body.replace(`${readaloudBefore}\n`, `${readaloudBefore}\n> ${added}\n`),
  );
  // Spelled out for the blocks that must not have moved a byte.
  for (const head of ["## Flow", "Die Gruppe erreicht", "> [!check]", "> [!secret]", "> [!note]"]) {
    expect(blockOf(after.body, head), head).toBe(blockOf(before.body, head));
  }
});

// --- d: creating a block ------------------------------------------------------

test("the + slot at the end creates a loot block through the type picker", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const lootText = "Two bales of smuggled tobacco and a bill of lading without a sender.";

  await page.goto(SCENE_URL);
  await editAction(page).click();

  // The slot AFTER the last of the six blocks.
  await page
    .getByRole("button", { name: ui("composer.insert.aria", { position: 7 }), exact: true })
    .click();

  // Nine types on screen at once — the six callouts of the renderer, then the
  // two plain blocks, then the section.
  for (const label of [
    LABEL.readaloud,
    LABEL.check,
    LABEL.secret,
    LABEL.outcome,
    LABEL.loot,
    LABEL.note,
    LABEL.heading,
    LABEL.text,
    LABEL.ifSection,
  ]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: ui("composer.picker.cancel.aria") })).toBeVisible();

  await page.getByRole("button", { name: LABEL.loot, exact: true }).click();

  // A fresh block opens in its form right away — an empty card would otherwise
  // need a second click before anything can be typed.
  expect(await blockNames(page)).toEqual([...SCENE_BLOCKS, block(LABEL.loot, 7)]);
  const field = contentField(page, LABEL.loot);
  await expect(field).toHaveValue("");
  await field.fill(lootText);
  await saveAction(page).click();

  // Rendered as the loot callout, with the label the reading view gives it.
  await expect(composer(page)).toHaveCount(0);
  const loot = page.locator("[data-callout='loot']");
  await expect(loot).toContainText(LABEL.loot);
  await expect(loot).toContainText(lootText);

  // Stored: the markers the DM never typed, one blank line of separation, and
  // the body's single trailing newline — everything before it untouched.
  await expect.poll(() => bodyOf(api, SCENE)).toContain("[!loot]");
  const after = await split(api, SCENE);
  expect(after.body).toBe(`${before.body}\n> [!loot] ${lootText}\n`);
});

// --- e: moving blocks ---------------------------------------------------------

test("⌄/⌃ reorder the blocks — the scene follows, both blocks verbatim", async ({ page, api }) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);
  await editAction(page).click();

  // The ends of the list are dead — leaving it would mean leaving the body's
  // top level (or entering an If-section), which a move never does.
  await expect(card(page, block(LABEL.heading, 1)).up).toBeDisabled();
  await expect(card(page, block(LABEL.note, 6)).down).toBeDisabled();

  // Check ⇄ secret, from the check card's ⌄.
  await card(page, block(LABEL.check, 4)).down.click();
  expect(await blockNames(page)).toEqual([
    block(LABEL.heading, 1),
    block(LABEL.text, 2),
    block(LABEL.readaloud, 3),
    block(LABEL.secret, 4),
    block(LABEL.check, 5),
    block(LABEL.note, 6),
  ]);
  await saveAction(page).click();

  // The reading view renders them in the new order …
  await expect(composer(page)).toHaveCount(0);
  expect(await calloutOrder(page)).toEqual(["readaloud", "secret", "check", "note"]);

  // … and in the stored body the two blocks swapped places without either being
  // re-rendered: the separator between them stayed where it was, too.
  const check = blockOf(before.body, "> [!check]");
  const secret = blockOf(before.body, "> [!secret]");
  const after = await split(api, SCENE);
  expect(after.fields).toEqual(before.fields);
  expect(after.body).toBe(before.body.replace(`${check}\n\n${secret}`, `${secret}\n\n${check}`));
  expect(blockOf(after.body, "> [!check]")).toBe(check);
  expect(blockOf(after.body, "> [!secret]")).toBe(secret);
});

// --- f: inside an If-section --------------------------------------------------

test("a child of the first If-section edits without touching the two headings", async ({
  page,
  api,
}) => {
  const before = await split(api, IF_SCENE);
  const added = "Fenn posts a bored guard at the door.";

  await page.goto(IF_SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Von den Schmugglern erwischt",
  );
  await editAction(page).click();

  // Two levels: the body's blocks, and each section's children indented
  // below it — counting from 1 again, because a move stays inside its list.
  expect(await blockNames(page)).toEqual([
    block(LABEL.heading, 1),
    block(LABEL.text, 2),
    block(LABEL.ifSection, 3),
    block(LABEL.text, 1),
    block(LABEL.text, 2),
    block(LABEL.note, 3),
    block(LABEL.ifSection, 4),
    block(LABEL.check, 1),
    block(LABEL.text, 2),
    block(LABEL.outcome, 3),
  ]);

  // The section card itself carries the CONDITION, not the `## If:` markup.
  const section = card(page, block(LABEL.ifSection, 3));
  await section.edit.click();
  await expect(
    page.getByRole("textbox", { name: ui("composer.ifSection.condition.aria"), exact: true }),
  ).toHaveValue(FIRST_CONDITION);
  await section.collapse.click();

  // The first text card is the first child of the first section — its paragraph.
  const child = card(page, block(LABEL.text, 1));
  await child.edit.click();
  const field = contentField(page, LABEL.text);
  await expect(field).toHaveValue(/^Fenn lässt sie in die alte Räucherkammer sperren/);
  await field.fill(`${await field.inputValue()}\n${added}`);
  await saveAction(page).click();

  // The reading view puts it inside the first collapsible section (open by
  // default), above the section's own note callout.
  await expect(composer(page)).toHaveCount(0);
  const first = page.locator("details").first();
  await expect(first).toHaveAttribute("data-if-section", FIRST_CONDITION);
  await expect(first.locator("summary")).toContainText(ui("markdown.ifSection.prefix"));
  await expect(first).toContainText(added);
  // Still the section's FIRST paragraph, not a new block after the list.
  await expect(first.getByRole("paragraph").first()).toContainText(added);

  // Stored: BOTH `## If:` heading lines byte-identical (the section keeps its
  // own source when only a child changes), and the child is the only diff.
  await expect.poll(() => bodyOf(api, IF_SCENE)).toContain(added);
  const after = await split(api, IF_SCENE);
  expect(after.fields).toEqual(before.fields);
  expect(blockOf(after.body, "## If: sie geben zu")).toBe(`## If: ${FIRST_CONDITION}`);
  expect(blockOf(after.body, "## If: sie lügen")).toBe(
    blockOf(before.body, "## If: sie lügen"),
  );
  const paragraph = blockOf(before.body, "Fenn lässt sie in die alte");
  expect(after.body).toBe(before.body.replace(paragraph, `${paragraph}\n${added}`));
  // The section's other children, spelled out.
  for (const head of ["- die morschen Bretter", "> [!note]", "> [!check]", "> [!outcome]"]) {
    expect(blockOf(after.body, head), head).toBe(blockOf(before.body, head));
  }
});

// --- the one thing a save must refuse ----------------------------------------

test("a ## heading typed into an If-child blocks the save until it is cleared", async ({
  page,
  api,
}) => {
  const before = await split(api, IF_SCENE);
  const paragraph = blockOf(before.body, "Fenn lässt sie in die alte");

  await page.goto(IF_SCENE_URL);
  await editAction(page).click();

  // The first text card is the first child of the first section. A `##` line
  // in its markdown would END the section on the next parse — the child and
  // every block below it would leave the branch, while the composer still
  // shows them nested. Two typed characters, a whole branch moved: hence the
  // refusal.
  const child = card(page, block(LABEL.text, 1));
  await child.edit.click();
  const field = contentField(page, LABEL.text);
  await field.fill(`${await field.inputValue()}\n## Boom`);

  // The offending CARD says what is wrong (never corrected away — `##` may be
  // exactly what was meant), and the editor's line says why the button is dead.
  const hint = page.getByText(ui("composer.issue.sectionEscape"));
  await expect(hint).toBeVisible();
  await expect(hint).toHaveCount(1);
  await expect(page.getByText(ui("bodyEditor.blocked"))).toBeVisible();
  const save = saveAction(page);
  await expect(save).toBeDisabled();
  // The draft is allowed to be in this state, the STORED body is not.
  expect(await split(api, IF_SCENE)).toEqual(before);

  // One level deeper and the heading stays inside the branch: the hint goes,
  // the line goes, the save works.
  await field.fill(`${paragraph}\n### Boom`);
  await expect(page.getByText(ui("composer.issue.sectionEscape"))).toHaveCount(0);
  await expect(page.getByText(ui("bodyEditor.blocked"))).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();

  // Stored: the new heading sits between the two `## If:` lines, i.e. INSIDE
  // the first section — which is what the composer showed all along.
  await expect(composer(page)).toHaveCount(0);
  await expect.poll(() => bodyOf(api, IF_SCENE)).toContain("### Boom");
  const after = await split(api, IF_SCENE);
  expect(after.fields).toEqual(before.fields);
  expect(after.body).toBe(before.body.replace(paragraph, `${paragraph}\n### Boom`));
  expect(after.body.indexOf("### Boom")).toBeGreaterThan(
    after.body.indexOf("## If: sie geben zu"),
  );
  expect(after.body.indexOf("### Boom")).toBeLessThan(after.body.indexOf("## If: sie lügen"));
  // Both section headings untouched, as in every other save here.
  for (const head of ["## If: sie geben zu", "## If: sie lügen", "> [!note]"]) {
    expect(blockOf(after.body, head), head).toBe(blockOf(before.body, head));
  }
  // And the reading view keeps it in the first collapsible section.
  const first = page.locator("details").first();
  await expect(first).toHaveAttribute("data-if-section", FIRST_CONDITION);
  await expect(first.getByRole("heading", { level: 3 })).toHaveText("Boom");
});

// --- g: the conflict, from the composer --------------------------------------

test("409 with a block form open: the message, the form and the typed text stay", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const mine = "Typed into the block form while the scene moved underneath.";
  // Same fields, different body — only the row's guard token moves, and
  // that is what the server compares against.
  const externalBody = "\n## Flow\n\nChanged by a second writer.\n";

  await page.goto(SCENE_URL);
  await editAction(page).click();

  const note = card(page, block(LABEL.note, 6));
  await note.edit.click();
  const field = contentField(page, LABEL.note);
  const original = await field.inputValue();

  // A SECOND WRITER moves the row under the open composer, through the same
  // API with a fresh token. No race to win: the editor holds the token it was
  // seeded from until a conflict tells it otherwise.
  await patchScene(api, SCENE, { body: externalBody });
  await field.fill(`${original}\n${mine}`);
  await saveAction(page).click();

  // Refused, and said so — the conflict line, with both answers.
  const conflictLine = page.getByRole("alert").filter({ hasText: ui("editConflict.line") });
  await expect(conflictLine).toBeVisible();
  // The composer stays, the card stays OPEN and the typed text survives.
  await expect(composer(page)).toBeVisible();
  await expect(note.collapse).toHaveAttribute("aria-expanded", "true");
  await expect(field).toHaveValue(`${original}\n${mine}`);
  expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
  // Nothing was written: the other writer's content stands, untouched.
  expect(await split(api, SCENE)).toEqual({ fields: before.fields, body: externalBody });

  // Forcing writes the draft on top of the row as it stands — deliberately on
  // top of the external body: the DM saw the line and decided.
  await conflictLine.getByRole("button", { name: ui("editConflict.force") }).click();
  await expect(composer(page)).toHaveCount(0);
  await expect(conflictLine).toHaveCount(0);
  await expect(page.locator("[data-callout='note']")).toContainText(mine);

  await expect.poll(() => bodyOf(api, SCENE)).toContain(mine);
  const after = await split(api, SCENE);
  expect(after.fields).toEqual(before.fields);
  const noteBefore = blockOf(before.body, "> [!note]");
  expect(after.body).toBe(before.body.replace(`${noteBefore}\n`, `${noteBefore}\n> ${mine}\n`));
  expect(after.body).not.toContain("Changed by a second writer");
});

// --- h: the discard guard -----------------------------------------------------

test("cancelling after a block edit asks first — discarding leaves the scene alone", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const unsaved = "A sentence that is never saved.";

  await page.goto(SCENE_URL);
  await editAction(page).click();

  const paragraph = card(page, block(LABEL.text, 2));
  await paragraph.edit.click();
  const field = contentField(page, LABEL.text);
  await field.fill(`${await field.inputValue()}\n${unsaved}`);

  // It asks — and keeping on editing keeps both the draft and the open form.
  await page.getByRole("button", { name: ui("common.cancel"), exact: true }).click();
  const dialog = page.getByRole("dialog", { name: ui("bodyEditor.discard.title") });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(field).toHaveValue(new RegExp(escaped(unsaved)));

  // Discarding closes the editor; the reading view is as it was.
  await page.getByRole("button", { name: ui("common.cancel"), exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: ui("common.discard") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator("[data-callout='readaloud']")).toContainText(TOWER_LINE);
  await expect(page.getByRole("article")).not.toContainText(unsaved);
  // Nothing was written.
  expect(await split(api, SCENE)).toEqual(before);
});

// --- j: the format degrades ---------------------------------------------------

/**
 * A scene with two constructs the composer does not model: an UNKNOWN callout
 * kind and a markdown table. Seeded as a scene of its own and written out
 * here verbatim, because the assertions are about these exact bytes.
 */
const ODD_SCENE: SceneProposal = {
  id: "strange-mechanism",
  title: "Strange Mechanism",
  type: "planned",
  chapter: "01-salzhafen",
  location: "leuchtturm",
  npcs: [],
  handouts: [],
  tags: ["test"],
  status: "draft",
  body: `
## Flow

The group rolls on the table below.

> [!weird] blah

| Roll | Result          |
| ---- | --------------- |
| 1-3  | Gulls           |
| 4-6  | an empty barrel |
`,
};

test.describe("with a scene of unknown constructs", () => {
  test.use({ seed: { scenes: [ODD_SCENE] } });

  test("unknown callouts and tables become cards — and survive a neighbour's save", async ({
    page,
    api,
  }) => {
    const rel = ODD_SCENE.id;
    const before = await split(api, rel);
    const lead = "The group rolls on the table below.";
    const added = "On a tie the group rolls again.";

    await page.goto(`/campaigns/beispiel/scenes/${rel}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ODD_SCENE.title);
    await editAction(page).click();

    // No error, no validation: the unknown callout is a markdown block (with
    // its kind spelled out next to the label) and the table is a text card.
    expect(await blockNames(page)).toEqual([
      block(LABEL.heading, 1),
      block(LABEL.text, 2),
      block(LABEL.markdown, 3),
      block(LABEL.text, 4),
    ]);
    await expect(composer(page)).toContainText("[!weird]");
    await expect(composer(page)).toContainText("| Roll | Result");

    // The raw card keeps its markers IN the form — it is handed over verbatim.
    const raw = card(page, block(LABEL.markdown, 3));
    await raw.edit.click();
    await expect(contentField(page, LABEL.markdown)).toHaveValue("> [!weird] blah");
    await raw.collapse.click();

    // Now edit the NEIGHBOUR and save.
    const paragraph = card(page, block(LABEL.text, 2));
    await paragraph.edit.click();
    const field = contentField(page, LABEL.text);
    await expect(field).toHaveValue(lead);
    await field.fill(`${await field.inputValue()}\n${added}`);
    await saveAction(page).click();

    // The reading view degrades exactly as before: the unknown kind stays a
    // plain blockquote, and the table stays literal text (the pipeline has no
    // remark-gfm — which is exactly why those bytes must survive verbatim).
    await expect(composer(page)).toHaveCount(0);
    await expect(page.locator("[data-callout]")).toHaveCount(0);
    await expect(page.locator("blockquote")).toContainText("[!weird] blah");
    await expect(page.getByRole("article")).toContainText("an empty barrel");
    await expect(page.getByRole("article")).toContainText(added);

    // Stored: both unmodelled constructs byte-identical, one paragraph longer.
    await expect.poll(() => bodyOf(api, rel)).toContain(added);
    const after = await split(api, rel);
    expect(after.fields).toEqual(before.fields);
    expect(blockOf(after.body, "> [!weird]")).toBe("> [!weird] blah");
    expect(blockOf(after.body, "| Roll")).toBe(blockOf(before.body, "| Roll"));
    expect(after.body).toBe(before.body.replace(lead, `${lead}\n${added}`));
  });
});

// --- i: the phone -------------------------------------------------------------
//
// Critical path 8 as well: the composer exists BECAUSE editing a scene on a
// phone with a markdown textarea is not editing. So the whole cycle has to
// work at 390px — and nothing may scroll the page sideways, cards, controls
// and open form included.

test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the composer opens, edits and saves at phone size", async ({ page, api }) => {
    const before = await split(api, SCENE);
    const added = "Jorna raises the lantern as she recognises the group.";

    await page.goto(SCENE_URL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);
    await editAction(page).click();

    expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Reordering is buttons, never drag & drop, so it works by touch: down
    // and back up, which leaves the draft where it was.
    const save = saveAction(page);
    await card(page, block(LABEL.text, 2)).down.click();
    expect(await blockNames(page)).toEqual([
      block(LABEL.heading, 1),
      block(LABEL.readaloud, 2),
      block(LABEL.text, 3),
      block(LABEL.check, 4),
      block(LABEL.secret, 5),
      block(LABEL.note, 6),
    ]);
    await card(page, block(LABEL.text, 3)).up.click();
    expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
    await expect(save).toBeDisabled();

    // Open a card, type into its form.
    const paragraph = card(page, block(LABEL.text, 2));
    await paragraph.edit.click();
    const field = contentField(page, LABEL.text);
    await expect(field).toBeVisible();
    await field.fill(`${await field.inputValue()}\n${added}`);
    // The open form is the widest thing in the list — still no sideways scroll.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await save.click();
    await expect(composer(page)).toHaveCount(0);
    await expect(page.getByRole("article")).toContainText(added);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    const after = await split(api, SCENE);
    expect(after.fields).toEqual(before.fields);
    const paragraphBefore = blockOf(before.body, "Die Gruppe erreicht");
    expect(after.body).toBe(
      before.body.replace(paragraphBefore, `${paragraphBefore}\n${added}`),
    );
  });
});

/** How much the page could be scrolled sideways — must stay at zero. */
function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
