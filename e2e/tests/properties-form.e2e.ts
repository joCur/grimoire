// Critical path 7: the fields dialog of a location and a chapter — one dialog
// per entity over all of its typed fields, including the 409 conflict. It
// also touches path 2 (the reading view must show the new values the moment
// the dialog closes) and path 8 (the dialog has to be usable at 390px). A
// scene and an npc have no such dialog: their fields are edited in their edit
// modes (tests/scene-edit-mode.e2e.ts, tests/npc-edit-mode.e2e.ts). See
// CLAUDE.md.
//
// The sibling spec on this path is tests/status-control.e2e.ts: the status
// control patches ONE key, this dialog patches any of them. What makes the
// dialog the harder case, and what this spec is about:
//
//   1. It is a PATCH, not a write of the whole row. Only the fields the DM
//      actually changed may travel — a field the dialog knows but the DM did
//      not touch, and the whole body, have to come out of a save untouched.
//   2. The conflict is DETERMINISTIC here, unlike the status control: the
//      dialog freezes the rev it opened with on purpose, so the ~5s version
//      poll cannot heal the staleness while the DM types. No retry loop.
//   3. Everything the save uses is frozen at open, so the dialog belongs to
//      ONE row: a navigation under the open modal (⌘K works over it) has to
//      close it, or the next save writes row A's change into row B. And what
//      is typed does not vanish without a question.
//
// Elements are found by role and catalog key (decisions/testing). Every
// assertion about stored state reads the row back through the API. An
// external change means a SECOND WRITER through the same API, which is what
// bumps the row's guard token.

import type { Locator, Page } from "@playwright/test";

import { getLocation, patchLocation } from "../support/location";
import { getScene, scenePath } from "../support/scene";
import { expect, test } from "../support/test";
import { ui } from "../support/ui";

const SCENE = "lighthouse-arrival";
const LOCATION = "leuchtturm";
const LOCATION_URL = `/campaigns/beispiel/locations/${LOCATION}`;
const LOCATION_NAME = "Der Leuchtturm von Salzhafen";
/** The other location of the example campaign. */
const OTHER_LOCATION = "bucht";
const OTHER_LOCATION_NAME = "Die Nordbucht";

/** The name of an entity's fields dialog. */
function dialogName(kind: "kind.location" | "kind.chapter"): string {
  return ui("properties.title", { kind: ui(kind) });
}

/** The label of a field that cannot be emptied — it carries the marker that says so. */
function requiredLabel(key: "properties.location.name.label"): string {
  return `${ui(key)}${ui("properties.field.required")}`;
}

/** Open the header's fields action and hand back the dialog. */
async function openProperties(page: Page, kind: "kind.location" | "kind.chapter") {
  await page.getByRole("button", { name: ui("properties.action") }).click();
  const dialog = page.getByRole("dialog", { name: dialogName(kind) });
  await expect(dialog).toBeVisible();
  return dialog;
}

function saveButton(dialog: Locator) {
  // exact: the conflict line's "save anyway" contains the same word.
  return dialog.getByRole("button", { name: ui("common.save"), exact: true });
}

/** The location's name field in its dialog. */
function nameField(dialog: Locator) {
  return dialog.getByLabel(requiredLabel("properties.location.name.label"), { exact: true });
}

/** The dialog's conflict line with its two actions — the only alert of the app. */
function conflict(dialog: Locator) {
  const line = dialog.getByRole("alert");
  return {
    line,
    reload: line.getByRole("button", { name: ui("editConflict.reload") }),
    force: line.getByRole("button", { name: ui("editConflict.force") }),
  };
}

test("a location's dialog: a second writer is the conflict line, and a forced save keeps the text", async ({
  page,
  api,
}) => {
  // The location is its own resource (decisions/resources): its dialog writes the
  // location's PATCH, fields flat, against the location's `rev`.
  const before = await getLocation(api, LOCATION);
  const theirs = "\n## Who is here\n\nChanged by a second writer.\n";
  const roll20 = "Lighthouse (night)";

  await page.goto(LOCATION_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);
  const dialog = await openProperties(page, "kind.location");
  await dialog.getByLabel(ui("properties.location.roll20.label")).fill(roll20);

  // The second writer touches only the TEXT.
  await patchLocation(api, LOCATION, { body: theirs });

  await saveButton(dialog).click();
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  // Nothing was written by the refused save.
  expect((await getLocation(api, LOCATION)).roll20Page).toBe(before.roll20Page);

  // Forcing writes the dialog's field on top of the row as it stands — the
  // text it never saw survives.
  await conflicted.force.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getLocation(api, LOCATION)).roll20Page).toBe(roll20);
  const after = await getLocation(api, LOCATION);
  expect(after.body).toBe(theirs);
  expect(after.name).toBe(before.name);
  expect(after.atmosphere).toBe(before.atmosphere);
  await expect(page.getByRole("article")).toContainText(
    ui("entity.location.roll20", { value: roll20 }),
  );
});

test("a second writer: reloading shows what is stored, and the next save keeps the other text", async ({
  page,
  api,
}) => {
  const before = await getLocation(api, LOCATION);
  const theirName = "The lighthouse (renamed elsewhere)";
  const theirs = "\n## Who is here\n\nChanged by a second writer.\n";
  const roll20 = "Lighthouse, after the reload";

  await page.goto(LOCATION_URL);
  const dialog = await openProperties(page, "kind.location");
  const roll20Field = dialog.getByLabel(ui("properties.location.roll20.label"));
  await roll20Field.fill("A page that is never written");

  // A second writer changes name AND body under the open dialog — in ONE
  // request, because that is what the location's one write path is.
  await patchLocation(api, LOCATION, { name: theirName, body: theirs });
  await saveButton(dialog).click();

  // Refused: the typed value stays, nothing was written.
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();
  await expect(roll20Field).toHaveValue("A page that is never written");
  await expect(nameField(dialog)).toHaveValue(LOCATION_NAME);
  const stored = await getLocation(api, LOCATION);
  expect(stored.roll20Page).toBe(before.roll20Page);
  expect(stored.name).toBe(theirName);

  // Reloading shows the CURRENT values and writes nothing on the way.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(nameField(dialog)).toHaveValue(theirName);
  await expect(roll20Field).toHaveValue(String(before.roll20Page));
  expect(await getLocation(api, LOCATION)).toEqual(stored);

  // From the adopted version the DM's change saves in one click, and it is
  // still a patch of the dialog's fields only: the other writer's text stays.
  await roll20Field.fill(roll20);
  await saveButton(dialog).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getLocation(api, LOCATION)).roll20Page).toBe(roll20);
  const after = await getLocation(api, LOCATION);
  expect(after.name).toBe(theirName);
  expect(after.body).toBe(theirs);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(theirName);
});

test("a rejected save shows the SERVER sentence, not the generic one", async ({ page }) => {
  // The shared write layer answers a non-conflict rejection with the sentence
  // for the server's code: an unknown chapter is one of the reference
  // refusals, and the app builds its sentence from the code (decisions/constraints).
  await page.goto(LOCATION_URL);
  const dialog = await openProperties(page, "kind.location");
  const chapter = dialog.getByLabel(ui("properties.location.chapter.label"));
  await chapter.fill("99-nowhere");
  await saveButton(dialog).click();

  // The catalog sentence for the code, and the dialog stays open on the
  // typed value.
  await expect(
    dialog.getByText(ui("server.chapter_unknown", { value: "99-nowhere" })),
  ).toBeVisible();
  await expect(dialog.getByText(ui("write.properties.failed"))).toHaveCount(0);
  await expect(chapter).toHaveValue("99-nowhere");
});

test("clearing a field deletes the key instead of writing an empty value", async ({
  page,
  api,
}) => {
  const before = await getLocation(api, LOCATION);
  expect(before.roll20Page).toBe("Leuchtturm");

  await page.goto(LOCATION_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);
  const dialog = await openProperties(page, "kind.location");

  // An emptied input clears its field.
  await dialog.getByLabel(ui("properties.location.roll20.label")).fill("");
  await saveButton(dialog).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article")).not.toContainText(
    ui("entity.location.roll20", { value: "Leuchtturm" }),
  );

  // In the stored row the page is GONE, not an empty string, and every other
  // field stands, the body byte-identical.
  await expect
    .poll(async () => Object.hasOwn(await getLocation(api, LOCATION), "roll20Page"))
    .toBe(false);
  const { rev: _before, roll20Page: _cleared, ...rest } = before;
  const { rev: _after, ...after } = await getLocation(api, LOCATION);
  expect(after).toEqual(rest);
});

test("cancel and Esc ask before they throw typed values away", async ({ page, api }) => {
  const before = await getLocation(api, LOCATION);
  const discard = page.getByRole("dialog", { name: ui("properties.discard.title") });

  await page.goto(LOCATION_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);

  // Nothing typed, nothing to lose: the cancel action is immediate.
  let dialog = await openProperties(page, "kind.location");
  await dialog.getByRole("button", { name: ui("common.cancel") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // With something typed, Esc asks first — and keeping on editing keeps it.
  dialog = await openProperties(page, "kind.location");
  const roll20 = dialog.getByLabel(ui("properties.location.roll20.label"));
  await roll20.fill("A page that is never saved");
  await page.keyboard.press("Escape");
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(discard).toHaveCount(0);
  await expect(roll20).toHaveValue("A page that is never saved");

  // Cancelling asks the same question, and discarding closes everything.
  await dialog.getByRole("button", { name: ui("common.cancel") }).click();
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: ui("common.discard") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The reading view is as it was, and nothing was written.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);
  expect(await getLocation(api, LOCATION)).toEqual(before);
});

test("navigating away closes the dialog — no change of location A lands in location B", async ({
  page,
  api,
}) => {
  const location = await getLocation(api, LOCATION);
  const roll20 = "North cove, saved after the ⌘K navigation";

  await page.goto(LOCATION_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);

  // Type into the first location's dialog, then leave it WITHOUT closing it:
  // the ⌘K hotkey is a window listener, so the palette opens over the modal
  // and navigates the route underneath it — a click path, not a theory.
  const firstDialog = await openProperties(page, "kind.location");
  await nameField(firstDialog).fill("A name that must never be written");
  await page.keyboard.press("ControlOrMeta+KeyK");
  const search = page.getByRole("combobox");
  await expect(search).toBeFocused();
  await search.fill("Nordbucht");
  await page.getByRole("option").filter({ hasText: OTHER_LOCATION_NAME }).first().click();
  await expect(page).toHaveURL(new RegExp(`/campaigns/beispiel/locations/${OTHER_LOCATION}$`));

  // The dialog is gone with its location — it may not stand over another
  // reading view, holding the frozen values (and the rev) of the one it left.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(OTHER_LOCATION_NAME);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // And the other location's own dialog opens fresh: no carried-over change.
  const otherDialog = await openProperties(page, "kind.location");
  await expect(nameField(otherDialog)).toHaveValue(OTHER_LOCATION_NAME);
  await expect(saveButton(otherDialog)).toBeDisabled();

  // A save from here writes THIS location only.
  await otherDialog.getByLabel(ui("properties.location.roll20.label")).fill(roll20);
  await saveButton(otherDialog).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(async () => (await getLocation(api, OTHER_LOCATION)).roll20Page).toBe(roll20);
  expect(await getLocation(api, LOCATION)).toEqual(location);
});

test("location and chapter have the dialog — a scene and an npc edit in place, the campaign brings its own", async ({
  page,
}) => {
  // The entities with a fields dialog offer it, each on its own route
  // (decisions/resources) …
  const withDialog: [string, string, "kind.location" | "kind.chapter"][] = [
    ["locations/leuchtturm", LOCATION_NAME, "kind.location"],
    ["chapters/01-salzhafen", "Kapitel 1: Der Leuchtturm von Salzhafen", "kind.chapter"],
  ];
  for (const [route, heading, kind] of withDialog) {
    await page.goto(`/campaigns/beispiel/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    const dialog = await openProperties(page, kind);
    // Clean exit — nothing changed, nothing written.
    await dialog.getByRole("button", { name: ui("common.cancel") }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // … a scene and an npc do not: their fields are part of their edit modes.
  for (const [route, heading] of [
    ["scenes/smuggler-captured", "Von den Schmugglern erwischt"],
    ["npcs/fenn", "Fenn"],
  ] as const) {
    await page.goto(`/campaigns/beispiel/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByRole("button", { name: ui("common.edit"), exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: ui("properties.action") })).toHaveCount(0);
  }

  // The campaign's route is the chapter overview, and its one edit action in
  // the header opens its own dialog over name, description and text.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);
  await page.getByRole("button", { name: ui("common.edit"), exact: true }).click();
  await expect(page.getByRole("dialog", { name: ui("campaignEdit.title") })).toBeVisible();
});

test("a status outside the closed list is refused and writes nothing", async ({ api }) => {
  // The four status columns and the scene type are CHECK constraints of their
  // columns (decisions/constraints), so the scene's write refuses a foreign
  // value with a 400 and its own code instead of letting SQLite fail. The
  // edit mode can only ever offer the allowed positions — this asserts the
  // rule on the endpoint, which is what protects the column against the
  // generator and a direct write as well.
  const current = await getScene(api, SCENE);
  const response = await api.fetch(scenePath(api, SCENE), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: current.rev, status: "half-done" }),
  });
  expect(response.status).toBe(400);
  // The body carries what the sentence in the app needs: which column, the
  // value that was written, and the positions in column order.
  expect(await response.json()).toMatchObject({
    code: "status_not_allowed",
    kind: "scene",
    value: "half-done",
    allowed: ["draft", "ready", "played", "dropped"],
  });
  // A refusal writes nothing — no field moved, and the guard token stands.
  expect(await getScene(api, SCENE)).toEqual(current);
});

// Critical path 8: the same dialog at phone size.
test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the fields dialog opens, edits and saves at phone size", async ({ page, api }) => {
    const before = await getLocation(api, LOCATION);
    const name = "The lighthouse at night";

    await page.goto(LOCATION_URL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);

    const dialog = await openProperties(page, "kind.location");
    // Nothing may scroll the page sideways while the dialog stands.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await nameField(dialog).fill(name);
    await saveButton(dialog).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

    await expect.poll(async () => (await getLocation(api, LOCATION)).name).toBe(name);
    const after = await getLocation(api, LOCATION);
    expect(after.roll20Page).toBe(before.roll20Page);
    expect(after.body).toBe(before.body);
  });
});
