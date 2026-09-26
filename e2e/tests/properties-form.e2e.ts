// Critical path 7: the fields dialog of an npc, a location and a chapter —
// one dialog per entity over all of its typed fields, including the 409
// conflict. It also touches path 2 (the reading view must show the new values
// the moment the dialog closes) and path 8 (the dialog has to be usable at
// 390px). A scene has no such dialog: its fields are edited in its edit mode
// (tests/scene-edit-mode.e2e.ts). See CLAUDE.md.
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
//      is typed does not vanish without a question — neither on Esc nor in an
//      unfinished quickstat row.
//
// Elements are found by role and catalog key (decisions/testing). Every
// assertion about stored state reads the row back through the API. An
// external change means a SECOND WRITER through the same API, which is what
// bumps the row's guard token.

import type { Locator, Page } from "@playwright/test";

import { getLocation, patchLocation } from "../support/location";
import { getNpc, npcPath, patchNpc } from "../support/npc";
import { getScene, scenePath } from "../support/scene";
import { expect, test } from "../support/test";
import { ui } from "../support/ui";

const SCENE = "lighthouse-arrival";
/** The npc of the example campaign the npc cases edit — its own resource (decisions/resources). */
const NPC = "jorna";
const NPC_URL = `/campaigns/beispiel/npcs/${NPC}`;
const NPC_NAME = "Hafenmeisterin Jorna";
const LOCATION = "leuchtturm";
const LOCATION_URL = `/campaigns/beispiel/locations/${LOCATION}`;
const LOCATION_NAME = "Der Leuchtturm von Salzhafen";

/** The name of an entity's fields dialog. */
function dialogName(kind: "kind.npc" | "kind.location" | "kind.chapter"): string {
  return ui("properties.title", { kind: ui(kind) });
}

/** The label of a field that cannot be emptied — it carries the marker that says so. */
function requiredLabel(key: "properties.npc.name.label"): string {
  return `${ui(key)}${ui("properties.field.required")}`;
}

/** Open the header's fields action and hand back the dialog. */
async function openProperties(page: Page, kind: "kind.npc" | "kind.location" | "kind.chapter") {
  await page.getByRole("button", { name: ui("properties.action") }).click();
  const dialog = page.getByRole("dialog", { name: dialogName(kind) });
  await expect(dialog).toBeVisible();
  return dialog;
}

function saveButton(dialog: Locator) {
  // exact: the conflict line's "save anyway" contains the same word.
  return dialog.getByRole("button", { name: ui("common.save"), exact: true });
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

test("an npc's dialog: a second writer is the conflict line, and a forced save keeps the text", async ({
  page,
  api,
}) => {
  // The npc is its own resource (decisions/resources): its dialog writes the npc's
  // PATCH, fields flat, against the npc's `rev`.
  const before = await getNpc(api, NPC);
  const theirs = "\n## Knows\n\nChanged by a second writer.\n";
  const role = "Harbour master, at odds with the council";

  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  const dialog = await openProperties(page, "kind.npc");
  await dialog.getByLabel(ui("properties.npc.role.label")).fill(role);

  // The second writer touches only the TEXT.
  await patchNpc(api, NPC, { body: theirs });

  await saveButton(dialog).click();
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  // Nothing was written by the refused save.
  expect((await getNpc(api, NPC)).role).toBe(before.role);

  // Forcing writes the dialog's field on top of the row as it stands — the
  // text it never saw survives.
  await conflicted.force.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getNpc(api, NPC)).role).toBe(role);
  const after = await getNpc(api, NPC);
  expect(after.body).toBe(theirs);
  expect(after.name).toBe(before.name);
  expect(after.motivation).toBe(before.motivation);
  expect(after.quickstats).toEqual(before.quickstats);
  await expect(page.getByRole("article")).toContainText(role);
});

test("a second writer: reloading shows what is stored, and the next save keeps the other text", async ({
  page,
  api,
}) => {
  const before = await getNpc(api, NPC);
  const theirName = "Harbour master Jorna (renamed elsewhere)";
  const theirs = "\n## Knows\n\nChanged by a second writer.\n";
  const role = "Harbour master, after the reload";

  await page.goto(NPC_URL);
  const dialog = await openProperties(page, "kind.npc");
  const roleField = dialog.getByLabel(ui("properties.npc.role.label"));
  const nameField = dialog.getByLabel(requiredLabel("properties.npc.name.label"), { exact: true });
  await roleField.fill("A role that is never written");

  // A second writer changes name AND body under the open dialog — in ONE
  // request, because that is what the npc's one write path is.
  await patchNpc(api, NPC, { name: theirName, body: theirs });
  await saveButton(dialog).click();

  // Refused: the typed value stays, nothing was written.
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();
  await expect(roleField).toHaveValue("A role that is never written");
  await expect(nameField).toHaveValue(NPC_NAME);
  const stored = await getNpc(api, NPC);
  expect(stored.role).toBe(before.role);
  expect(stored.name).toBe(theirName);

  // Reloading shows the CURRENT values and writes nothing on the way.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(nameField).toHaveValue(theirName);
  await expect(roleField).toHaveValue(String(before.role));
  expect(await getNpc(api, NPC)).toEqual(stored);

  // From the adopted version the DM's change saves in one click, and it is
  // still a patch of the dialog's fields only: the other writer's text stays.
  await roleField.fill(role);
  await saveButton(dialog).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getNpc(api, NPC)).role).toBe(role);
  const after = await getNpc(api, NPC);
  expect(after.name).toBe(theirName);
  expect(after.body).toBe(theirs);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(theirName);
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

test("a rejected save shows the SERVER sentence, not the generic one", async ({ page }) => {
  // The shared write layer answers a non-conflict rejection with the sentence
  // for the server's code: an unknown chapter is one of the reference
  // refusals, and the app builds its sentence from the code (decisions/constraints).
  await page.goto(NPC_URL);
  const dialog = await openProperties(page, "kind.npc");
  const chapter = dialog.getByLabel(ui("properties.npc.chapter.label"));
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
  const before = await getNpc(api, NPC);
  expect(before.statblock).toBe("Roll20: Jorna");

  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  const dialog = await openProperties(page, "kind.npc");

  // An emptied input clears its field.
  await dialog.getByLabel(ui("properties.npc.statblock.label")).fill("");
  await saveButton(dialog).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("article")).not.toContainText(
    ui("entity.npc.statblock", { value: "Roll20: Jorna" }),
  );

  // In the stored row the statblock is GONE, not an empty string, and every
  // other field stands, the body byte-identical.
  await expect.poll(async () => Object.hasOwn(await getNpc(api, NPC), "statblock")).toBe(false);
  const { rev: _before, statblock: _cleared, ...rest } = before;
  const { rev: _after, ...after } = await getNpc(api, NPC);
  expect(after).toEqual(rest);
});

test("npc fields: role, status and a quickstat round-trip into the header", async ({
  page,
  api,
}) => {
  const before = await getNpc(api, NPC);
  const role = "Patron, on the council since the autumn";

  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);

  const dialog = await openProperties(page, "kind.npc");
  // The id is context, not a field: it is fixed at creation.
  await expect(dialog).toContainText(NPC);
  // The npc's dialog has its own field list — the scene's keys are not in it.
  await expect(dialog.getByLabel(ui("properties.scene.tags.label"))).toHaveCount(0);
  await expect(dialog.getByLabel(ui("properties.npc.role.label"))).toHaveValue(String(before.role));

  // An npc always has a status (its column is NOT NULL): the select offers
  // the four values and no empty choice.
  const status = dialog.getByLabel(ui("properties.npc.status.label"));
  await expect(status).toHaveValue("alive");
  await expect(status.locator("option")).toHaveText([
    ui("status.npc.alive"),
    ui("status.npc.dead"),
    ui("status.npc.missing"),
    ui("status.npc.unknown"),
  ]);
  await expect(status.locator('option[value=""]')).toHaveCount(0);

  await dialog.getByLabel(ui("properties.npc.role.label")).fill(role);
  await status.selectOption("missing");
  // Quickstats are free key/value rows — jorna has two, this is the third.
  const save = saveButton(dialog);
  const quickstats = ui("properties.npc.quickstats.label");
  await dialog.getByRole("button", { name: ui("properties.field.addRow") }).click();
  const statName = dialog.getByLabel(ui("properties.field.row.name.aria", { label: quickstats, row: 3 }));
  const statValue = dialog.getByLabel(
    ui("properties.field.row.value.aria", { label: quickstats, row: 3 }),
  );
  // A row that cannot be written blocks the save and says why — silently
  // dropping it (a value with no name) or silently swallowing the first of two
  // rows with the SAME name would both lose what the DM typed.
  await statValue.fill("+1");
  await expect(dialog.getByText(ui("properties.issue.namelessRow"))).toBeVisible();
  await expect(save).toBeDisabled();
  await statName.fill("insight");
  await expect(dialog.getByText(ui("properties.issue.duplicateName", { name: "insight" }))).toBeVisible();
  await expect(save).toBeDisabled();
  await statName.fill("deception");
  await expect(dialog.getByText(ui("properties.issue.namelessRow"))).toHaveCount(0);
  // Enter in a quickstat cell is NOT the form's submit: the dialog would save
  // and close in the middle of typing the next stat.
  await statName.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(ui("properties.npc.role.label"))).toHaveValue(role);
  await expect(save).toBeEnabled();
  await save.click();

  // The npc header carries all three.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const article = page.getByRole("article");
  await expect(article).toContainText(role);
  await expect(article).toContainText(ui("status.npc.missing"));
  await expect(article).toContainText("deception +1");
  // Untouched header values stand.
  await expect(article).toContainText(String(before.voice));
  await expect(article).toContainText(ui("entity.npc.statblock", { value: "Roll20: Jorna" }));

  await expect.poll(async () => (await getNpc(api, NPC)).status).toBe("missing");
  const after = await getNpc(api, NPC);
  expect(after.role).toBe(role);
  // A DM-typed relative value stays the STRING it was typed as; the numbers
  // already stored stay numbers.
  expect(after.quickstats).toEqual({ insight: 2, "passive-perception": 12, deception: "+1" });
  expect(after.id).toBe(NPC);
  expect(after.name).toBe(NPC_NAME);
  expect(after.voice).toBe(before.voice);
  expect(after.body).toBe(before.body);
});

test("cancel and Esc ask before they throw typed values away", async ({ page, api }) => {
  const before = await getNpc(api, NPC);
  const discard = page.getByRole("dialog", { name: ui("properties.discard.title") });

  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);

  // Nothing typed, nothing to lose: the cancel action is immediate.
  let dialog = await openProperties(page, "kind.npc");
  await dialog.getByRole("button", { name: ui("common.cancel") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // With something typed, Esc asks first — and keeping on editing keeps it.
  dialog = await openProperties(page, "kind.npc");
  const role = dialog.getByLabel(ui("properties.npc.role.label"));
  await role.fill("A role that is never saved");
  await page.keyboard.press("Escape");
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(discard).toHaveCount(0);
  await expect(role).toHaveValue("A role that is never saved");

  // Cancelling asks the same question, and discarding closes everything.
  await dialog.getByRole("button", { name: ui("common.cancel") }).click();
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: ui("common.discard") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The reading view is as it was, and nothing was written.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  expect(await getNpc(api, NPC)).toEqual(before);
});

test("navigating away closes the dialog — no change of location A lands in npc B", async ({
  page,
  api,
}) => {
  const location = await getLocation(api, LOCATION);
  const role = "Patron, saved after the ⌘K navigation";

  await page.goto(LOCATION_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LOCATION_NAME);

  // Type into the LOCATION's dialog, then leave the location WITHOUT closing
  // it: the ⌘K hotkey is a window listener, so the palette opens over the
  // modal and navigates the route underneath it — a click path, not a theory.
  const locationDialog = await openProperties(page, "kind.location");
  await locationDialog
    .getByLabel(ui("properties.location.name.label"))
    .fill("A name that must never be written");
  await page.keyboard.press("ControlOrMeta+KeyK");
  const search = page.getByRole("combobox");
  await expect(search).toBeFocused();
  await search.fill("Hafenmeisterin");
  await page.getByRole("option").filter({ hasText: NPC_NAME }).first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/jorna$/);

  // The dialog is gone with its location — it may not stand over another
  // reading view, holding the frozen values (and the rev) of the one it left.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // And the npc's own dialog opens fresh: its fields, no carried-over change.
  const npcDialog = await openProperties(page, "kind.npc");
  await expect(npcDialog.getByLabel(ui("properties.location.roll20.label"))).toHaveCount(0);
  await expect(npcDialog.getByLabel(requiredLabel("properties.npc.name.label"), { exact: true })).toHaveValue(
    NPC_NAME,
  );
  await expect(saveButton(npcDialog)).toBeDisabled();

  // A save from here writes THIS npc only.
  await npcDialog.getByLabel(ui("properties.npc.role.label")).fill(role);
  await saveButton(npcDialog).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(async () => (await getNpc(api, NPC)).role).toBe(role);
  expect(await getLocation(api, LOCATION)).toEqual(location);
});

test("npc, location and chapter have the dialog — a scene edits in place, the campaign brings its own", async ({
  page,
}) => {
  // The entities with a fields dialog offer it, each on its own route
  // (decisions/resources) …
  const withDialog: [string, string, "kind.npc" | "kind.location" | "kind.chapter"][] = [
    ["npcs/fenn", "Fenn", "kind.npc"],
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

  // … a scene does not: its fields are part of its edit mode.
  await page.goto("/campaigns/beispiel/scenes/smuggler-captured");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Von den Schmugglern erwischt");
  await expect(page.getByRole("button", { name: ui("properties.action") })).toHaveCount(0);

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

// Critical path 8: the same dialog at phone size. It is where the DM types
// more than one field of an npc, so it has to work here.
test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the fields dialog opens, edits and saves at phone size", async ({ page, api }) => {
    const before = await getNpc(api, NPC);
    const name = "Harbour master Jorna at night";

    await page.goto(NPC_URL);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_NAME);

    const dialog = await openProperties(page, "kind.npc");
    // Nothing may scroll the page sideways while the dialog stands.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await dialog.getByLabel(requiredLabel("properties.npc.name.label"), { exact: true }).fill(name);
    await saveButton(dialog).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);

    await expect.poll(async () => (await getNpc(api, NPC)).name).toBe(name);
    const after = await getNpc(api, NPC);
    expect(after.status).toBe(before.status);
    expect(after.body).toBe(before.body);
  });
});
