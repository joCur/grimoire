// Critical paths 7 and 9 for the scene: its EDIT MODE. The edit action turns
// the reading view into the scene's edit mode — the title editable in place,
// the short fields as chips that each open only their own field (a popover on
// the desktop, a sheet from the bottom on the phone), the status beside the
// heading and the text editor below. Everything on the page is one draft over
// the scene's one row with its one guard (decisions/writes), so a save is ONE
// PATCH with exactly the fields that changed.
//
// A second writer makes the save a 409: the draft stays, the shared conflict
// line stands above the title, reloading takes the stored scene and saving
// anyway writes only the changed fields, so a field changed elsewhere
// survives. Leaving with unsaved work asks first, through the cancel action
// and through a navigation.
//
// Elements are found by role, test id and catalog key (decisions/testing);
// every claim about what was written reads the scene back through the API.

import type { Page, Request } from "@playwright/test";

import type { Api } from "../support/api";
import { ui } from "../support/ui";
import { getScene, patchScene } from "../support/scene";
import { expect, test } from "../support/test";

const SCENE = "lighthouse-arrival";
const SCENE_URL = `/campaigns/beispiel/scenes/${SCENE}`;
/** The stored title of the scene — the name of its text editor. */
const SCENE_TITLE = "Ankunft am Leuchtturm";

/** The scene without its guard, split into its text and every other field. */
async function sceneSplit(api: Api) {
  const { body, rev: _rev, ...fields } = await getScene(api, SCENE);
  return { fields, body };
}

/** Every PATCH of the scene the page sends, as the request body it carried. */
function recordScenePatches(page: Page): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "PATCH") return;
    if (!request.url().endsWith(`/scenes/${SCENE}`)) return;
    sent.push(request.postDataJSON() as Record<string, unknown>);
  });
  return sent;
}

function titleInput(page: Page) {
  return page.getByRole("textbox", { name: ui("sceneEdit.title.aria") });
}

function saveButton(page: Page) {
  return page.getByRole("button", { name: ui("common.save"), exact: true });
}

function cancelButton(page: Page) {
  return page.getByRole("button", { name: ui("common.cancel"), exact: true });
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

/** The status control in the edit mode's header, named by the value it shows. */
function statusControl(page: Page, current: string) {
  return page.getByRole("button", { name: ui("status.change.aria", { current }) });
}

/** The raw markdown surface of the text editor. */
async function markdownSurface(page: Page) {
  await page.getByRole("button", { name: ui("composer.mode.markdown"), exact: true }).click();
  return page.getByRole("textbox", {
    name: ui("bodyEditor.markdown.aria", { path: SCENE_TITLE }),
  });
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
  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);
  await page.getByRole("button", { name: ui("common.edit"), exact: true }).click();
  await expect(titleInput(page)).toHaveValue(SCENE_TITLE);
}

test("fields, status and text change together and are ONE patch of exactly those fields", async ({
  page,
  api,
}) => {
  const pristine = await sceneSplit(api);
  const rev = (await getScene(api, SCENE)).rev;
  // The location the scene moves to has to exist (decisions/constraints).
  await api.send("POST", "campaigns/beispiel/locations", { name: "North Cove" });
  const sent = recordScenePatches(page);
  const title = "Arrival at dusk";
  const added = "A brass whistle lies in the sand at the foot of the stairs.";

  await openEditMode(page);
  // The reading view's heading gave way to the editable title, and the scene
  // offers no dialog over its fields any more.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  await expect(page.getByRole("button", { name: ui("properties.action") })).toHaveCount(0);
  // Nothing changed yet, so there is nothing to save and nothing to count.
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByText(ui("editMode.changes", { count: 1 }))).toHaveCount(0);

  await titleInput(page).fill(title);

  // A chip opens only its own field.
  const tags = await openChip(page, "tags", ui("properties.scene.tags.label"));
  await expect(tags.getByRole("radiogroup")).toHaveCount(0);
  const tagInput = tags.getByLabel(ui("properties.scene.tags.label"));
  await tagInput.fill("stealth");
  await tagInput.press("Enter");
  await expect(tags.getByRole("button", { name: ui("properties.field.remove.aria", { item: "stealth" }) })).toBeVisible();
  // Text still standing in the input is folded in by the save.
  await tagInput.fill("night");
  await page.keyboard.press("Escape");
  await expect(tags).toHaveCount(0);
  // The changed chip says so, with the value the save will write.
  await expect(chip(page, "tags")).toHaveAccessibleName(
    ui("editMode.chip.changedAria", {
      field: ui("properties.scene.tags.label"),
      value: "social, travel, stealth, night",
    }),
  );

  // The location is picked from the locations that exist, narrowed by a search.
  const location = await openChip(page, "location", ui("properties.scene.location.label"));
  await location.getByRole("searchbox").fill("north");
  await expect(location.getByRole("radio")).toHaveCount(1);
  await location.getByRole("radio", { name: "North Cove" }).click();
  await expect(location.getByRole("radio", { name: "North Cove" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");

  // The status beside the heading is part of the same save.
  await statusControl(page, ui("status.scene.ready")).click();
  await page.getByRole("menuitemradio", { name: ui("status.scene.draft") }).click();
  await expect(statusControl(page, ui("status.scene.draft"))).toBeVisible();

  const textarea = await markdownSurface(page);
  await expect(textarea).toHaveValue(pristine.body);
  await textarea.fill(`${pristine.body}\n${added}\n`);

  // Five fields changed: title, tags, location, status and text.
  await expect(page.getByText(ui("editMode.changes", { count: 5 }))).toBeVisible();
  // Nothing was written on the way.
  expect(sent).toEqual([]);
  await saveButton(page).click();

  // Back in the reading view, already on the written scene.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  const article = page.getByRole("article");
  await expect(article).toContainText(added);
  await expect(article).toContainText("North Cove");
  await expect(article).toContainText("#stealth");
  await expect(article).toContainText("#night");
  await expect(statusControl(page, ui("status.scene.draft"))).toBeVisible();

  // ONE request, carrying exactly the changed fields beside the guard.
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0] ?? {}).sort()).toEqual([
    "body",
    "location",
    "rev",
    "status",
    "tags",
    "title",
  ]);
  const stored = await getScene(api, SCENE);
  expect(stored.rev).toBe(rev + 1);
  const after = await sceneSplit(api);
  expect(after.fields).toEqual({
    ...pristine.fields,
    title,
    tags: ["social", "travel", "stealth", "night"],
    location: "north-cove",
    status: "draft",
  });
  expect(after.body).toBe(`${pristine.body}\n${added}\n`);
});

test("a planned scene becomes a contingency one with its trigger; cleared fields are gone", async ({
  page,
  api,
}) => {
  const pristine = await sceneSplit(api);
  expect(pristine.fields.type).toBe("planned");
  const trigger = "When the party lingers until the tide turns.";

  await openEditMode(page);
  // A planned scene has no trigger line — only the dashed chip that adds one.
  const triggerLine = page.getByRole("textbox", { name: ui("sceneArticle.trigger.label") });
  await expect(triggerLine).toHaveCount(0);
  await page.getByRole("button", { name: ui("sceneEdit.trigger.add"), exact: true }).click();
  // It turns the scene into a contingency one, and the cursor is in the line.
  await expect(triggerLine).toBeFocused();
  await triggerLine.fill(trigger);
  await expect(chip(page, "type")).toHaveAccessibleName(
    ui("editMode.chip.changedAria", {
      field: ui("properties.scene.type.label"),
      value: ui("sceneArticle.type.contingency"),
    }),
  );
  await expect(page.getByRole("button", { name: ui("sceneEdit.trigger.add"), exact: true })).toHaveCount(0);

  // The last handout goes, and the location is cleared.
  const handouts = await openChip(page, "handouts", ui("sceneEdit.handouts.title"));
  await handouts
    .getByRole("button", { name: ui("properties.field.remove.aria", { item: "Karte von Salzhafen" }) })
    .click();
  await page.keyboard.press("Escape");
  const location = await openChip(page, "location", ui("properties.scene.location.label"));
  await location.getByRole("radio", { name: ui("sceneEdit.location.none") }).click();
  await page.keyboard.press("Escape");
  // Empty chips still stand — as the invitation to fill them.
  await expect(chip(page, "handouts")).toHaveAccessibleName(
    ui("editMode.chip.changedAria", {
      field: ui("properties.scene.handouts.label"),
      value: ui("editMode.chip.unset"),
    }),
  );

  await expect(page.getByText(ui("editMode.changes", { count: 4 }))).toBeVisible();
  await saveButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);

  const after = await sceneSplit(api);
  // The cleared location is GONE, not an empty string; the list is empty.
  expect(after.fields.location).toBeUndefined();
  expect(after.fields).toEqual({
    ...pristine.fields,
    type: "contingency",
    trigger,
    location: undefined,
    handouts: [],
  });
  expect(after.body).toBe(pristine.body);
});

test("a second writer: the conflict line stands above the title and saving anyway keeps the other field", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const theirs = "\n## Flow\n\nChanged by a second writer.\n";

  await openEditMode(page);
  const tags = await openChip(page, "tags", ui("properties.scene.tags.label"));
  const tagInput = tags.getByLabel(ui("properties.scene.tags.label"));
  await tagInput.fill("forced");
  await tagInput.press("Enter");
  await page.keyboard.press("Escape");

  // The second writer touches only the text, with a fresh guard of its own.
  await patchScene(api, SCENE, { body: theirs });
  await saveButton(page).click();

  // Refused: the conflict line with both answers, ABOVE the title.
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  await expect(conflicted.force).toBeVisible();
  const lineBox = await conflicted.line.boundingBox();
  const titleBox = await titleInput(page).boundingBox();
  expect(lineBox?.y ?? Infinity).toBeLessThan(titleBox?.y ?? 0);
  // The draft stands and nothing was written.
  await expect(chip(page, "tags")).toHaveAccessibleName(
    ui("editMode.chip.changedAria", {
      field: ui("properties.scene.tags.label"),
      value: "social, travel, forced",
    }),
  );
  const stored = await sceneSplit(api);
  expect(stored.fields).toEqual(before.fields);
  expect(stored.body).toBe(theirs);

  // Saving anyway writes the changed field only: the other writer's text stays.
  await conflicted.force.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);
  await expect(conflicted.line).toHaveCount(0);
  const after = await sceneSplit(api);
  expect(after.fields).toEqual({ ...before.fields, tags: ["social", "travel", "forced"] });
  expect(after.body).toBe(theirs);
});

test("a second writer: reloading drops the draft and takes the stored scene", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const theirTitle = "Arrival, renamed elsewhere";

  await openEditMode(page);
  await titleInput(page).fill("My title that is never written");
  const textarea = await markdownSurface(page);
  await textarea.fill(`${before.body}\nMy sentence that is never written.\n`);

  // A second writer changes the status and the title: even a status write is
  // a conflict for the open draft, because the row shares one guard.
  await patchScene(api, SCENE, { status: "played", title: theirTitle });
  await saveButton(page).click();

  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  const stored = await sceneSplit(api);

  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  // Every part of the page now shows what is stored, and there is nothing to save.
  await expect(titleInput(page)).toHaveValue(theirTitle);
  await expect(statusControl(page, ui("status.scene.played"))).toBeVisible();
  // Still the same surface, now holding the stored text — and named by the
  // stored title.
  await expect(textarea).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: ui("bodyEditor.markdown.aria", { path: theirTitle }) }),
  ).toHaveValue(before.body);
  await expect(saveButton(page)).toBeDisabled();
  expect(await sceneSplit(api)).toEqual(stored);
});

test("leaving with unsaved work asks first — cancel and navigation alike", async ({ page, api }) => {
  const before = await sceneSplit(api);
  const discardDialog = page.getByRole("dialog", { name: ui("bodyEditor.discard.title") });

  // Nothing typed: cancel leaves at once.
  await openEditMode(page);
  await cancelButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);

  // Something typed: cancel asks, and keeping on editing keeps it.
  await page.getByRole("button", { name: ui("common.edit"), exact: true }).click();
  await titleInput(page).fill("A title that is never saved");
  await cancelButton(page).click();
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(discardDialog).toHaveCount(0);
  await expect(titleInput(page)).toHaveValue("A title that is never saved");

  // A navigation asks the same question: ⌘K works over the edit mode.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("Jorna");
  await page.getByRole("option").filter({ hasText: "Hafenmeisterin Jorna" }).first().click();
  const leaveDialog = page.getByRole("dialog", { name: ui("properties.discard.title") });
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(page).toHaveURL(new RegExp(`${SCENE_URL}$`));
  await expect(titleInput(page)).toHaveValue("A title that is never saved");

  // Discarding goes on to the npc, and nothing was written.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("Jorna");
  await page.getByRole("option").filter({ hasText: "Hafenmeisterin Jorna" }).first().click();
  await leaveDialog.getByRole("button", { name: ui("common.discard") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/jorna$/);
  expect(await sceneSplit(api)).toEqual(before);

  // Back on the scene: the reading view, never an edit mode seeded anew.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);
  await expect(titleInput(page)).toHaveCount(0);
});

test("an npc that is no id blocks the save and says why", async ({ page, api }) => {
  const before = await sceneSplit(api);
  await openEditMode(page);
  const npcs = await openChip(page, "npcs", ui("sceneEdit.npcs.title"));
  const npcInput = npcs.getByLabel(ui("sceneEdit.npcs.title"));
  await npcInput.fill("Not An Id");
  await npcInput.press("Enter");
  // The field's editor says what is wrong, and the page says why it cannot save.
  await expect(npcs.getByText(ui("properties.issue.notAnId", { id: "Not An Id" }))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(ui("editMode.blocked.fields"))).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();

  // Taking it out again clears both.
  await chip(page, "npcs").click();
  await npcs
    .getByRole("button", { name: ui("properties.field.remove.aria", { item: "Not An Id" }) })
    .click();
  await expect(npcs.getByText(ui("properties.issue.notAnId", { id: "Not An Id" }))).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByText(ui("editMode.blocked.fields"))).toHaveCount(0);
  expect(await sceneSplit(api)).toEqual(before);
});

test("the chapter chip moves the scene to the end of the other chapter", async ({ page, api }) => {
  await api.send("POST", "campaigns/beispiel/chapters", { title: "Under the Cliff", id: "02-cliff" });
  await api.send("POST", "campaigns/beispiel/scenes", { title: "At the Beach", chapter: "02-cliff" });

  await openEditMode(page);
  const chapter = await openChip(page, "chapter", ui("properties.scene.chapter.label"));
  await chapter.getByRole("radio", { name: "Under the Cliff" }).click();
  await page.keyboard.press("Escape");
  await saveButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);

  expect((await getScene(api, SCENE)).chapter).toBe("02-cliff");
  const tree = await api.get<{ chapters: { id: string; scenes: { id: string }[] }[] }>(
    "campaigns/beispiel/tree",
  );
  expect(tree.chapters.find((node) => node.id === "02-cliff")?.scenes.map((s) => s.id)).toEqual([
    "at-the-beach",
    SCENE,
  ]);
});

// Critical path 8's width: the phone. The chips wrap and the first three
// stand; the rest sit behind "all fields", and the save actions are at the
// bottom of the screen. Nothing scrolls sideways.
test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** How far the page scrolls sideways — nothing at all is the rule. */
  async function overflow(page: Page): Promise<number> {
    return page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  }

  test("three chips, the rest behind all fields, a sheet per field and the save at the bottom", async ({
    page,
    api,
  }) => {
    const before = await sceneSplit(api);
    await openEditMode(page);

    for (const key of ["type", "location", "npcs"]) await expect(chip(page, key)).toBeVisible();
    for (const key of ["tags", "handouts", "chapter"]) await expect(chip(page, key)).toBeHidden();
    const all = page.getByTestId("field-chip-all");
    await expect(all).toHaveText(ui("editMode.allFields.chip", { count: 6 }));
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // The save sits at the bottom of the screen.
    const save = saveButton(page);
    const box = await save.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(844 - 80);

    // All fields as a list; a row opens that field's own sheet.
    await all.click();
    const list = page.getByRole("dialog", { name: ui("editMode.allFields.title") });
    await expect(list).toBeVisible();
    await expect(list.getByTestId(/^field-row-/)).toHaveCount(6);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await list.getByTestId("field-row-tags").click();
    const tags = page.getByRole("dialog", { name: ui("properties.scene.tags.label") });
    await expect(tags).toBeVisible();
    const tagInput = tags.getByLabel(ui("properties.scene.tags.label"));
    await tagInput.fill("night");
    await tagInput.press("Enter");
    await tags.getByRole("button", { name: ui("editMode.done") }).click();
    await expect(tags).toHaveCount(0);

    await expect(page.getByText(ui("editMode.changes", { count: 1 }))).toBeVisible();
    await save.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SCENE_TITLE);

    const after = await sceneSplit(api);
    expect(after.fields).toEqual({ ...before.fields, tags: ["social", "travel", "night"] });
    expect(after.body).toBe(before.body);
  });

  test("a long title wraps instead of being cut off, and Enter adds no line", async ({
    page,
    api,
  }) => {
    const long = "The long night at the lighthouse, when the smugglers came back for their cargo";
    await openEditMode(page);
    const title = titleInput(page);
    const oneLine = (await title.boundingBox())?.height ?? 0;

    await title.fill(long);
    // Taller than one line, as wide as the column — the whole title is on screen.
    await expect.poll(async () => (await title.boundingBox())?.height ?? 0).toBeGreaterThan(oneLine * 1.5);
    expect(await title.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // Enter leaves the field instead of breaking the line.
    await title.press("End");
    await title.press("Enter");
    await expect(title).not.toBeFocused();
    await expect(title).toHaveValue(long);

    await saveButton(page).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(long);
    expect((await getScene(api, SCENE)).title).toBe(long);
  });
});
