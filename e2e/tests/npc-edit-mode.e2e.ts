// Critical paths 7 and 9 for the npc: its EDIT MODE. The edit action turns
// the reading view into the npc's edit mode — the name editable in place, the
// status beside the heading, quick stats, statblock and chapter as chips that
// each open only their own field (a popover on the desktop, a sheet from the
// bottom on the phone), role, voice, appearance and motivation in the
// collapsible profile, and the text editor below. Everything on the page is
// one draft over the npc's one row with its one guard (decisions/writes), so
// a save is ONE PATCH with exactly the fields that changed.
//
// A second writer makes the save a 409: the draft stays, the shared conflict
// line stands above the name, reloading takes the stored npc and saving
// anyway writes only the changed fields, so a field changed elsewhere
// survives. Leaving with unsaved work asks first, through the cancel action
// and through a navigation. The npc has no fields dialog.
//
// Elements are found by role, test id and catalog key (decisions/testing);
// every claim about what was written reads the npc back through the API.

import type { Page, Request } from "@playwright/test";

import type { Api } from "../support/api";
import { getNpc, npcPath, patchNpc } from "../support/npc";
import { expect, test } from "../support/test";
import { ui } from "../support/ui";

const NPC = "jorna";
const NPC_URL = `/campaigns/beispiel/npcs/${NPC}`;
/** The stored name of the npc — the name of its text editor. */
const NPC_NAME = "Hafenmeisterin Jorna";

/** The npc without its guard, split into its text and every other field. */
async function npcSplit(api: Api) {
  const { body, rev: _rev, ...fields } = await getNpc(api, NPC);
  return { fields, body };
}

/** Every PATCH of the npc the page sends, as the request body it carried. */
function recordNpcPatches(page: Page): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "PATCH") return;
    if (!request.url().endsWith(`/npcs/${NPC}`)) return;
    sent.push(request.postDataJSON() as Record<string, unknown>);
  });
  return sent;
}

function nameInput(page: Page) {
  return page.getByRole("textbox", { name: ui("npcEdit.name.aria") });
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

/** The status control in the edit mode's header, named by the value it shows. */
function statusControl(page: Page, current: string) {
  return page.getByRole("button", { name: ui("status.change.aria", { current }) });
}

function profileToggle(page: Page) {
  return page.getByTestId("npc-profile-toggle");
}

/** Open the profile section, if it is closed. */
async function openProfile(page: Page) {
  const toggle = profileToggle(page);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

type ProfileLabel =
  | "properties.npc.role.label"
  | "properties.npc.voice.label"
  | "properties.npc.appearance.label"
  | "properties.npc.motivation.label";

/** A field of the open profile section. */
function profileField(page: Page, label: ProfileLabel) {
  return page.getByRole("textbox", { name: ui(label), exact: true });
}

/** The raw markdown surface of the text editor. */
async function markdownSurface(page: Page, name: string = NPC_NAME) {
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
  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  await editAction(page).click();
  await expect(nameInput(page)).toHaveValue(NPC_NAME);
}

test("name, chip, profile, status and text change together and are ONE patch of exactly those fields", async ({
  page,
  api,
}) => {
  const pristine = await npcSplit(api);
  const rev = (await getNpc(api, NPC)).rev;
  const sent = recordNpcPatches(page);
  const name = "Harbour master Jorna";
  const role = "Patron, on the council since the autumn";
  const added = "- metta: owes Jorna a favour since last autumn";

  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  // The npc offers no dialog over its fields: its fields are its edit mode.
  await expect(page.getByRole("button", { name: ui("properties.action") })).toHaveCount(0);
  await editAction(page).click();

  // The heading gave way to the editable name; nothing to save yet.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  await expect(page.getByRole("button", { name: ui("properties.action") })).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();

  await nameInput(page).fill(name);

  // A chip opens only its own field: the quick stats get a third row.
  const quickstats = ui("properties.npc.quickstats.label");
  const stats = await openChip(page, "quickstats", quickstats);
  await stats.getByRole("button", { name: ui("properties.field.addRow") }).click();
  await stats.getByLabel(ui("properties.field.row.name.aria", { label: quickstats, row: 3 })).fill("deception");
  await stats.getByLabel(ui("properties.field.row.value.aria", { label: quickstats, row: 3 })).fill("+1");
  await page.keyboard.press("Escape");
  await expect(stats).toHaveCount(0);
  await expect(chip(page, "quickstats")).toHaveAccessibleName(
    ui("editMode.chip.changedAria", {
      field: quickstats,
      value: "insight 2, passive-perception 12, deception +1",
    }),
  );

  // The profile is one line until it is opened.
  await expect(profileField(page, "properties.npc.role.label")).toHaveCount(0);
  await openProfile(page);
  const roleField = profileField(page, "properties.npc.role.label");
  await expect(roleField).toHaveValue(String(pristine.fields.role));
  await roleField.fill(role);

  // The status beside the heading is part of the same save.
  await statusControl(page, ui("status.npc.alive")).click();
  await page.getByRole("menuitemradio", { name: ui("status.npc.missing") }).click();
  await expect(statusControl(page, ui("status.npc.missing"))).toBeVisible();

  const textarea = await markdownSurface(page);
  await expect(textarea).toHaveValue(pristine.body);
  await textarea.fill(`${pristine.body}${added}\n`);

  // Five fields changed: name, quick stats, role, status and text.
  await expect(page.getByText(ui("editMode.changes", { count: 5 }))).toBeVisible();
  expect(sent).toEqual([]);
  await saveButton(page).click();

  // Back in the reading view, already on the written npc.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  const article = page.getByRole("article");
  await expect(article).toContainText(role);
  await expect(article).toContainText(ui("status.npc.missing"));
  await expect(article).toContainText("deception +1");
  await expect(article).toContainText("owes Jorna a favour");
  // Untouched header values stand.
  await expect(article).toContainText(String(pristine.fields.voice));

  // ONE request, carrying exactly the changed fields beside the guard.
  expect(sent).toHaveLength(1);
  expect(Object.keys(sent[0] ?? {}).sort()).toEqual([
    "body",
    "name",
    "quickstats",
    "rev",
    "role",
    "status",
  ]);
  expect((await getNpc(api, NPC)).rev).toBe(rev + 1);
  const after = await npcSplit(api);
  // A typed relative value stays the string it was typed as; the numbers
  // already stored stay numbers.
  expect(after.fields).toEqual({
    ...pristine.fields,
    name,
    role,
    status: "missing",
    quickstats: { insight: 2, "passive-perception": 12, deception: "+1" },
  });
  expect(after.body).toBe(`${pristine.body}${added}\n`);
});

test("cleared fields are gone, and the motivation reads its reference as the name", async ({
  page,
  api,
}) => {
  const pristine = await npcSplit(api);
  const motivation = "See the beacon burn — and finally confront [[fenn]].";

  await openEditMode(page);
  // An emptied statblock and no chapter clear their fields.
  const statblock = await openChip(page, "statblock", ui("properties.npc.statblock.label"));
  await statblock.getByRole("textbox", { name: ui("properties.npc.statblock.label") }).fill("");
  await page.keyboard.press("Escape");
  const chapter = await openChip(page, "chapter", ui("properties.npc.chapter.label"));
  await chapter.getByRole("radio", { name: ui("npcEdit.chapter.none") }).click();
  await page.keyboard.press("Escape");
  // Empty chips still stand — as the invitation to fill them.
  await expect(chip(page, "statblock")).toHaveAccessibleName(
    ui("editMode.chip.changedAria", {
      field: ui("properties.npc.statblock.label"),
      value: ui("editMode.chip.unset"),
    }),
  );

  await openProfile(page);
  await profileField(page, "properties.npc.voice.label").fill("");
  await profileField(page, "properties.npc.motivation.label").fill(motivation);

  // Four fields changed; the profile counts its own two.
  await expect(page.getByText(ui("editMode.changes", { count: 4 }))).toBeVisible();
  await expect(profileToggle(page)).toContainText(ui("editMode.changes", { count: 2 }));
  await saveButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);

  // The reference in the motivation reads as the current name.
  const article = page.getByRole("article");
  await expect(article).toContainText("and finally confront Fenn");
  await expect(article).not.toContainText("[[fenn]]");
  await expect(article).not.toContainText(
    ui("entity.npc.statblock", { value: String(pristine.fields.statblock) }),
  );

  // The cleared fields are GONE, not empty strings; the text is untouched.
  const stored = await getNpc(api, NPC);
  for (const key of ["statblock", "chapter", "voice"]) expect(Object.hasOwn(stored, key)).toBe(false);
  const after = await npcSplit(api);
  const { statblock: _s, chapter: _c, voice: _v, ...kept } = pristine.fields;
  expect(after.fields).toEqual({ ...kept, motivation });
  expect(after.body).toBe(pristine.body);
});

test("a quick stat row that cannot be written blocks the save and says why", async ({
  page,
  api,
}) => {
  const before = await npcSplit(api);
  const quickstats = ui("properties.npc.quickstats.label");

  await openEditMode(page);
  const stats = await openChip(page, "quickstats", quickstats);
  await stats.getByRole("button", { name: ui("properties.field.addRow") }).click();
  const statName = stats.getByLabel(ui("properties.field.row.name.aria", { label: quickstats, row: 3 }));
  const statValue = stats.getByLabel(ui("properties.field.row.value.aria", { label: quickstats, row: 3 }));

  // A value without a name, or a name twice, would lose what the DM typed.
  await statValue.fill("+1");
  await expect(stats.getByText(ui("properties.issue.namelessRow"))).toBeVisible();
  await statName.fill("insight");
  await expect(stats.getByText(ui("properties.issue.duplicateName", { name: "insight" }))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(ui("editMode.blocked.fields"))).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();

  // Enter in a cell saves nothing and closes nothing.
  await chip(page, "quickstats").click();
  await statName.fill("deception");
  await statName.press("Enter");
  await expect(stats).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(ui("editMode.blocked.fields"))).toHaveCount(0);
  await expect(saveButton(page)).toBeEnabled();
  expect(await npcSplit(api)).toEqual(before);

  await saveButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  expect((await getNpc(api, NPC)).quickstats).toEqual({
    insight: 2,
    "passive-perception": 12,
    deception: "+1",
  });
});

test("a second writer: the conflict line stands above the name and saving anyway keeps the other fields", async ({
  page,
  api,
}) => {
  const before = await npcSplit(api);
  const theirs = "\n## Knows\n\nChanged by a second writer.\n";
  const role = "Harbour master, at odds with the council";
  const motivation = "The beacon, despite everything.";

  await openEditMode(page);
  await openProfile(page);
  await profileField(page, "properties.npc.role.label").fill(role);
  await profileField(page, "properties.npc.motivation.label").fill(motivation);

  // The second writer touches the text and the status, with a fresh guard.
  await patchNpc(api, NPC, { body: theirs, status: "dead" });
  await saveButton(page).click();

  // Refused: the conflict line with both answers, ABOVE the name.
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  const lineBox = await conflicted.line.boundingBox();
  const nameBox = await nameInput(page).boundingBox();
  expect(lineBox?.y ?? Infinity).toBeLessThan(nameBox?.y ?? 0);
  // The draft stands and nothing of it was written.
  await expect(profileField(page, "properties.npc.role.label")).toHaveValue(role);
  const stored = await npcSplit(api);
  expect(stored.fields).toEqual({ ...before.fields, status: "dead" });
  expect(stored.body).toBe(theirs);

  // Saving anyway writes the changed fields only: the other writer's text
  // and status stay.
  await conflicted.force.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  await expect(conflicted.line).toHaveCount(0);
  const after = await npcSplit(api);
  expect(after.fields).toEqual({ ...before.fields, status: "dead", role, motivation });
  expect(after.body).toBe(theirs);
  await expect(page.getByRole("article")).toContainText(role);
});

test("a second writer: reloading drops the draft and takes the stored npc", async ({
  page,
  api,
}) => {
  const before = await npcSplit(api);
  const theirName = "Harbour master Jorna (renamed elsewhere)";
  const theirMotivation = "Save the harbour funds, whatever it costs.";

  await openEditMode(page);
  await nameInput(page).fill("A name that is never written");
  await openProfile(page);
  await profileField(page, "properties.npc.motivation.label").fill("My version of the motivation.");
  const textarea = await markdownSurface(page);
  await textarea.fill(`${before.body}\nMy line.\n`);

  await patchNpc(api, NPC, { name: theirName, motivation: theirMotivation });
  await saveButton(page).click();

  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  const stored = await npcSplit(api);

  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  // Every part of the page now shows what is stored, and there is nothing to save.
  await expect(nameInput(page)).toHaveValue(theirName);
  await expect(profileField(page, "properties.npc.motivation.label")).toHaveValue(theirMotivation);
  await expect(
    page.getByRole("textbox", { name: ui("bodyEditor.markdown.aria", { path: theirName }) }),
  ).toHaveValue(before.body);
  await expect(saveButton(page)).toBeDisabled();
  expect(await npcSplit(api)).toEqual(stored);
});

test("leaving with unsaved work asks first — cancel and navigation alike", async ({ page, api }) => {
  const before = await npcSplit(api);
  const discardDialog = page.getByRole("dialog", { name: ui("bodyEditor.discard.title") });

  // Nothing typed: cancel leaves at once.
  await openEditMode(page);
  await cancelButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);

  // Something typed: cancel asks, and keeping on editing keeps it.
  await editAction(page).click();
  await openProfile(page);
  await profileField(page, "properties.npc.voice.label").fill("A voice that is never saved");
  await cancelButton(page).click();
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(discardDialog).toHaveCount(0);
  await expect(profileField(page, "properties.npc.voice.label")).toHaveValue(
    "A voice that is never saved",
  );

  // A navigation asks the same question: ⌘K works over the edit mode.
  const leaveDialog = page.getByRole("dialog", { name: ui("properties.discard.title") });
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("Fenn");
  await page.getByRole("option").filter({ hasText: "Fenn" }).first().click();
  await expect(leaveDialog).toBeVisible();
  await leaveDialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(page).toHaveURL(new RegExp(`${NPC_URL}$`));
  await expect(profileField(page, "properties.npc.voice.label")).toHaveValue(
    "A voice that is never saved",
  );

  // Discarding goes on to the other npc, which opens in its reading view.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("Fenn");
  await page.getByRole("option").filter({ hasText: "Fenn" }).first().click();
  await leaveDialog.getByRole("button", { name: ui("common.discard") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/fenn$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fenn");
  await expect(nameInput(page)).toHaveCount(0);
  expect(await npcSplit(api)).toEqual(before);

  // Back on the first npc: the reading view, never an edit mode seeded anew.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  await expect(nameInput(page)).toHaveCount(0);
});

test("the npc's PATCH: a stale rev is a 409 with the npc, an unknown field a 400 naming it", async ({
  api,
}) => {
  const patch = (body: unknown) =>
    api.fetch(npcPath(api, NPC), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const before = await getNpc(api, NPC);
  // A second writer moves the row …
  const moved = await patchNpc(api, NPC, { voice: "hoarse from the wind" });
  expect(moved.rev).toBe(before.rev + 1);

  // … so the token read before it is stale: 409, nothing written, and the
  // answer carries the npc as it stands now.
  const stale = await patch({ rev: before.rev, role: "Nobody any more" });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "rev_conflict", rev: moved.rev, npc: moved });
  expect(await getNpc(api, NPC)).toEqual(moved);

  // A key that is no field of an npc is a 400 that names it, and writes
  // nothing either.
  const unknown = await patch({ rev: moved.rev, title: "Harbour master" });
  expect(unknown.status).toBe(400);
  expect(((await unknown.json()) as { error: string }).error).toContain('"title"');
  expect(await getNpc(api, NPC)).toEqual(moved);
});

// Critical path 8's width: the phone. The chips wrap, the profile is one line
// until it is opened, and the save actions are at the bottom of the screen.
// Nothing scrolls sideways.
test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** How far the page scrolls sideways — nothing at all is the rule. */
  async function overflow(page: Page): Promise<number> {
    return page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  }

  test("chips, a sheet per field, the profile and the save at the bottom", async ({
    page,
    api,
  }) => {
    const before = await npcSplit(api);
    const voice = "hoarse, and quieter than before";
    await openEditMode(page);

    // Three chips — all of them stand, so there is no list of the rest.
    for (const key of ["quickstats", "statblock", "chapter"]) await expect(chip(page, key)).toBeVisible();
    await expect(page.getByTestId("field-chip-all")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    // The save sits at the bottom of the screen.
    const save = saveButton(page);
    const box = await save.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(844 - 80);

    // A chip opens its field as a sheet with its own done action.
    await chip(page, "statblock").click();
    const statblock = page.getByRole("dialog", { name: ui("properties.npc.statblock.label") });
    await expect(statblock).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await statblock.getByRole("button", { name: ui("editMode.done") }).click();
    await expect(statblock).toHaveCount(0);

    // The closed profile is one line; open, its fields stand in the column.
    const toggle = profileToggle(page);
    expect((await toggle.boundingBox())?.height ?? Infinity).toBeLessThan(60);
    await openProfile(page);
    await profileField(page, "properties.npc.voice.label").fill(voice);
    expect(await overflow(page)).toBeLessThanOrEqual(1);

    await expect(page.getByText(ui("editMode.changes", { count: 1 })).first()).toBeVisible();
    await save.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);

    const after = await npcSplit(api);
    expect(after.fields).toEqual({ ...before.fields, voice });
    expect(after.body).toBe(before.body);
  });
});
