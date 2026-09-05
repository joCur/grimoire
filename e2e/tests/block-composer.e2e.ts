// Critical path 9, second spec: the BLOCK COMPOSER (issue #43) — since that
// slice „Bearbeiten" no longer opens a wall of markdown but the scene as a list
// of typed cards, and the raw textarea of issue #39 is one click away as the
// fallback („Roh"). `tests/file-edit.e2e.ts` owns that fallback and the whole
// save/409/discard machinery seen from it; this spec owns the composer.
//
// What has to hold, and why every test below reads the file back through the API:
//
//   * OPENING AND CLOSING A FILE MUST NOT COST A BYTE. The composer parses the
//     body and serializes it again, so the round trip is the one thing that
//     could quietly reformat a hand-written scene. „Speichern" stays disabled
//     after a Blöcke → Roh → Blöcke detour, and every save is asserted as
//     „this one block's bytes changed, all the others did not" — never as a
//     `toContain` on the new text, which would pass on a reflowed file too.
//   * THE FORMAT DEGRADES (README). An unknown callout and a markdown table are
//     not modelled by the composer; they must show up as cards, survive a save
//     of a NEIGHBOURING block byte for byte, and never raise an error.
//   * NOTHING NEW IN THE LOSS DEPARTMENT. A 409 in „Blöcke" keeps the draft AND
//     the open form, „Abbrechen" asks before it throws work away, and the
//     phone-sized layout (the whole point of the ticket) can do all of it.
//
// Block cards are addressed through their controls' accessible names —
// „Vorlesetext 3 bearbeiten", „Check 4 nach unten" — because that is the only
// place where a card's TYPE and its POSITION are both visible from outside, and
// asserting them is asserting the vocabulary of the reading view (blockLabel:
// Vorlesetext, Check, Geheim, Konsequenz, Beute, Notiz, Falls-Abschnitt,
// Überschrift, Text, Roh-Block). `exact: true` everywhere: „Text 3 bearbeiten"
// is a substring of „Vorlesetext 3 bearbeiten".

import type { Locator, Page } from "@playwright/test";

import { expect, test, type Api } from "../support/test";

/** Six blocks, one per type the reading view knows — the composer's reference. */
const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";
const SCENE_URL = `/beispiel/file/${SCENE}`;
/** The reference scene WITH two `## If:` sections and their children. */
const IF_SCENE = "01-salzhafen/hafen/smuggler-captured.md";
const IF_SCENE_URL = `/beispiel/file/${IF_SCENE}`;
const STALE_MESSAGE = "Inzwischen geändert — neu laden";

/** The cards of SCENE, in document order, as the composer names them. */
const SCENE_BLOCKS = [
  "Überschrift 1",
  "Text 2",
  "Vorlesetext 3",
  "Check 4",
  "Geheim 5",
  "Notiz 6",
];

/**
 * The frontmatter block including both fences and the newline after the
 * closing one — what PUT /file promises to leave alone.
 */
function frontmatterBlock(raw: string): string {
  const match = /^---\n[\s\S]*?\n---\n/.exec(raw);
  expect(match, "the fixture file has no frontmatter block").not.toBeNull();
  return match?.[0] ?? "";
}

/** Read the file and hand back its frontmatter block and the rest. */
async function split(api: Api, rel: string) {
  const raw = await api.raw(rel);
  const frontmatter = frontmatterBlock(raw);
  return { raw, frontmatter, body: raw.slice(frontmatter.length) };
}

/**
 * The verbatim markdown of ONE block of a file: the run of lines that starts
 * with the first line beginning with `head`, up to (not including) the next
 * blank line. „Byte-identical" in the assertions below means exactly this
 * string — which also catches a re-wrapped paragraph, not just a lost one.
 */
function blockOf(raw: string, head: string): string {
  const lines = raw.split("\n");
  const from = lines.findIndex((line) => line.startsWith(head));
  expect(from, `no block starting with ${JSON.stringify(head)}`).toBeGreaterThanOrEqual(0);
  let to = from;
  while (to + 1 < lines.length && (lines[to + 1] ?? "").trim() !== "") to += 1;
  return lines.slice(from, to + 1).join("\n");
}

/** The composer's region — present exactly while „Blöcke" is the surface. */
function composer(page: Page): Locator {
  return page.getByRole("region", { name: /^Blöcke: / });
}

/** The raw textarea of „Roh" (FileBodyEditor labels it with the file's path). */
function rawTextarea(page: Page): Locator {
  return page.getByRole("textbox", { name: /^Markdown-Text der Datei/ });
}

/** The four controls of one card, addressed by its name („Vorlesetext 3"). */
function card(page: Page, name: string) {
  const button = (suffix: string) =>
    page.getByRole("button", { name: `${name} ${suffix}`, exact: true });
  return {
    /** ✎ — opens the typed form. Only present while the card is collapsed. */
    edit: button("bearbeiten"),
    /** The same button with the form open. */
    collapse: button("zuklappen"),
    up: button("nach oben"),
    down: button("nach unten"),
    remove: button("löschen"),
  };
}

/**
 * The cards on screen in DOM order, named as the UI names them. An If-section's
 * children follow their section and count from 1 again, so the returned list
 * shows the nesting as well.
 */
async function blockNames(page: Page): Promise<string[]> {
  const labels = await composer(page)
    .getByRole("button", { name: /(bearbeiten|zuklappen)$/ })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  return labels.map((label) => label.replace(/ (bearbeiten|zuklappen)$/, ""));
}

/** The rendered callouts of the reading view, in document order. */
function calloutOrder(page: Page): Promise<string[]> {
  return page
    .locator("[data-callout]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-callout") ?? ""));
}

// --- a: the composer IS edit mode -------------------------------------------

test("Bearbeiten opens the block composer — one card per block, no textarea", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(page.locator("[data-callout='readaloud']")).toHaveCount(1);

  await page.getByRole("button", { name: "Bearbeiten" }).click();

  // The DEFAULT surface is the block list — there is no textarea on the page
  // at all, and „Vorschau" (which belongs to „Roh") is not offered.
  await expect(composer(page)).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(rawTextarea(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Vorschau" })).toHaveCount(0);
  const modes = page.getByRole("group", { name: "Editiermodus" });
  await expect(modes.getByRole("button", { name: "Blöcke", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(modes.getByRole("button", { name: "Roh", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // One card per block of the file, in document order, labelled with the same
  // vocabulary the reading view uses.
  expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
  // A „+" before, between and after them: six blocks, seven slots.
  await expect(composer(page).getByRole("button", { name: /einfügen$/ })).toHaveCount(7);

  // Collapsed cards show their own text, unrendered — the structure view, not
  // a second renderer: no callout boxes while the composer runs.
  await expect(page.locator("[data-callout]")).toHaveCount(0);
  await expect(composer(page)).toContainText("Der Turm ragt schwarz gegen den Abendhimmel auf.");
  await expect(composer(page)).toContainText("Wisdom (Perception) DC 13");
  await expect(composer(page)).toContainText("Flow");
  // The header keeps standing around it (as in „Roh"): title, status regler.
  await expect(page.getByRole("button", { name: "Status ändern, aktuell bereit" })).toBeVisible();

  // Nothing typed, so nothing to save — and nothing stored moved.
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  expect(await api.raw(SCENE)).toBe(before.raw);
});

// --- b: the round trip is a no-op -------------------------------------------

test("Blöcke → Roh → Blöcke is not a change — Speichern stays disabled", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const save = page.getByRole("button", { name: "Speichern" });
  await expect(save).toBeDisabled();

  // Blöcke → Roh: the serialized block list, byte-identical to the body on
  // disk. This is the phase-1 invariant seen from outside the app.
  await page.getByRole("button", { name: "Roh", exact: true }).click();
  await expect(composer(page)).toHaveCount(0);
  await expect(rawTextarea(page)).toHaveValue(before.body);
  await expect(save).toBeDisabled();
  // „Vorschau" exists only here — the composer's cards already show content.
  await expect(page.getByRole("button", { name: "Vorschau" })).toBeVisible();

  // Roh → Blöcke: the same cards again, all collapsed, still nothing to save.
  await page.getByRole("button", { name: "Blöcke", exact: true }).click();
  await expect(rawTextarea(page)).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
  await expect(save).toBeDisabled();

  // One draft, two surfaces: the detour cannot have written anything.
  expect(await api.raw(SCENE)).toBe(before.raw);
});

// --- c: editing one block -----------------------------------------------------

test("editing a Vorlesetext card writes THAT block and nothing else", async ({ page, api }) => {
  const before = await split(api, SCENE);
  const added = "Eine angelaufene Messingpfeife liegt im Sand am Fuß der Treppe.";

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();

  const readaloud = card(page, "Vorlesetext 3");
  await readaloud.edit.click();
  await expect(readaloud.collapse).toHaveAttribute("aria-expanded", "true");

  // The form holds the callout's TEXT: no `>` markers, no `[!readaloud]` — the
  // markers are the serializer's business (that is the point of the composer).
  const field = page.getByRole("textbox", { name: "Inhalt: Vorlesetext", exact: true });
  await expect(field).toHaveValue(/^Der Turm ragt schwarz gegen den Abendhimmel auf\./);
  await expect(field).not.toHaveValue(/\[!readaloud\]/);
  await expect(field).not.toHaveValue(/>/);
  const text = await field.inputValue();
  await field.fill(`${text}\n${added}`);

  const save = page.getByRole("button", { name: "Speichern" });
  await expect(save).toBeEnabled();
  await save.click();

  // The editor closes and the sentence is INSIDE the readaloud callout — not a
  // paragraph of its own next to it.
  await expect(composer(page)).toHaveCount(0);
  const callout = page.locator("[data-callout='readaloud']");
  await expect(callout).toContainText("Der Turm ragt schwarz gegen den Abendhimmel auf.");
  await expect(callout).toContainText(added);

  // On disk: the readaloud block gained ONE quoted line, and that is the whole
  // diff — asserted as the full file, so a reflowed neighbour would fail here.
  await expect.poll(() => api.raw(SCENE)).toContain(added);
  const after = await split(api, SCENE);
  expect(after.frontmatter).toBe(before.frontmatter);
  const readaloudBefore = blockOf(before.raw, "> [!readaloud]");
  expect(after.raw).toBe(
    before.raw.replace(`${readaloudBefore}\n`, `${readaloudBefore}\n> ${added}\n`),
  );
  // Spelled out for the blocks that must not have moved a byte.
  for (const head of ["## Flow", "Die Gruppe erreicht", "> [!check]", "> [!secret]", "> [!note]"]) {
    expect(blockOf(after.raw, head), head).toBe(blockOf(before.raw, head));
  }
});

// --- d: creating a block ------------------------------------------------------

test("the + slot at the end creates a Beute block through the type picker", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const lootText = "Zwei Ballen Schmuggeltabak und ein Frachtbrief ohne Absender.";

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();

  // The slot AFTER the last of the six blocks.
  await page.getByRole("button", { name: "Block an Position 7 einfügen", exact: true }).click();

  // Nine types on screen at once — the six callouts of the renderer, then the
  // two plain blocks, then the section.
  for (const label of [
    "Vorlesetext",
    "Check",
    "Geheim",
    "Konsequenz",
    "Beute",
    "Notiz",
    "Überschrift",
    "Text",
    "Falls-Abschnitt",
  ]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Einfügen abbrechen" })).toBeVisible();

  await page.getByRole("button", { name: "Beute", exact: true }).click();

  // A fresh block opens in its form right away — an empty card would otherwise
  // need a second click before anything can be typed.
  expect(await blockNames(page)).toEqual([...SCENE_BLOCKS, "Beute 7"]);
  const field = page.getByRole("textbox", { name: "Inhalt: Beute", exact: true });
  await expect(field).toHaveValue("");
  await field.fill(lootText);
  await page.getByRole("button", { name: "Speichern" }).click();

  // Rendered as the Beute callout, with the label the reading view gives it.
  await expect(composer(page)).toHaveCount(0);
  const loot = page.locator("[data-callout='loot']");
  await expect(loot).toContainText("Beute");
  await expect(loot).toContainText(lootText);

  // On disk: the markers the DM never typed, one blank line of separation, and
  // the file's single trailing newline — everything before it untouched.
  await expect.poll(() => api.raw(SCENE)).toContain("[!loot]");
  const after = await split(api, SCENE);
  expect(after.raw).toBe(`${before.raw}\n> [!loot] ${lootText}\n`);
});

// --- e: moving blocks ---------------------------------------------------------

test("⌄/⌃ reorder the blocks — the file follows, both blocks verbatim", async ({ page, api }) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();

  // The ends of the list are dead — leaving it would mean leaving the document
  // (or entering an If-section), which this slice does not do.
  await expect(card(page, "Überschrift 1").up).toBeDisabled();
  await expect(card(page, "Notiz 6").down).toBeDisabled();

  // Check ⇄ Geheim, from the Check card's ⌄.
  await card(page, "Check 4").down.click();
  expect(await blockNames(page)).toEqual([
    "Überschrift 1",
    "Text 2",
    "Vorlesetext 3",
    "Geheim 4",
    "Check 5",
    "Notiz 6",
  ]);
  await page.getByRole("button", { name: "Speichern" }).click();

  // The reading view renders them in the new order …
  await expect(composer(page)).toHaveCount(0);
  expect(await calloutOrder(page)).toEqual(["readaloud", "secret", "check", "note"]);

  // … and in the stored file the two blocks swapped places without either being
  // re-rendered: the separator between them stayed where it was, too.
  const check = blockOf(before.raw, "> [!check]");
  const secret = blockOf(before.raw, "> [!secret]");
  const after = await split(api, SCENE);
  expect(after.frontmatter).toBe(before.frontmatter);
  expect(after.raw).toBe(before.raw.replace(`${check}\n\n${secret}`, `${secret}\n\n${check}`));
  expect(blockOf(after.raw, "> [!check]")).toBe(check);
  expect(blockOf(after.raw, "> [!secret]")).toBe(secret);
});

// --- f: inside an If-section --------------------------------------------------

test("a child of the first If-section edits without touching the two headings", async ({
  page,
  api,
}) => {
  const before = await split(api, IF_SCENE);
  const added = "Fenn stellt einen gelangweilten Posten vor die Tür.";

  await page.goto(IF_SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Von den Schmugglern erwischt",
  );
  await page.getByRole("button", { name: "Bearbeiten" }).click();

  // Two levels: the document's blocks, and each section's children indented
  // below it — counting from 1 again, because a move stays inside its list.
  expect(await blockNames(page)).toEqual([
    "Überschrift 1",
    "Text 2",
    "Falls-Abschnitt 3",
    "Text 1",
    "Text 2",
    "Notiz 3",
    "Falls-Abschnitt 4",
    "Check 1",
    "Text 2",
    "Konsequenz 3",
  ]);

  // The section card itself carries the CONDITION, not the `## If:` markup.
  const section = card(page, "Falls-Abschnitt 3");
  await section.edit.click();
  await expect(
    page.getByRole("textbox", { name: "Bedingung des Falls-Abschnitts", exact: true }),
  ).toHaveValue("sie geben zu, für Jorna zu arbeiten");
  await section.collapse.click();

  // „Text 1" is the first child of the first section — its paragraph.
  const child = card(page, "Text 1");
  await child.edit.click();
  const field = page.getByRole("textbox", { name: "Inhalt: Text", exact: true });
  await expect(field).toHaveValue(/^Fenn lässt sie in die alte Räucherkammer sperren/);
  await field.fill(`${await field.inputValue()}\n${added}`);
  await page.getByRole("button", { name: "Speichern" }).click();

  // The reading view puts it inside the first collapsible section (open by
  // default), above the section's own Notiz callout.
  await expect(composer(page)).toHaveCount(0);
  const first = page.locator("details").first();
  await expect(first).toHaveAttribute("data-if-section", "sie geben zu, für Jorna zu arbeiten");
  await expect(first.locator("summary")).toContainText("Falls:");
  await expect(first).toContainText(added);
  // Still the section's FIRST paragraph, not a new block after the list.
  await expect(first.getByRole("paragraph").first()).toContainText(added);

  // On disk: BOTH `## If:` heading lines byte-identical (the section keeps its
  // own source when only a child changes), and the child is the only diff.
  await expect.poll(() => api.raw(IF_SCENE)).toContain(added);
  const after = await split(api, IF_SCENE);
  expect(after.frontmatter).toBe(before.frontmatter);
  expect(blockOf(after.raw, "## If: sie geben zu")).toBe("## If: sie geben zu, für Jorna zu arbeiten");
  expect(blockOf(after.raw, "## If: sie lügen")).toBe(
    blockOf(before.raw, "## If: sie lügen"),
  );
  const paragraph = blockOf(before.raw, "Fenn lässt sie in die alte");
  expect(after.raw).toBe(before.raw.replace(paragraph, `${paragraph}\n${added}`));
  // The section's other children, spelled out.
  for (const head of ["- die morschen Bretter", "> [!note]", "> [!check]", "> [!outcome]"]) {
    expect(blockOf(after.raw, head), head).toBe(blockOf(before.raw, head));
  }
});

// --- the one thing a save must refuse ----------------------------------------

test("a ## heading typed into an If-child blocks the save until it is cleared", async ({
  page,
  api,
}) => {
  const before = await split(api, IF_SCENE);
  const paragraph = blockOf(before.raw, "Fenn lässt sie in die alte");

  await page.goto(IF_SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();

  // „Text 1" is the first child of the first section. A `##` line in its
  // markdown would END the section on the next parse — the child and every
  // block below it would leave the branch, while the composer still shows them
  // nested. Two typed characters, a whole branch moved: hence the refusal.
  const child = card(page, "Text 1");
  await child.edit.click();
  const field = page.getByRole("textbox", { name: "Inhalt: Text", exact: true });
  await field.fill(`${await field.inputValue()}\n## Boom`);

  // The offending CARD says what is wrong (never corrected away — `##` may be
  // exactly what was meant), and the editor's line says why the button is dead.
  const hint = page.getByText(/beendet den Falls-Abschnitt/);
  await expect(hint).toBeVisible();
  await expect(hint).toHaveCount(1);
  await expect(page.getByText("Ein Block muss noch geklärt werden")).toBeVisible();
  const save = page.getByRole("button", { name: "Speichern" });
  await expect(save).toBeDisabled();
  // The draft is allowed to be in this state, the FILE is not.
  expect(await api.raw(IF_SCENE)).toBe(before.raw);

  // One character deeper and the heading stays inside the branch: the hint
  // goes, the note goes, the save works.
  await field.fill(`${paragraph}\n### Boom`);
  await expect(page.getByText(/beendet den Falls-Abschnitt/)).toHaveCount(0);
  await expect(page.getByText("Ein Block muss noch geklärt werden")).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();

  // On disk: the new heading sits between the two `## If:` lines, i.e. INSIDE
  // the first section — which is what the composer showed all along.
  await expect(composer(page)).toHaveCount(0);
  await expect.poll(() => api.raw(IF_SCENE)).toContain("### Boom");
  const after = await split(api, IF_SCENE);
  expect(after.frontmatter).toBe(before.frontmatter);
  expect(after.raw).toBe(before.raw.replace(paragraph, `${paragraph}\n### Boom`));
  expect(after.raw.indexOf("### Boom")).toBeGreaterThan(
    after.raw.indexOf("## If: sie geben zu"),
  );
  expect(after.raw.indexOf("### Boom")).toBeLessThan(after.raw.indexOf("## If: sie lügen"));
  // Both section headings untouched, as in every other save here.
  for (const head of ["## If: sie geben zu", "## If: sie lügen", "> [!note]"]) {
    expect(blockOf(after.raw, head), head).toBe(blockOf(before.raw, head));
  }
  // And the reading view keeps it in the first collapsible section.
  const first = page.locator("details").first();
  await expect(first).toHaveAttribute("data-if-section", "sie geben zu, für Jorna zu arbeiten");
  await expect(first.getByRole("heading", { level: 3 })).toHaveText("Boom");
});

// --- g: the conflict, from the composer --------------------------------------

test("409 with a block form open: the message, the form and the typed text stay", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const mine = "Im Blockformular getippt, während die Datei sich bewegte.";
  // Same frontmatter, different body — only the row's guard token moves, and
  // that is what the server compares against.
  const externalBody = "\n## Flow\n\nVon einem zweiten Schreiber geändert.\n";

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();

  const note = card(page, "Notiz 6");
  await note.edit.click();
  const field = page.getByRole("textbox", { name: "Inhalt: Notiz", exact: true });
  const original = await field.inputValue();

  // A SECOND WRITER moves the row under the open composer, through the same
  // API with a fresh token. No race to win: the editor holds the token it was
  // seeded from until a conflict tells it otherwise.
  await api.writeBody(SCENE, externalBody);
  await field.fill(`${original}\n${mine}`);
  await page.getByRole("button", { name: "Speichern" }).click();

  // Refused, and said so — quietly, in the editor's own message line.
  await expect(page.getByText(STALE_MESSAGE)).toBeVisible();
  // The composer stays, the card stays OPEN and the typed text survives.
  await expect(composer(page)).toBeVisible();
  await expect(note.collapse).toHaveAttribute("aria-expanded", "true");
  await expect(field).toHaveValue(`${original}\n${mine}`);
  expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
  // Nothing was written: the other writer's content stands, untouched.
  expect(await api.raw(SCENE)).toBe(`${before.frontmatter}${externalBody}`);

  // The editor re-read the file, so the SAME click works now — deliberately on
  // top of the external body: the DM saw the message and decided.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(composer(page)).toHaveCount(0);
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
  await expect(page.locator("[data-callout='note']")).toContainText(mine);

  await expect.poll(() => api.raw(SCENE)).toContain(mine);
  const after = await split(api, SCENE);
  expect(after.frontmatter).toBe(before.frontmatter);
  const noteBefore = blockOf(before.raw, "> [!note]");
  expect(after.raw).toBe(before.raw.replace(`${noteBefore}\n`, `${noteBefore}\n> ${mine}\n`));
  expect(after.raw).not.toContain("Von einem zweiten Schreiber");
});

// --- h: the discard guard -----------------------------------------------------

test("Abbrechen after a block edit asks first — Verwerfen leaves the file alone", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();

  const paragraph = card(page, "Text 2");
  await paragraph.edit.click();
  const field = page.getByRole("textbox", { name: "Inhalt: Text", exact: true });
  await field.fill(`${await field.inputValue()}\nEin Satz, der nie gespeichert wird.`);

  // It asks — and „Weiter bearbeiten" keeps both the draft and the open form.
  await page.getByRole("button", { name: "Abbrechen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Änderungen verwerfen?");
  await dialog.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(field).toHaveValue(/Ein Satz, der nie gespeichert wird\./);

  // „Verwerfen" closes the editor; the reading view is as it was.
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(composer(page)).toHaveCount(0);
  await expect(page.locator("[data-callout='readaloud']")).toContainText(
    "Der Turm ragt schwarz gegen den Abendhimmel auf.",
  );
  await expect(page.getByRole("article")).not.toContainText("nie gespeichert wird");
  // Nothing reached the disk.
  expect(await api.raw(SCENE)).toBe(before.raw);
});

// --- j: the format degrades ---------------------------------------------------

/**
 * A scene with two constructs the composer does not model: an UNKNOWN callout
 * kind and a markdown table. Seeded into the markdown tree this test's
 * database is imported from (examples/ must not be touched — CLAUDE.md), and
 * written out here verbatim because the assertions are about these exact
 * bytes.
 */
/** Its path segment is the scene's ID, like every scene path since #57. */
const ODD_SCENE_PATH = "01-salzhafen/hafen/seltsame-mechanik.md";

const ODD_SCENE = `---
id: seltsame-mechanik
title: Seltsame Mechanik
type: planned
chapter: 01-salzhafen
location: leuchtturm
npcs: []
handouts: []
tags: [test]
status: draft
---

## Flow

Die Gruppe würfelt auf der Tabelle unten.

> [!weird] bla

| Wurf | Ergebnis        |
| ---- | --------------- |
| 1-3  | Möwen           |
| 4-6  | ein leeres Fass |
`;

test.describe("with a scene of unknown constructs", () => {
  test.use({ seed: { files: { [ODD_SCENE_PATH]: ODD_SCENE } } });

  test("unknown callouts and tables become cards — and survive a neighbour's save", async ({
    page,
    api,
  }) => {
    const rel = ODD_SCENE_PATH;
    const before = await split(api, rel);
    const added = "Bei einem Patt würfelt die Gruppe erneut.";

    await page.goto(`/beispiel/file/${rel}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Seltsame Mechanik");
    await page.getByRole("button", { name: "Bearbeiten" }).click();

    // No error, no validation: the unknown callout is a „Roh-Block" (with its
    // kind spelled out next to the label) and the table is a „Text" card.
    expect(await blockNames(page)).toEqual([
      "Überschrift 1",
      "Text 2",
      "Roh-Block 3",
      "Text 4",
    ]);
    await expect(composer(page)).toContainText("[!weird]");
    await expect(composer(page)).toContainText("| Wurf | Ergebnis");

    // The raw card keeps its markers IN the form — it is handed over verbatim.
    const raw = card(page, "Roh-Block 3");
    await raw.edit.click();
    await expect(page.getByRole("textbox", { name: "Inhalt: Roh-Block", exact: true })).toHaveValue(
      "> [!weird] bla",
    );
    await raw.collapse.click();

    // Now edit the NEIGHBOUR and save.
    const paragraph = card(page, "Text 2");
    await paragraph.edit.click();
    const field = page.getByRole("textbox", { name: "Inhalt: Text", exact: true });
    await expect(field).toHaveValue("Die Gruppe würfelt auf der Tabelle unten.");
    await field.fill(`${await field.inputValue()}\n${added}`);
    await page.getByRole("button", { name: "Speichern" }).click();

    // The reading view degrades exactly as before: the unknown kind stays a
    // plain blockquote, and the table stays literal text (the pipeline has no
    // remark-gfm — which is exactly why those bytes must survive verbatim).
    await expect(composer(page)).toHaveCount(0);
    await expect(page.locator("[data-callout]")).toHaveCount(0);
    await expect(page.locator("blockquote")).toContainText("[!weird] bla");
    await expect(page.getByRole("article")).toContainText("ein leeres Fass");
    await expect(page.getByRole("article")).toContainText(added);

    // On disk: both unmodelled constructs byte-identical, one paragraph longer.
    await expect.poll(() => api.raw(rel)).toContain(added);
    const after = await split(api, rel);
    expect(after.frontmatter).toBe(before.frontmatter);
    expect(blockOf(after.raw, "> [!weird]")).toBe("> [!weird] bla");
    expect(blockOf(after.raw, "| Wurf")).toBe(blockOf(before.raw, "| Wurf"));
    expect(after.raw).toBe(
      before.raw.replace(
        "Die Gruppe würfelt auf der Tabelle unten.",
        `Die Gruppe würfelt auf der Tabelle unten.\n${added}`,
      ),
    );
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
    const added = "Jorna hebt die Laterne, als sie die Gruppe erkennt.";

    await page.goto(SCENE_URL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
    await page.getByRole("button", { name: "Bearbeiten" }).click();

    expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    // Reordering is buttons, never drag & drop (AK 4 of the ticket), so it
    // works by touch: down and back up, which leaves the draft where it was.
    const save = page.getByRole("button", { name: "Speichern" });
    await card(page, "Text 2").down.click();
    expect(await blockNames(page)).toEqual([
      "Überschrift 1",
      "Vorlesetext 2",
      "Text 3",
      "Check 4",
      "Geheim 5",
      "Notiz 6",
    ]);
    await card(page, "Text 3").up.click();
    expect(await blockNames(page)).toEqual(SCENE_BLOCKS);
    await expect(save).toBeDisabled();

    // Open a card, type into its form.
    const paragraph = card(page, "Text 2");
    await paragraph.edit.click();
    const field = page.getByRole("textbox", { name: "Inhalt: Text", exact: true });
    await expect(field).toBeVisible();
    await field.fill(`${await field.inputValue()}\n${added}`);
    // The open form is the widest thing in the list — still no sideways scroll.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await save.click();
    await expect(composer(page)).toHaveCount(0);
    await expect(page.getByRole("article")).toContainText(added);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    const after = await split(api, SCENE);
    expect(after.frontmatter).toBe(before.frontmatter);
    const paragraphBefore = blockOf(before.raw, "Die Gruppe erreicht");
    expect(after.raw).toBe(
      before.raw.replace(paragraphBefore, `${paragraphBefore}\n${added}`),
    );
  });
});

/** How much the page could be scrolled sideways — must stay at zero. */
function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
