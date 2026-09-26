// Critical paths 7 and 9 for the location: its EDIT MODE. The edit action
// turns the reading view into the location's edit mode — the name editable in
// place, chapter and Roll20 page as chips that each open only their own field
// (a popover on the desktop, a sheet from the bottom on the phone), the
// atmosphere in a collapsible section, and the text editor below. A location
// has no status. Everything on the page is one draft over the location's one
// row with its one guard (decisions/writes), so a save is ONE PATCH with
// exactly the fields that changed.
//
// A second writer makes the save a 409: the draft stays, the shared conflict
// line stands above the name, reloading takes the stored location and saving
// anyway writes only the changed fields, so a field changed elsewhere
// survives. Leaving with unsaved work asks first, through the cancel action
// and through a navigation. The location has no fields dialog.
//
// Elements are found by role, test id and catalog key (decisions/testing);
// every claim about what was written reads the location back through the API.

import type { Page, Request } from "@playwright/test";

import type { Api } from "../support/api";
import { getLocation, patchLocation } from "../support/location";
import { CAMPAIGN } from "../support/paths";
import { expect, test } from "../support/test";
import { ui } from "../support/ui";

const LOCATION = "lighthouse";
const LOCATION_URL = `/campaigns/${CAMPAIGN}/locations/${LOCATION}`;
/** The stored name of the location — the name of its text editor. */
const LOCATION_NAME = "The Lighthouse of Salt Harbour";
/** The other location of the example campaign. */
const OTHER_LOCATION = "cove";
const OTHER_LOCATION_NAME = "The North Cove";

/** The location without its guard, split into its text and every other field. */
async function locationSplit(api: Api) {
  const { body, rev: _rev, ...fields } = await getLocation(api, LOCATION);
  return { fields, body };
}

/** Every PATCH of the location the page sends, as the request body it carried. */
function recordLocationPatches(page: Page): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "PATCH") return;
    if (!request.url().endsWith(`/locations/${LOCATION}`)) return;
    sent.push(request.postDataJSON() as Record<string, unknown>);
  });
  return sent;
}

function nameInput(page: Page) {
  return page.getByRole("textbox", { name: ui("locationEdit.name.aria") });
}

function saveButton(page: Page) {
  // exact: the conflict line's "save anyway" contains the same word.
  return page.getByRole("button", { name: ui("common.save"), exact: true });
}

function cancelButton(page: Page) {
  return page.getByRole("button", { name: ui("common.cancel"), exact: true });
}

function editAction(page: Page) {
  return page.getByRole("button", { name: ui("common.edit"), exact: true });
}

function chip(page: Page, key: string) {
  return page.getByTestId(`field-chip-${key}`);
}

/** Open a field chip and hand back its editor, named by its heading. */
async function openChip(page: Page, key: string, name: string) {
  await chip(page, key).click();
  const editor = page.getByRole("dialog", { name });
  await expect(editor).toBeVisible();
  return editor;
}

function atmosphereToggle(page: Page) {
  return page.getByTestId("location-atmosphere-toggle");
}

/** Open the atmosphere section, if it is closed. */
async function openAtmosphere(page: Page) {
  const toggle = atmosphereToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** The atmosphere field of the open section. */
function atmosphereField(page: Page) {
  return page.getByRole("textbox", { name: ui("properties.location.atmosphere.label"), exact: true });
}

/** The raw markdown surface of the text editor. */
async function markdownSurface(page: Page, name: string = LOCATION_NAME) {
  await page.getByRole("button", { name: ui("composer.mode.markdown"), exact: true }).click();
  return page.getByRole("textbox", { name: ui("bodyEditor.markdown.aria", { path: name }) });
}

/** The conflict line with its two answers — the only alert of the app. */
function conflict(page: Page) {
  const line = page.getByRole("alert");
  return {
    line,
    reload: line.getByRole("button", { name: ui("editConflict.reload") }),
    force: line.getByRole("button", { name: ui("editConflict.force") }),
  };
}

async function openEditMode(page: Page) {
  await page.goto(LOCATION_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);
  await editAction(page).click();
  await expect(nameInput(page)).toHaveValue(LOCATION_NAME);
}

test("name, chip, atmosphere and text change together and are ONE patch of exactly those fields", async ({
  page,
  api,
}) => {
  const pristine = await locationSplit(api);
  const rev = (await getLocation(api, LOCATION)).rev;
  const sent = recordLocationPatches(page);
  const name = "The lighthouse of Salt Harbour";
  const roll20 = "Lighthouse (night)";
  const atmosphere = "Cold lamp oil, and the wind whistles through the spiral stairs.";
  const added = "- a gull on the lamp, watching";

  await page.goto(LOCATION_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);
  // The location offers no dialog over its fields: its fields are its edit mode.
  await expect(page.getByRole("button", { name: ui("properties.action") })).toHaveCount(0);
  await editAction(page).click();

  // The heading gave way to the editable name; nothing to save yet.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  await expect(page.getByRole("button", { name: ui("properties.action") })).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();

  await nameInput(page).fill(name);

  // A chip opens only its own field.
  const roll20Label = ui("properties.location.roll20.label");
  const roll20Editor = await openChip(page, "roll20Page", roll20Label);
  await roll20Editor.getByRole("textbox", { name: roll20Label }).fill(roll20);
  await page.keyboard.press("Escape");
  await expect(roll20Editor).toHaveCount(0);
  await expect(chip(page, "roll20Page")).toHaveAccessibleName(
    ui("editMode.chip.changedAria", { field: roll20Label, value: roll20 }),
  );

  // The atmosphere is one line until it is opened.
  await expect(atmosphereField(page)).toHaveCount(0);
  await openAtmosphere(page);
  await expect(atmosphereField(page)).toHaveValue(String(pristine.fields.atmosphere));
  await atmosphereField(page).fill(atmosphere);

  const textarea = await markdownSurface(page);
  await expect(textarea).toHaveValue(pristine.body);
  await textarea.fill(`${pristine.body}${added}\n`);

  // Four fields changed: name, Roll20 page, atmosphere and text.
  await expect(page.getByText(ui("editMode.changes", { count: 4 }))).toBeVisible();
  await expect(atmosphereToggle(page)).toContainText(ui("editMode.changes", { count: 1 }));
  expect(sent).toEqual([]);
  await saveButton(page).click();

  // Back in the reading view, already on the written location.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  const article = page.getByRole("article");
  await expect(article).toContainText(atmosphere);
  await expect(article).toContainText(ui("entity.location.roll20", { value: roll20 }));
  await expect(article).toContainText("a gull on the lamp");

  // ONE request, carrying exactly the changed fields beside the guard.
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0] ?? {}).sort()).toEqual([
    "atmosphere",
    "body",
    "name",
    "rev",
    "roll20Page",
  ]);
  expect((await getLocation(api, LOCATION)).rev).toBe(rev + 1);
  const after = await locationSplit(api);
  expect(after.fields).toEqual({ ...pristine.fields, name, roll20Page: roll20, atmosphere });
  expect(after.body).toBe(`${pristine.body}${added}\n`);
});

test("cleared fields are gone, and empty chips still stand", async ({ page, api }) => {
  const pristine = await locationSplit(api);

  await openEditMode(page);
  // No chapter and an emptied Roll20 page clear their fields.
  const chapter = await openChip(page, "chapter", ui("properties.location.chapter.label"));
  await chapter.getByRole("radio", { name: ui("locationEdit.chapter.none") }).click();
  await page.keyboard.press("Escape");
  const roll20Label = ui("properties.location.roll20.label");
  const roll20 = await openChip(page, "roll20Page", roll20Label);
  await roll20.getByRole("textbox", { name: roll20Label }).fill("");
  await page.keyboard.press("Escape");
  // Empty chips still stand — as the invitation to fill them.
  await expect(chip(page, "roll20Page")).toHaveAccessibleName(
    ui("editMode.chip.changedAria", { field: roll20Label, value: ui("editMode.chip.unset") }),
  );

  await openAtmosphere(page);
  await atmosphereField(page).fill("");

  await expect(page.getByText(ui("editMode.changes", { count: 3 }))).toBeVisible();
  await saveButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);
  await expect(page.getByRole("article")).not.toContainText(
    ui("entity.location.roll20", { value: String(pristine.fields.roll20Page) }),
  );

  // The cleared fields are GONE, not empty strings; the text is untouched.
  const stored = await getLocation(api, LOCATION);
  for (const key of ["chapter", "roll20Page", "atmosphere"]) {
    expect(Object.hasOwn(stored, key)).toBe(false);
  }
  const after = await locationSplit(api);
  const { chapter: _c, roll20Page: _r, atmosphere: _a, ...kept } = pristine.fields;
  expect(after.fields).toEqual(kept);
  expect(after.body).toBe(pristine.body);

  // Back in the edit mode, the empty section says so in its one line.
  await editAction(page).click();
  await expect(atmosphereToggle(page)).toContainText(ui("locationEdit.atmosphere.empty"));
});

test("a blank name blocks the save and says why", async ({ page, api }) => {
  const before = await locationSplit(api);

  await openEditMode(page);
  await nameInput(page).fill("");
  await expect(page.getByText(ui("locationEdit.blocked.name"))).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  expect(await locationSplit(api)).toEqual(before);
});

test("a second writer: the conflict line stands above the name and saving anyway keeps the other fields", async ({
  page,
  api,
}) => {
  const before = await locationSplit(api);
  const theirs = "\n## Who is here\n\nChanged by a second writer.\n";
  const atmosphere = "Salt on every surface, and nobody answers.";

  await openEditMode(page);
  await openAtmosphere(page);
  await atmosphereField(page).fill(atmosphere);

  // The second writer touches the text and the Roll20 page, with a fresh guard.
  await patchLocation(api, LOCATION, { body: theirs, roll20Page: "Lighthouse (theirs)" });
  await saveButton(page).click();

  // Refused: the conflict line with both answers, ABOVE the name.
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  const lineBox = await conflicted.line.boundingBox();
  const nameBox = await nameInput(page).boundingBox();
  expect(lineBox?.y ?? Infinity).toBeLessThan(nameBox?.y ?? 0);
  // The draft stands and nothing of it was written.
  await expect(atmosphereField(page)).toHaveValue(atmosphere);
  const stored = await locationSplit(api);
  expect(stored.fields).toEqual({ ...before.fields, roll20Page: "Lighthouse (theirs)" });
  expect(stored.body).toBe(theirs);

  // Saving anyway writes the changed field only: the other writer's text and
  // Roll20 page stay.
  await conflicted.force.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);
  await expect(conflicted.line).toHaveCount(0);
  const after = await locationSplit(api);
  expect(after.fields).toEqual({ ...before.fields, roll20Page: "Lighthouse (theirs)", atmosphere });
  expect(after.body).toBe(theirs);
  await expect(page.getByRole("article")).toContainText(atmosphere);
});

test("a second writer: reloading drops the draft and takes the stored location", async ({
  page,
  api,
}) => {
  const before = await locationSplit(api);
  const theirName = "The lighthouse (renamed elsewhere)";
  const theirAtmosphere = "Busy again: someone lit the lamp.";

  await openEditMode(page);
  await nameInput(page).fill("A name that is never written");
  await openAtmosphere(page);
  await atmosphereField(page).fill("My version of the atmosphere.");
  const textarea = await markdownSurface(page);
  await textarea.fill(`${before.body}\nMy line.\n`);

  await patchLocation(api, LOCATION, { name: theirName, atmosphere: theirAtmosphere });
  await saveButton(page).click();

  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  const stored = await locationSplit(api);

  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  // Every part of the page now shows what is stored, and there is nothing to save.
  await expect(nameInput(page)).toHaveValue(theirName);
  await expect(atmosphereField(page)).toHaveValue(theirAtmosphere);
  await expect(
    page.getByRole("textbox", { name: ui("bodyEditor.markdown.aria", { path: theirName }) }),
  ).toHaveValue(before.body);
  await expect(saveButton(page)).toBeDisabled();
  expect(await locationSplit(api)).toEqual(stored);
});

test("leaving with unsaved work asks first — cancel and navigation alike", async ({ page, api }) => {
  const before = await locationSplit(api);
  const discardDialog = page.getByRole("dialog", { name: ui("bodyEditor.discard.title") });

  // Nothing typed: cancel leaves at once.
  await openEditMode(page);
  await cancelButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);

  // Something typed: cancel asks, and keeping on editing keeps it.
  await editAction(page).click();
  await openAtmosphere(page);
  await atmosphereField(page).fill("An atmosphere that is never saved");
  await cancelButton(page).click();
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(discardDialog).toHaveCount(0);
  await expect(atmosphereField(page)).toHaveValue("An atmosphere that is never saved");

  // A navigation asks the same question: ⌘K works over the edit mode.
  const leaveDialog = page.getByRole("dialog", { name: ui("properties.discard.title") });
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("North Cove");
  await page.getByRole("option").filter({ hasText: OTHER_LOCATION_NAME }).first().click();
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(page).toHaveURL(new RegExp(`${LOCATION_URL}$`));
  await expect(atmosphereField(page)).toHaveValue("An atmosphere that is never saved");

  // Discarding goes on to the other location, which opens in its reading view.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("North Cove");
  await page.getByRole("option").filter({ hasText: OTHER_LOCATION_NAME }).first().click();
  await leaveDialog.getByRole("button", { name: ui("common.discard") }).click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${CAMPAIGN}/locations/${OTHER_LOCATION}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(OTHER_LOCATION_NAME);
  await expect(nameInput(page)).toHaveCount(0);
  expect(await locationSplit(api)).toEqual(before);

  // Back on the first location: the reading view, never an edit mode seeded anew.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);
  await expect(nameInput(page)).toHaveCount(0);
});

// Critical path 8's width: the phone. The chips wrap, the atmosphere is one
// line until it is opened, and the save actions are at the bottom of the
// screen. Nothing scrolls sideways.
test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** How far the page scrolls sideways — nothing at all is the rule. */
  async function overflow(page: Page): Promise<number> {
    return page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  }

  test("chips, a sheet per field, the atmosphere and the save at the bottom", async ({
    page,
    api,
  }) => {
    const before = await locationSplit(api);
    const atmosphere = "Fog up to the second window, and the door stands open.";
    await openEditMode(page);

    // Two chips — both stand, so there is no list of the rest.
    for (const key of ["chapter", "roll20Page"]) await expect(chip(page, key)).toBeVisible();
    await expect(page.getByTestId("field-chip-all")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // The save sits at the bottom of the screen.
    const save = saveButton(page);
    const box = await save.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(844 - 80);

    // A chip opens its field as a sheet with its own done action.
    await chip(page, "roll20Page").click();
    const roll20 = page.getByRole("dialog", { name: ui("properties.location.roll20.label") });
    await expect(roll20).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await roll20.getByRole("button", { name: ui("editMode.done") }).click();
    await expect(roll20).toHaveCount(0);

    // The closed section is one line; open, its field stands in the column.
    const toggle = atmosphereToggle(page);
    expect((await toggle.boundingBox())?.height ?? Infinity).toBeLessThan(60);
    await openAtmosphere(page);
    await atmosphereField(page).fill(atmosphere);
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    await expect(page.getByText(ui("editMode.changes", { count: 1 })).first()).toBeVisible();
    await save.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);

    const after = await locationSplit(api);
    expect(after.fields).toEqual({ ...before.fields, atmosphere });
    expect(after.body).toBe(before.body);
  });
});
