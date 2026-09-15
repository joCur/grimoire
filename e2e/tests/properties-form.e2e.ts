// Critical path 7: the properties patch from the app, here through the
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
//      dialog freezes the rev it opened with on purpose, so the ~5s version
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
// One caveat the assertions live with: PATCH /properties re-emits the whole
// YAML block, so the SURFACE formatting of untouched keys may normalize
// (`handouts: ["Karte"]` -> `[Karte]`, `statblock: "Roll20: Jorna"` ->
// `'Roll20: Jorna'`) — documented in server/src/campaign-write.ts. The VALUES
// never move, so this spec asserts values, plus one plain-scalar key
// (`x-custom: bleibt`) that does survive byte-identically.

import type { Locator, Page } from "@playwright/test";

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Api } from "../support/test";
import { EXAMPLES_DIR } from "../support/paths";


// The reference scene with one key the schema has no field for — seeded
// through the importer, because that is the only way an unknown key gets
// into `extra` (the API refuses new ones).
const SCENE_FILE = "01-salzhafen/hafen/ankunft-leuchtturm";
const SCENE_WITH_CUSTOM = readFileSync(
  path.join(EXAMPLES_DIR, "beispiel", `${SCENE_FILE}.md`),
  "utf8",
).replace(/\n---\n/, "\nx-custom: bleibt\n---\n");
test.use({ seed: { files: { [SCENE_FILE]: SCENE_WITH_CUSTOM } } });

const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";
const SCENE_URL = `/beispiel/file/${SCENE}`;
const NPC = "npcs/jorna";
const STALE_MESSAGE = "Inzwischen geändert — neu laden";

/** Read the entry: its properties and its text — the two halves every assertion looks at. */
async function split(api: Api, rel: string) {
  const { properties, body } = await api.file(rel);
  return { properties, body };
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
  // A key the form does not know (`x-custom`, seeded through the importer —
  // the only way such a key gets in): the patch must not carry it, so it has
  // to come out of the save verbatim.
  expect(pristine.properties["x-custom"]).toBe("bleibt");

  // Entered from the pool, so there is a history entry BEHIND the scene —
  // the „zurück" assertion after the move below needs one.
  await page.goto("/beispiel");
  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // The header action row: the body editor and this form. „Umbenennen" is NOT
  // among them any more — issue #77 moved the id change into this dialog.
  const headerActions = page
    .getByRole("article")
    .getByRole("button")
    .filter({ hasText: /^(Bearbeiten|Eigenschaften|Umbenennen)$/ });
  await expect(headerActions).toHaveText(["Bearbeiten", "Eigenschaften"]);

  const dialog = await openProperties(page);
  await expect(dialog).toContainText("Szene: Eigenschaften");
  // The two values the form does NOT own are context, not fields: the id
  // belongs to the rename dialog (with its cascade), the kind comes from the
  // path — and the footer says where to change it (issue #77).
  await expect(dialog).toContainText("lighthouse-arrival");
  await expect(dialog).toContainText('unten über „id ändern"');
  await expect(dialog.getByRole("button", { name: "id ändern" })).toBeVisible();
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
  // Two since issue #100: `bucht` is a scene's location, so it is an entry.
  await expect(suggestions).toHaveCount(2);
  await expect(suggestions.first()).toHaveAttribute("value", "leuchtturm");
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
  await location.fill("nordbucht");
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
  await expect(article.getByText("nordbucht", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Entwurf" })).toBeVisible();
  // The location IS the group since issue #100, so the scene MOVED — and the
  // URL follows it (replace, so „zurück" does not return to the old address).
  await expect(page).toHaveURL(
    /\/beispiel\/file\/01-salzhafen\/nordbucht\/lighthouse-arrival$/,
  );
  // „Zurück" must not return to the address the scene just left: the redirect
  // REPLACES the history entry, so the step back is the page the DM came from
  // (the pool), never `…/leuchtturm/lighthouse-arrival` — which would reload,
  // redirect forward again and trap the button.
  await page.goBack();
  await expect(page).toHaveURL(/\/beispiel$/);
  await page.goForward();
  await expect(page).toHaveURL(
    /\/beispiel\/file\/01-salzhafen\/nordbucht\/lighthouse-arrival$/,
  );

  // The chapter overview re-sorts: a „nordbucht" section, no „leuchtturm" one.
  await page.goto("/beispiel");
  await expect(page.getByRole("heading", { level: 3, name: "nordbucht" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "Der Leuchtturm von Salzhafen" }),
  ).toHaveCount(0);
  // The old address still names the scene and reports the new one.
  expect((await api.file(SCENE)).path).toBe("01-salzhafen/nordbucht/lighthouse-arrival");
  // `[[…]]` references resolve over ids, so the session log is untouched.
  expect(await api.body("sessions/2026-01-15")).toContain("lighthouse-arrival");

  // Stored: the three changed fields …
  await expect.poll(() => api.properties(SCENE)).toHaveProperty("status", "draft");
  const after = await split(api, SCENE);
  expect(after.properties.tags).toEqual(["social", "travel", "stealth", "nachtszene"]);
  expect(after.properties.location).toBe("nordbucht");
  // …and the referenced Ort now has its own (empty) entry — issue #70.
  expect(await api.exists("locations/nordbucht")).toBe(true);
  expect(after.properties.status).toBe("draft");
  // … the untouched ones with their values, the unknown one included …
  expect(after.properties["x-custom"]).toBe("bleibt");
  expect(after.properties.id).toBe("lighthouse-arrival");
  expect(after.properties.title).toBe("Ankunft am Leuchtturm");
  expect(after.properties.type).toBe("planned");
  expect(after.properties.chapter).toBe("01-salzhafen");
  expect(after.properties.npcs).toEqual(["jorna"]);
  expect(after.properties.handouts).toEqual(["Karte von Salzhafen"]);
  // … and the body untouched, byte for byte.
  expect(after.body).toBe(pristine.body);
});

test('free text in the Ort field creates the Ort under the typed NAME (#100)', async ({
  page,
  api,
}) => {
  // The group a scene sits under IS its `location`, and the column holds an
  // id — but that is the app's problem, not the DM's. The form used to refuse
  // free text („Keine Orts-id — „der-alte-hafen" verwenden.") and disable
  // Speichern; it now slugs what was typed and sends the text as the new
  // entry's NAME, in the same write.
  await page.goto(SCENE_URL);
  const dialog = await openProperties(page);
  const ort = dialog.getByLabel("Ort");
  const save = dialog.getByRole("button", { name: "Speichern" });

  // Typing the NAME of an existing Ort resolves to that Ort — the save would
  // land on the entry that is already there, so nothing is promised.
  await ort.fill("Leuchtturm");
  await expect(referenceHint(dialog, "Der Leuchtturm von Salzhafen")).toBeVisible();

  // Text no slug can be derived from is the one thing that still blocks.
  await ort.fill("???");
  await expect(dialog.getByText('„???" ergibt keine Orts-id')).toBeVisible();
  await expect(save).toBeDisabled();

  // And a new name says what saving will do with it.
  await ort.fill("Der alte Hafen");
  await expect(
    referenceHint(dialog, 'Neu — wird als Ort „Der alte Hafen" angelegt.'),
  ).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The scene moved into the new group, and the slug is what the file holds.
  await expect(page).toHaveURL(
    /\/beispiel\/file\/01-salzhafen\/der-alte-hafen\/lighthouse-arrival$/,
  );
  await expect.poll(() => api.properties(SCENE)).toHaveProperty("location", "der-alte-hafen");

  // The Ort exists and is called what the DM typed — not by its own id.
  expect(await api.exists("locations/der-alte-hafen")).toBe(true);
  expect((await api.file("locations/der-alte-hafen")).properties.name).toBe("Der alte Hafen");

  // …and the chapter overview heads the group with that name.
  await page.goto("/beispiel");
  await expect(page.getByRole("heading", { level: 3, name: "Der alte Hafen" })).toBeVisible();
});

test('a rejected save shows the SERVER sentence, not the generic one (#100)', async ({
  page,
}) => {
  // The shared write layer answered every non-conflict rejection with its
  // caller's generic wording, so a 400 that names exactly what is wrong —
  // `location_not_an_id` with its suggestion, or this unknown chapter — was
  // invisible to the DM. An unknown CHAPTER is the reachable case: it is the
  // one reference the app deliberately does not block (ADR #14), because
  // only the server knows which chapters exist.
  await page.goto(SCENE_URL);
  const dialog = await openProperties(page);
  await dialog.getByLabel("Kapitel").fill("99-nirgendwo");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  // The server's own text, and the dialog stays open on the typed value.
  await expect(dialog.getByText("unknown chapter: 99-nirgendwo")).toBeVisible();
  await expect(dialog.getByText("Eigenschaften nicht gespeichert")).toHaveCount(0);
  await expect(dialog.getByLabel("Kapitel")).toHaveValue("99-nirgendwo");
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
  await api.patchProperties(SCENE, { title: externalTitle });
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
  expect(conflicted.properties.tags).not.toContain("konflikt");
  expect(conflicted.properties.title).toBe(externalTitle);
  expect(conflicted.body).toBe(externalBody);

  // The dialog re-read the file, so the SAME click works now — and it is a
  // PATCH: only the DM's key travels, so the external title and the external
  // body are still there afterwards.
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(dialog.getByText(STALE_MESSAGE)).toHaveCount(0);

  await expect.poll(async () => (await api.properties(SCENE)).tags).toContain("konflikt");
  const after = await split(api, SCENE);
  expect(after.properties.tags).toEqual(["social", "travel", "konflikt"]);
  expect(after.properties.title).toBe(externalTitle);
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
  expect(before.properties.location).toBe("leuchtturm");
  expect(before.properties.handouts).toBeDefined();

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
  expect(after.properties.location).toBeUndefined();
  expect(after.properties.handouts).toBeUndefined();
  // Everything else stands, the body byte-identical.
  expect(after.properties.tags).toEqual(["social", "travel"]);
  expect(after.properties.status).toBe("ready");
  expect(after.properties.npcs).toEqual(["jorna"]);
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
  // Kurzwerte are free key/value rows — jorna has two, this is the third.
  const save = dialog.getByRole("button", { name: "Speichern" });
  await dialog.getByRole("button", { name: "Zeile hinzufügen" }).click();
  const statName = dialog.getByLabel("Kurzwerte, Zeile 3: Name");
  const statValue = dialog.getByLabel("Kurzwerte, Zeile 3: Wert");
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
  await expect(article).toContainText("Vermisst");
  await expect(article).toContainText("deception +1");
  // Untouched header values stand.
  await expect(article).toContainText("knapp, wetterrau, duzt jeden");
  await expect(article).toContainText("Statblock: Roll20: Jorna");

  await expect.poll(() => api.properties(NPC)).toHaveProperty("status", "missing");
  const after = await split(api, NPC);
  expect(after.properties.role).toBe(role);
  // A DM-typed „+1" stays the STRING it was typed as; the numbers already
  // stored stay numbers.
  expect(after.properties.quickstats).toEqual({ insight: 2, "passive-perception": 12, deception: "+1" });
  expect(after.properties.id).toBe("jorna");
  expect(after.properties.name).toBe("Hafenmeisterin Jorna");
  expect(after.properties.voice).toBe("knapp, wetterrau, duzt jeden");
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
  expect(await split(api, SCENE)).toEqual(before);
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
  await expect(page).toHaveURL(/\/beispiel\/file\/npcs\/jorna$/);

  // The dialog is gone with its file — it may not stand over another file's
  // reading view, holding the frozen values (and the rev) of the one it left.
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

  await expect.poll(() => api.properties(NPC)).toHaveProperty("role", role);
  expect(await split(api, SCENE)).toEqual(scene);
});

test("Ort and Kapitel have the form too — campaign file, session and inbox do not", async ({
  page,
}) => {
  // The four kinds with typed properties offer it …
  const withForm: [string, string, string][] = [
    ["01-salzhafen/bucht/smuggler-captured", "Von den Schmugglern erwischt", "Szene"],
    ["npcs/fenn", "Fenn", "NPC"],
    ["locations/leuchtturm", "Der Leuchtturm von Salzhafen", "Ort"],
    ["01-salzhafen/_chapter", "Kapitel 1: Der Leuchtturm von Salzhafen", "Kapitel"],
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
  // the glossary, which has no typed properties to offer. Asserted only after
  // the content is on screen, so this cannot pass on a still-loading page.
  const withoutForm: [string, string][] = [
    ["sessions/2026-01-15", "Spuren gefunden"],
    ["inbox", "Der Dorfschmied repariert"],
    ["glossary", "Übersetzungs-Glossar"],
  ];
  for (const [rel, marker] of withoutForm) {
    await page.goto(`/beispiel/file/${rel}`);
    await expect(page.getByRole("article")).toContainText(marker);
    await expect(page.getByRole("button", { name: "Eigenschaften" })).toHaveCount(0);
  }

  // The campaign file keeps its ONE dialog (issue #34): its name/description
  // ARE its properties, so a second form next to it would be two ways to
  // write the same two keys.
  await page.goto("/beispiel/file/_campaign");
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

    await expect.poll(() => api.properties(SCENE)).toHaveProperty("title", title);
    const after = await split(api, SCENE);
    expect(after.properties.status).toBe("ready");
    expect(after.body).toBe(before.body);
  });
});
