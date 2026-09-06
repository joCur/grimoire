// Critical path 7: the frontmatter patch from the app, here through the
// „Eigenschaften" form of issue #42 — one dialog per entity kind over ALL
// typed fields, including the 409 conflict. It also touches path 2 (the
// reading view must show the new values the moment the dialog closes) and
// path 8 (the form has to be usable at 390px). See CLAUDE.md.
//
// The sibling spec on this path is tests/status-control.e2e.ts: the status
// regler patches ONE key, this form patches any of them. Two things make the
// form the harder case and are what this spec is about:
//
//   1. It is a PATCH, not a write of the file. Only the keys the DM actually
//      changed may travel — a key the form does not know (a hand-edited
//      `x-custom`), a key it knows but the DM did not touch, and the whole
//      markdown body have to come out of a save untouched.
//   2. The conflict is DETERMINISTIC here, unlike the status regler: the
//      dialog freezes the mtime it opened with on purpose, so the ~5s version
//      poll cannot heal the staleness while the DM types. No retry loop.
//   3. Everything the save uses is frozen at open, so the dialog belongs to
//      ONE path: a navigation under the open modal (⌘K works over it) has to
//      close it, or the next save writes file A's diff into file B. And what
//      is typed does not vanish without a question — neither on Esc nor in an
//      unfinished quickstat row.
//
// Every assertion reads the file back through the API — what the UI shows and
// what the database holds are checked separately. Since the cutover (issue
// #57) there is no file behind it: „extern geändert" now means a SECOND
// WRITER through the same API, which is what bumps the row's guard token.
//
// One caveat the assertions live with: PATCH /frontmatter re-emits the whole
// YAML block, so the SURFACE formatting of untouched keys may normalize
// (`handouts: ["Karte"]` -> `[Karte]`, `statblock: "Roll20: Jorna"` ->
// `'Roll20: Jorna'`) — documented in server/src/campaign-write.ts. The VALUES
// never move, so this spec asserts values, plus one plain-scalar key
// (`x-custom: bleibt`) that does survive byte-identically.

import type { Locator, Page } from "@playwright/test";

import { expect, test, type Api } from "../support/test";

const SCENE = "01-salzhafen/hafen/lighthouse-arrival.md";
const SCENE_URL = `/beispiel/file/${SCENE}`;
const NPC = "npcs/jorna.md";
const STALE_MESSAGE = "Inzwischen geändert — neu laden";

/**
 * The frontmatter block including both fences and the newline after the
 * closing one, and the body behind it — the two halves every assertion here
 * looks at separately.
 */
async function split(api: Api, rel: string) {
  const raw = await api.raw(rel);
  const match = /^---\n[\s\S]*?\n---\n/.exec(raw);
  expect(match, "the fixture file has no frontmatter block").not.toBeNull();
  const frontmatter = match?.[0] ?? "";
  return { raw, frontmatter, body: raw.slice(frontmatter.length) };
}

/**
 * The resolved-name line under a reference input. Pinned down by ROLE and an
 * anchored text, not by text alone: the field's own <datalist> carries the
 * same name as an <option>, and the chapter field right above resolves to a
 * title that CONTAINS the location's name.
 */
function referenceHint(dialog: Locator, name: string) {
  return dialog
    .getByRole("paragraph")
    .filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
}

/** Open the header's „Eigenschaften" and hand back the dialog. */
async function openProperties(page: Page) {
  await page.getByRole("button", { name: "Eigenschaften" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test("scene properties: chips, reference and status land in the file — nothing else moves", async ({
  page,
  api,
}) => {
  const pristine = await split(api, SCENE);
  // A key the form does not know, written BEFORE the dialog opens: the patch
  // must not carry it, so it has to come out of the save verbatim. (A patch is
  // the only way to put it there now — nobody hand-edits a row.)
  await api.patchFrontmatter(SCENE, { "x-custom": "bleibt" });

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // The header action row: the body editor, this form, the rename — in that
  // order (issue #42 put „Eigenschaften" between the two existing ones).
  const headerActions = page
    .getByRole("article")
    .getByRole("button")
    .filter({ hasText: /^(Bearbeiten|Eigenschaften|Umbenennen)$/ });
  await expect(headerActions).toHaveText(["Bearbeiten", "Eigenschaften", "Umbenennen"]);

  const dialog = await openProperties(page);
  await expect(dialog).toContainText("Szene: Eigenschaften");
  // The two values the form does NOT own are context, not fields: the id
  // belongs to „Umbenennen" (with its cascade), the kind comes from the path.
  await expect(dialog).toContainText("lighthouse-arrival");
  await expect(dialog).toContainText('über „Umbenennen" ändern');
  await expect(dialog.getByLabel("Titel")).toHaveValue("Ankunft am Leuchtturm");
  await expect(dialog.getByLabel("Status")).toHaveValue("ready");

  // A reference field is a text input with suggestions, and it says what the
  // id it holds resolves to.
  const location = dialog.getByLabel("Ort");
  await expect(location).toHaveValue("leuchtturm");
  await expect(referenceHint(dialog, "Der Leuchtturm von Salzhafen")).toBeVisible();
  // Its suggestions SUGGEST, they do not close the field: the ids that have a
  // file, offered through a native <datalist>. (No role reaches a datalist
  // option, so this is the one place the spec uses the DOM id the field
  // builds for its list.)
  const suggestions = dialog.locator("#fm-location-options option");
  await expect(suggestions).toHaveCount(1);
  await expect(suggestions).toHaveAttribute("value", "leuchtturm");
  // A reference CHIP names its entity next to the raw id.
  const npcChip = dialog.getByRole("listitem").filter({ hasText: "jorna" });
  await expect(npcChip).toContainText("Hafenmeisterin Jorna");

  // Nothing changed yet, so there is nothing to save.
  const save = dialog.getByRole("button", { name: "Speichern" });
  await expect(save).toBeDisabled();

  // Enter turns the typed text into a chip …
  const tags = dialog.getByLabel("Tags");
  await tags.fill("stealth");
  await tags.press("Enter");
  await expect(tags).toHaveValue("");
  await expect(dialog.getByRole("button", { name: "stealth entfernen" })).toBeVisible();
  // … and text still STANDING in the input is folded in by the save instead
  // of being lost with the closing dialog.
  await tags.fill("nachtszene");

  // An unknown id stays typeable, and the hint says what saving will do:
  // since issue #70 the write CREATES the entry, so a typo is visible as a
  // new entry called that instead of a silent nothing.
  await location.fill("bucht");
  await expect(referenceHint(dialog, "Neu — wird beim Speichern angelegt.")).toBeVisible();
  await expect(referenceHint(dialog, "Der Leuchtturm von Salzhafen")).toHaveCount(0);

  // A CHAPTER is the one reference that is NOT created by naming it (ADR #14 —
  // the server answers 400), so the hint must not promise it. Typed and taken
  // back, so the save below stays the one this spec is about.
  const chapter = dialog.getByLabel("Kapitel");
  await chapter.fill("99-nirgendwo");
  await expect(referenceHint(dialog, "Unbekannt — Kapitel muss existieren.")).toBeVisible();
  await chapter.fill("01-salzhafen");

  await dialog.getByLabel("Status").selectOption("draft");
  await expect(save).toBeEnabled();
  await save.click();

  // The dialog closes and the reading view is already on the new values: the
  // patch answers with the written file and the mutation seeds it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const article = page.getByRole("article");
  await expect(article).toContainText("#stealth");
  await expect(article).toContainText("#nachtszene");
  await expect(article.getByText("bucht", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Entwurf" })).toBeVisible();

  // On disk: the three changed keys …
  await expect.poll(() => api.raw(SCENE)).toContain("status: draft");
  const after = await split(api, SCENE);
  expect(after.frontmatter).toContain("tags: [social, travel, stealth, nachtszene]");
  expect(after.frontmatter).toContain("location: bucht");
  // …and the referenced Ort now has its own (empty) entry — issue #70.
  expect(await api.exists("locations/bucht.md")).toBe(true);
  expect(after.frontmatter).toContain("status: draft");
  // … the untouched ones with their values, the unknown one byte-identically …
  expect(after.frontmatter).toContain("x-custom: bleibt");
  expect(after.frontmatter).toContain("id: lighthouse-arrival");
  expect(after.frontmatter).toContain("title: Ankunft am Leuchtturm\n");
  expect(after.frontmatter).toContain("type: planned");
  expect(after.frontmatter).toContain("chapter: 01-salzhafen");
  expect(after.frontmatter).toContain("npcs: [jorna]");
  expect(after.frontmatter).toContain("Karte von Salzhafen");
  // … and the body untouched, byte for byte.
  expect(after.body).toBe(pristine.body);
});

test("a second writer: the save reports the conflict, the second click writes", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  // The external editor changed the title AND the body while the dialog was
  // open — both have to survive the DM's save, because neither is in the patch.
  const externalTitle = "Ankunft am Leuchtturm (von Hand)";
  const externalBody = "\n## Flow\n\nVon einem zweiten Schreiber geändert.\n";

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  const dialog = await openProperties(page);

  const tags = dialog.getByLabel("Tags");
  await tags.fill("konflikt");
  await tags.press("Enter");
  await expect(dialog.getByRole("button", { name: "konflikt entfernen" })).toBeVisible();

  // A second writer changes title AND body under the open dialog, through the
  // same API with a FRESH token. No race to win: the dialog holds the token it
  // opened with until a conflict tells it otherwise, so the version poll
  // cannot make this write succeed silently.
  await api.patchFrontmatter(SCENE, { title: externalTitle });
  await api.writeBody(SCENE, externalBody);

  const save = dialog.getByRole("button", { name: "Speichern" });
  await save.click();

  // Refused, and said so — quietly, in the dialog's own message line.
  await expect(dialog.getByText(STALE_MESSAGE)).toBeVisible();
  // The dialog stays open and the typed chip survives — that is the point.
  await expect(dialog.getByRole("button", { name: "konflikt entfernen" })).toBeVisible();
  await expect(dialog.getByLabel("Titel")).toHaveValue("Ankunft am Leuchtturm");
  // Nothing was written: the external content stands, untouched.
  const conflicted = await split(api, SCENE);
  expect(conflicted.frontmatter).not.toContain("konflikt");
  expect(conflicted.frontmatter).toContain(`title: ${externalTitle}`);
  expect(conflicted.body).toBe(externalBody);

  // The dialog re-read the file, so the SAME click works now — and it is a
  // PATCH: only the DM's key travels, so the external title and the external
  // body are still there afterwards.
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(dialog.getByText(STALE_MESSAGE)).toHaveCount(0);

  await expect.poll(() => api.raw(SCENE)).toContain("konflikt");
  const after = await split(api, SCENE);
  expect(after.frontmatter).toContain("tags: [social, travel, konflikt]");
  expect(after.frontmatter).toContain(`title: ${externalTitle}`);
  expect(after.body).toBe(externalBody);
  // And the reading view shows the file as it now is — external title
  // included, since the patch response is the whole file.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(externalTitle);
  await expect(page.getByRole("article")).toContainText("#konflikt");
});

test("clearing a field deletes the key instead of writing an empty value", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  expect(before.frontmatter).toContain("location: leuchtturm");
  expect(before.frontmatter).toContain("handouts:");

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  const dialog = await openProperties(page);

  // The X of a chip removes it — the last one empties the list …
  const chip = dialog.getByRole("button", { name: "Karte von Salzhafen entfernen" });
  await chip.click();
  await expect(chip).toHaveCount(0);
  // … and an emptied input clears its field.
  await dialog.getByLabel("Ort").fill("");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  // The chip row keeps standing (the tags are still there), the two cleared
  // values are gone from it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const article = page.getByRole("article");
  await expect(article).toContainText("#social");
  await expect(article).not.toContainText("Handout:");
  await expect(article.getByText("Der Leuchtturm von Salzhafen", { exact: true })).toHaveCount(0);

  // On disk both keys are GONE, not emptied: no `location:` and no
  // `handouts: []` left behind. (The dialog closes only after the write
  // answered, so the file is settled here.)
  const after = await split(api, SCENE);
  expect(after.frontmatter).not.toMatch(/^location:/m);
  expect(after.frontmatter).not.toMatch(/^handouts:/m);
  // Everything else stands, the body byte-identical.
  expect(after.frontmatter).toContain("tags: [social, travel]");
  expect(after.frontmatter).toContain("status: ready");
  expect(after.frontmatter).toContain("npcs: [jorna]");
  expect(after.body).toBe(before.body);
});

test("NPC properties: role, status and a quickstat round-trip into the header", async ({
  page,
  api,
}) => {
  const before = await split(api, NPC);
  const role = "Auftraggeberin, seit dem Herbst auch im Rat";

  await page.goto(`/beispiel/file/${NPC}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");

  const dialog = await openProperties(page);
  await expect(dialog).toContainText("NPC: Eigenschaften");
  await expect(dialog).toContainText("jorna");
  // The NPC form has its own field list — the scene's keys are not in it.
  await expect(dialog.getByLabel("Tags")).toHaveCount(0);
  await expect(dialog.getByLabel("Rolle")).toHaveValue(
    "Auftraggeberin, Hafenmeisterin von Salzhafen",
  );

  await dialog.getByLabel("Rolle").fill(role);
  await dialog.getByLabel("Status").selectOption("missing");
  // Quickstats are free key/value rows — jorna has two, this is the third.
  const save = dialog.getByRole("button", { name: "Speichern" });
  await dialog.getByRole("button", { name: "Zeile hinzufügen" }).click();
  const statName = dialog.getByLabel("Quickstats, Zeile 3: Name");
  const statValue = dialog.getByLabel("Quickstats, Zeile 3: Wert");
  // A row that cannot be written blocks the save and says why — silently
  // dropping it (a value with no name) or silently swallowing the first of two
  // rows with the SAME name would both lose what the DM typed.
  await statValue.fill("+1");
  await expect(dialog).toContainText("Zeile ohne Namen");
  await expect(save).toBeDisabled();
  await statName.fill("insight");
  await expect(dialog).toContainText('Name „insight" doppelt');
  await expect(save).toBeDisabled();
  await statName.fill("deception");
  await expect(dialog).not.toContainText("Zeile ohne Namen");
  // Enter in a quickstat cell is NOT the form's submit: the dialog would save
  // and close in the middle of typing the next stat.
  await statName.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Rolle")).toHaveValue(role);
  await expect(save).toBeEnabled();
  await save.click();

  // The NPC header carries all three.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const article = page.getByRole("article");
  await expect(article).toContainText(role);
  await expect(article).toContainText("vermisst");
  await expect(article).toContainText("deception +1");
  // Untouched header values stand.
  await expect(article).toContainText("knapp, wetterrau, duzt jeden");
  await expect(article).toContainText("Statblock: Roll20: Jorna");

  await expect.poll(() => api.raw(NPC)).toContain("status: missing");
  const after = await split(api, NPC);
  expect(after.frontmatter).toContain(`role: ${role}`);
  // A DM-typed „+1" stays the STRING it was typed as (YAML would read it as
  // 1); the numbers already in the file stay numbers.
  expect(after.frontmatter).toContain(
    "quickstats: {insight: 2, passive-perception: 12, deception: '+1'}",
  );
  expect(after.frontmatter).toContain("id: jorna");
  expect(after.frontmatter).toContain("name: Hafenmeisterin Jorna");
  expect(after.frontmatter).toContain("voice: knapp, wetterrau, duzt jeden");
  expect(after.body).toBe(before.body);
});

test("Abbrechen and Esc ask before they throw typed values away", async ({ page, api }) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // Nothing typed, nothing to lose: „Abbrechen" is immediate.
  let dialog = await openProperties(page);
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // With something typed, Esc asks first — and „Weiter bearbeiten" keeps it.
  dialog = await openProperties(page);
  const title = dialog.getByLabel("Titel");
  await title.fill("Ankunft am Leuchtturm, nie gespeichert");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("dialog").filter({ hasText: "Änderungen verwerfen?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(title).toHaveValue("Ankunft am Leuchtturm, nie gespeichert");

  // „Abbrechen" asks the same question, and „Verwerfen" closes everything.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The reading view is as it was, and nothing reached the disk.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  expect(await api.raw(SCENE)).toBe(before.raw);
});

test("navigating away closes the dialog — no diff of file A lands in file B", async ({
  page,
  api,
}) => {
  const scene = await split(api, SCENE);
  const role = "Auftraggeberin, nach der ⌘K-Navigation gespeichert";

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // Type into the SCENE's form, then leave the file WITHOUT closing it: the
  // ⌘K hotkey is a window listener, so the palette opens over the modal and
  // navigates the route underneath it — this is a click path, not a theory.
  const sceneDialog = await openProperties(page);
  await sceneDialog.getByLabel("Titel").fill("Titel, der nie geschrieben werden darf");
  await page.keyboard.press("ControlOrMeta+KeyK");
  const search = page.getByPlaceholder("Szenen, NPCs, Orte durchsuchen …");
  await expect(search).toBeFocused();
  await search.fill("Hafenmeisterin");
  await page.getByRole("option").filter({ hasText: "Hafenmeisterin Jorna" }).first().click();
  await expect(page).toHaveURL(/\/beispiel\/file\/npcs\/jorna\.md$/);

  // The dialog is gone with its file — it may not stand over another file's
  // reading view, holding the frozen values (and the mtime) of the one it left.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // And the NPC's own dialog opens fresh: its fields, no carried-over diff.
  const npcDialog = await openProperties(page);
  await expect(npcDialog).toContainText("NPC: Eigenschaften");
  await expect(npcDialog.getByLabel("Titel")).toHaveCount(0);
  // Anchored: the quickstat rows carry a „…: Name" label as well.
  await expect(npcDialog.getByLabel(/^Name/)).toHaveValue("Hafenmeisterin Jorna");
  await expect(npcDialog.getByRole("button", { name: "Speichern" })).toBeDisabled();

  // A save from here writes THIS file only.
  await npcDialog.getByLabel("Rolle").fill(role);
  await npcDialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(() => api.raw(NPC)).toContain(`role: ${role}`);
  expect(await api.raw(SCENE)).toBe(scene.raw);
});

test("Ort and Kapitel have the form too — campaign file, session and inbox do not", async ({
  page,
}) => {
  // The four kinds with typed frontmatter offer it …
  const withForm: [string, string, string][] = [
    ["01-salzhafen/hafen/smuggler-captured.md", "Von den Schmugglern erwischt", "Szene"],
    ["npcs/fenn.md", "Fenn", "NPC"],
    ["locations/leuchtturm.md", "Der Leuchtturm von Salzhafen", "Ort"],
    ["01-salzhafen/_chapter.md", "Kapitel 1: Der Leuchtturm von Salzhafen", "Kapitel"],
  ];
  for (const [rel, heading, kindLabel] of withForm) {
    await page.goto(`/beispiel/file/${rel}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    const dialog = await openProperties(page);
    await expect(dialog).toContainText(`${kindLabel}: Eigenschaften`);
    // Clean exit — nothing changed, nothing written.
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // … the app-managed and append-only files do not (ADR #4), and neither does
  // the glossary, which has no typed frontmatter to offer. Asserted only after
  // the content is on screen, so this cannot pass on a still-loading page.
  const withoutForm: [string, string][] = [
    ["sessions/2026-01-15.md", "Spuren gefunden"],
    ["inbox.md", "Der Dorfschmied repariert"],
    ["glossary.md", "Übersetzungs-Glossar"],
  ];
  for (const [rel, marker] of withoutForm) {
    await page.goto(`/beispiel/file/${rel}`);
    await expect(page.getByRole("article")).toContainText(marker);
    await expect(page.getByRole("button", { name: "Eigenschaften" })).toHaveCount(0);
  }

  // The campaign file keeps its ONE dialog (issue #34): its name/description
  // ARE its frontmatter, so a second form next to it would be two ways to
  // write the same two keys.
  await page.goto("/beispiel/file/_campaign.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );
  await expect(page.getByRole("button", { name: "Eigenschaften" })).toHaveCount(0);
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(page.getByRole("dialog")).toContainText("Kampagne bearbeiten");
});

// Critical path 8: the same form at phone size. The dialog is the only place
// in the reading view where the DM types more than one field, so it has to
// work here — the header action row wraps to a second line for it (issue #42).
test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the properties dialog opens, edits and saves at phone size", async ({ page, api }) => {
    const before = await split(api, SCENE);
    const title = "Ankunft am Leuchtturm bei Nacht";

    await page.goto(SCENE_URL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

    const dialog = await openProperties(page);
    await expect(dialog).toContainText("Szene: Eigenschaften");
    // Nothing may scroll the page sideways while the dialog stands.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const titleInput = dialog.getByLabel("Titel");
    await titleInput.fill(title);
    await dialog.getByRole("button", { name: "Speichern" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    await expect.poll(() => api.raw(SCENE)).toContain(`title: ${title}`);
    const after = await split(api, SCENE);
    expect(after.frontmatter).toContain("status: ready");
    expect(after.body).toBe(before.body);
  });
});
