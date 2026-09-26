// Critical path 7: the properties patch from the app, here through the
// properties form — one dialog per entity kind over ALL typed fields,
// including the 409 conflict. It also touches path 2 (the reading view must
// show the new values the moment the dialog closes) and path 8 (the form has
// to be usable at 390px). See CLAUDE.md.
//
// The sibling spec on this path is tests/status-control.e2e.ts: the status
// control patches ONE key, this form patches any of them. Two things make the
// form the harder case and are what this spec is about:
//
//   1. It is a PATCH, not a write of the whole row. Only the fields the DM
//      actually changed may travel — a field the form knows but the DM did not
//      touch, and the whole body, have to come out of a save untouched.
//   2. The conflict is DETERMINISTIC here, unlike the status control: the
//      dialog freezes the rev it opened with on purpose, so the ~5s version
//      poll cannot heal the staleness while the DM types. No retry loop.
//   3. Everything the save uses is frozen at open, so the dialog belongs to
//      ONE row: a navigation under the open modal (⌘K works over it) has to
//      close it, or the next save writes row A's diff onto row B. And
//      what is typed does not vanish without a question — neither on Esc nor
//      in an unfinished quickstat row.
//
// Every assertion reads the row back through the API — what the UI shows
// and what the database holds are checked separately. An external change
// means a SECOND WRITER through the same API, which is what bumps the row's
// guard token.

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { getLocation, locationExists, patchLocation } from "../support/location";
import { getNpc, npcPath, patchNpc } from "../support/npc";
import { getScene, patchScene, scenePath } from "../support/scene";
import { getSession } from "../support/session";

const SCENE = "lighthouse-arrival";
const SCENE_URL = `/campaigns/beispiel/scenes/${SCENE}`;
/** The npc of the example campaign the npc cases edit — its own resource (decisions/resources). */
const NPC = "jorna";
const NPC_URL = `/campaigns/beispiel/npcs/${NPC}`;
/** The shared conflict line (EditConflict) — the only role="alert" of the app. */
const CONFLICT_LINE = "Inzwischen geändert";

/**
 * Read the scene: its text, and every other field beside it — a field save has
 * to leave the text alone, which is what the assertions look at.
 */
async function sceneSplit(api: Api) {
  const { body, rev: _rev, ...fields } = await getScene(api, SCENE);
  return { fields, body };
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

/** Open the header's properties action and hand back the dialog. */
async function openProperties(page: Page) {
  await page.getByRole("button", { name: "Eigenschaften" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test("scene properties: chips, reference and status land in the scene — nothing else moves", async ({
  page,
  api,
}) => {
  const pristine = await sceneSplit(api);
  // The location the scene is moved into below has to EXIST — a reference
  // names an entry, and nothing is created by naming it (decisions/constraints). Creating
  // one is the app's own path (tested in create.e2e.ts); here it is one call.
  await api.send("POST", "campaigns/beispiel/locations", { name: "Nordbucht" });
  // Entered from the chapter overview, so there is a history entry BEHIND the
  // scene — the step-back assertion after the move below needs one.
  await page.goto("/campaigns/beispiel");
  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // The header action row: the body editor and this form, nothing else.
  const headerActions = page
    .getByRole("article")
    .getByRole("button")
    .filter({ hasText: /^(Bearbeiten|Eigenschaften)$/ });
  await expect(headerActions).toHaveText(["Bearbeiten", "Eigenschaften"]);

  const dialog = await openProperties(page);
  await expect(dialog).toContainText("Szene: Eigenschaften");
  // The id is context, not a field: it is fixed at creation.
  await expect(dialog).toContainText("lighthouse-arrival");
  await expect(dialog.getByRole("button", { name: "id ändern" })).toHaveCount(0);
  await expect(dialog.getByLabel("Titel")).toHaveValue("Ankunft am Leuchtturm");
  await expect(dialog.getByLabel("Status")).toHaveValue("ready");

  // A reference field is a text input with suggestions, and it says what the
  // id it holds resolves to.
  const location = dialog.getByLabel("Ort");
  await expect(location).toHaveValue("leuchtturm");
  await expect(referenceHint(dialog, "Der Leuchtturm von Salzhafen")).toBeVisible();
  // Its suggestions SUGGEST, they do not close the field: the ids that have an
  // entry, offered through a native <datalist>. (No role reaches a datalist
  // option, so this is the one place the spec uses the DOM id the field
  // builds for its list.)
  const suggestions = dialog.locator("#prop-location-options option");
  // The three locations the campaign has: the two of the example data plus
  // the one created above.
  await expect(suggestions).toHaveCount(3);
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

  // An id nothing holds stays typeable, and the hint says the save would be
  // refused — a typo is visible before the click instead of in a toast after
  // it (decisions/constraints).
  await location.fill("gibt-es-nicht");
  await expect(referenceHint(dialog, "Unbekannt — Ort muss existieren.")).toBeVisible();
  await expect(referenceHint(dialog, "Der Leuchtturm von Salzhafen")).toHaveCount(0);
  // The location that exists resolves to its name, and that is the save below.
  await location.fill("nordbucht");
  await expect(referenceHint(dialog, "Nordbucht")).toBeVisible();

  // A CHAPTER says the same thing, and the server answers 400 for it too.
  // Typed and taken back, so the save below stays the one this spec is about.
  const chapter = dialog.getByLabel("Kapitel");
  await chapter.fill("99-nirgendwo");
  await expect(referenceHint(dialog, "Unbekannt — Kapitel muss existieren.")).toBeVisible();
  await chapter.fill("01-salzhafen");

  await dialog.getByLabel("Status").selectOption("draft");
  await expect(save).toBeEnabled();
  await save.click();

  // The dialog closes and the reading view is already on the new values: the
  // patch answers with the written scene and the mutation seeds it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const article = page.getByRole("article");
  await expect(article).toContainText("#stealth");
  await expect(article).toContainText("#nachtszene");
  await expect(article.getByText("Nordbucht", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Entwurf" })).toBeVisible();
  // The scene is reached by its id (decisions/resources): a new location is a field, and
  // the route stays where it is.
  await expect(page).toHaveURL(new RegExp(`${SCENE_URL}$`));

  // The chapter overview does NOT re-sort: the location is a word of the row
  // now, not a group over it (decisions/scene-order). So the row keeps its place in the
  // order and names the new location — with the NAME of the location entry,
  // never its id.
  await page.goto("/campaigns/beispiel");
  const row = page.getByRole("link", { name: /Ankunft am Leuchtturm/ });
  await expect(row).toContainText("Nordbucht");
  await expect(row).not.toContainText("Leuchtturm von Salzhafen");
  await expect(page.getByText("nordbucht", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Nordbucht" })).toHaveCount(0);
  // References resolve over ids, so the session's log rows are untouched — a
  // row still names the scene it was taken in by that id.
  expect((await getSession(api, "2026-01-15")).log.map((row) => row.sceneId)).toContain(
    "lighthouse-arrival",
  );

  // Stored: the three changed fields …
  await expect.poll(() => getScene(api, SCENE)).toHaveProperty("status", "draft");
  const after = await sceneSplit(api);
  expect(after.fields.tags).toEqual(["social", "travel", "stealth", "nachtszene"]);
  expect(after.fields.location).toBe("nordbucht");
  // …and the location it names is untouched: a scene references its group, it
  // never writes it.
  expect((await getLocation(api, "nordbucht")).name).toBe("Nordbucht");
  expect(after.fields.status).toBe("draft");
  // … the untouched ones with their values …
  expect(after.fields).toEqual({
    ...pristine.fields,
    tags: ["social", "travel", "stealth", "nachtszene"],
    location: "nordbucht",
    status: "draft",
  });
  // … and the body untouched, byte for byte.
  expect(after.body).toBe(pristine.body);
});

test("the Ort field reads a name as its id — a missing Ort is refused", async ({
  page,
  api,
}) => {
  // A scene's `location` holds an id — but the DM types a name, and the form
  // reads it as the id it means.
  // What the save cannot do is invent the entry: a reference names something
  // that exists (decisions/constraints), so a name no location holds is refused until that
  // location is there — and then the very same save lands.
  await page.goto(SCENE_URL);
  const dialog = await openProperties(page);
  const ort = dialog.getByLabel("Ort");
  const save = dialog.getByRole("button", { name: "Speichern" });

  // Typing the NAME of an existing location resolves to that location.
  await ort.fill("Leuchtturm");
  await expect(referenceHint(dialog, "Der Leuchtturm von Salzhafen")).toBeVisible();

  // Text no slug can be derived from is blocked by the form itself.
  await ort.fill("???");
  await expect(dialog.getByText('„???“ ergibt keine Orts-Kennung')).toBeVisible();
  await expect(save).toBeDisabled();

  // A name no location holds: typeable, and the hint says it has to exist.
  await ort.fill("Der alte Hafen");
  await expect(referenceHint(dialog, "Unbekannt — Ort muss existieren.")).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();

  // The server refuses it in the UI language, the dialog stays open on what
  // was typed, and NOTHING was written — neither the scene nor a location.
  await expect(
    dialog.getByText('Den Ort „der-alte-hafen“ gibt es nicht — bitte zuerst anlegen.'),
  ).toBeVisible();
  await expect(ort).toHaveValue("Der alte Hafen");
  expect(await locationExists(api, "der-alte-hafen")).toBe(false);
  expect((await getScene(api, SCENE)).location).toBe("leuchtturm");

  // With the location created, the same save lands and the scene names it.
  await api.send("POST", "campaigns/beispiel/locations", { name: "Der alte Hafen" });
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${SCENE_URL}$`));
  await expect.poll(() => getScene(api, SCENE)).toHaveProperty("location", "der-alte-hafen");

  // …and the chapter overview's row names it, with the location's name.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("link", { name: /Ankunft am Leuchtturm/ })).toContainText(
    "Der alte Hafen",
  );
});

test("a rejected save shows the SERVER sentence, not the generic one", async ({ page }) => {
  // The shared write layer answered every non-conflict rejection with its
  // caller's generic wording, so a 400 that names exactly what is wrong was
  // invisible to the DM. An unknown chapter is one of the five reference
  // refusals, and the app builds its sentence from the code (decisions/constraints).
  await page.goto(SCENE_URL);
  const dialog = await openProperties(page);
  await dialog.getByLabel("Kapitel").fill("99-nirgendwo");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  // The catalog sentence for the code, and the dialog stays open on the
  // typed value.
  await expect(
    dialog.getByText('Das Kapitel „99-nirgendwo“ gibt es nicht — bitte zuerst anlegen.'),
  ).toBeVisible();
  await expect(dialog.getByText("Eigenschaften nicht gespeichert")).toHaveCount(0);
  await expect(dialog.getByLabel("Kapitel")).toHaveValue("99-nirgendwo");
});

test("a CLEARED Kapitel blocks the save in the dialog — no round trip", async ({
  page,
  api,
}) => {
  // A scene always belongs to a chapter, so the server refuses a patch that
  // removes it. The form says so under the field and the save button stays
  // disabled, instead of a save that leaves and comes back as a toast.
  await page.goto(SCENE_URL);
  const dialog = await openProperties(page);
  await dialog.getByLabel("Kapitel").fill("");
  await expect(
    dialog.getByText(
      "Eine Szene braucht ein Kapitel — es lässt sich verschieben, aber nicht entfernen.",
    ),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Speichern" })).toBeDisabled();
  // Typing the chapter back takes the line away again (the button stays
  // disabled because there is nothing left to save), and the stored scene
  // never moved.
  await dialog.getByLabel("Kapitel").fill("01-salzhafen");
  await expect(
    dialog.getByText(
      "Eine Szene braucht ein Kapitel — es lässt sich verschieben, aber nicht entfernen.",
    ),
  ).toHaveCount(0);
  expect(await getScene(api, SCENE)).toHaveProperty("chapter", "01-salzhafen");
});

/**
 * The dialog's conflict line with its two actions.
 *
 * "Trotzdem speichern" contains the dialog's own save label, so the save button
 * has to be addressed exactly — otherwise the two match as one.
 */
function conflict(dialog: Locator) {
  const line = dialog.getByRole("alert").filter({ hasText: CONFLICT_LINE });
  return {
    line,
    reload: line.getByRole("button", { name: "Neu laden" }),
    force: line.getByRole("button", { name: "Trotzdem speichern" }),
  };
}

test("a second writer: the dialog offers reloading, and it shows what is stored", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const externalTitle = "Ankunft am Leuchtturm (von Hand)";
  const externalBody = "\n## Flow\n\nVon einem zweiten Schreiber geändert.\n";

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  const dialog = await openProperties(page);

  const tags = dialog.getByLabel("Tags");
  await tags.fill("konflikt");
  await tags.press("Enter");
  await expect(dialog.getByRole("button", { name: "konflikt entfernen" })).toBeVisible();

  // A second writer changes title AND body under the open dialog — in ONE
  // request, because that is what the scene's one write path is. A fresh
  // token, so it succeeds; the dialog holds the version its editing session
  // started from, so the version poll cannot make the DM's write succeed
  // silently.
  await patchScene(api, SCENE, { title: externalTitle, body: externalBody });

  const save = dialog.getByRole("button", { name: "Speichern", exact: true });
  await save.click();

  // Refused, with both answers under the fields that still hold the draft.
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  await expect(conflicted.force).toBeVisible();
  // The dialog stays open and the typed chip survives — that is the point.
  await expect(dialog.getByRole("button", { name: "konflikt entfernen" })).toBeVisible();
  await expect(dialog.getByLabel("Titel")).toHaveValue("Ankunft am Leuchtturm");
  // Nothing was written: the other writer's content stands, untouched.
  const stored = await sceneSplit(api);
  expect(stored.fields.tags).not.toContain("konflikt");
  expect(stored.fields.title).toBe(externalTitle);
  expect(stored.body).toBe(externalBody);

  // Reloading shows the CURRENT values: the external title is in the field, the
  // draft chip is gone, and nothing was written on the way.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(dialog.getByLabel("Titel")).toHaveValue(externalTitle);
  await expect(dialog.getByRole("button", { name: "konflikt entfernen" })).toHaveCount(0);
  expect(await sceneSplit(api)).toEqual(stored);

  // From the adopted version the DM's chip saves in one click, and the save is
  // still a patch of the dialog's fields only: the external body survives.
  await tags.fill("konflikt");
  await tags.press("Enter");
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(async () => (await getScene(api, SCENE)).tags).toContain("konflikt");
  const after = await sceneSplit(api);
  expect(after.fields.tags).toEqual([...(before.fields.tags as string[]), "konflikt"]);
  expect(after.fields.title).toBe(externalTitle);
  expect(after.body).toBe(externalBody);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(externalTitle);
  await expect(page.getByRole("article")).toContainText("#konflikt");
});

test("a forced save writes the dialog's fields only — a concurrent body survives", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const externalBody = "\n## Flow\n\nVon einem zweiten Schreiber geändert.\n";

  await page.goto(SCENE_URL);
  const dialog = await openProperties(page);

  const tags = dialog.getByLabel("Tags");
  await tags.fill("erzwungen");
  await tags.press("Enter");
  await expect(dialog.getByRole("button", { name: "erzwungen entfernen" })).toBeVisible();

  // The second writer touches only the TEXT — the dialog's own fields are not
  // in its request at all.
  await patchScene(api, SCENE, { body: externalBody });

  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();

  // Forcing writes the refused fields on top of the row as it stands. This
  // dialog carries no text, so the body it never saw is untouched.
  await conflicted.force.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(async () => (await getScene(api, SCENE)).tags).toContain("erzwungen");
  const after = await sceneSplit(api);
  expect(after.fields.tags).toEqual([...(before.fields.tags as string[]), "erzwungen"]);
  expect(after.fields.title).toBe(before.fields.title);
  // The assertion this test exists for, read back through the API.
  expect(after.body).toBe(externalBody);
  await expect(page.getByRole("article")).toContainText("#erzwungen");
});

test("a location's dialog: a second writer is the conflict line, and a forced save keeps the text", async ({
  page,
  api,
}) => {
  // The location is its own resource (decisions/resources): its dialog writes the
  // location's PATCH, fields flat, against the location's `rev`.
  const before = await getLocation(api, "leuchtturm");
  const externalBody = "\n## Wer ist hier\n\nVon einem zweiten Schreiber geändert.\n";

  await page.goto("/campaigns/beispiel/locations/leuchtturm");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Der Leuchtturm von Salzhafen");
  const dialog = await openProperties(page);
  await expect(dialog).toContainText("Ort: Eigenschaften");
  await dialog.getByLabel("Roll20-Seite").fill("Leuchtturm (Nacht)");

  // The second writer touches only the TEXT.
  await patchLocation(api, "leuchtturm", { body: externalBody });

  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  // Nothing was written by the refused save.
  expect((await getLocation(api, "leuchtturm")).roll20Page).toBe(before.roll20Page);

  // Forcing writes the dialog's field on top of the row as it stands — the
  // text it never saw survives.
  await conflicted.force.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getLocation(api, "leuchtturm")).roll20Page).toBe(
    "Leuchtturm (Nacht)",
  );
  const after = await getLocation(api, "leuchtturm");
  expect(after.body).toBe(externalBody);
  expect(after.name).toBe(before.name);
  expect(after.atmosphere).toBe(before.atmosphere);
  await expect(page.getByRole("article")).toContainText("Roll20-Seite: Leuchtturm (Nacht)");
});

test("an npc's dialog: a second writer is the conflict line, and a forced save keeps the text", async ({
  page,
  api,
}) => {
  // The npc is its own resource (decisions/resources): its dialog writes the npc's
  // PATCH, fields flat, against the npc's `rev`.
  const before = await getNpc(api, NPC);
  const externalBody = "\n## Weiß\n\nVon einem zweiten Schreiber geändert.\n";
  const role = "Hafenmeisterin, im Streit mit dem Rat";

  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  const dialog = await openProperties(page);
  await expect(dialog).toContainText("NPC: Eigenschaften");
  await dialog.getByLabel("Rolle").fill(role);

  // The second writer touches only the TEXT.
  await patchNpc(api, NPC, { body: externalBody });

  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
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
  expect(after.body).toBe(externalBody);
  expect(after.name).toBe(before.name);
  expect(after.motivation).toBe(before.motivation);
  expect(after.quickstats).toEqual(before.quickstats);
  await expect(page.getByRole("article")).toContainText(role);
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
  const moved = await patchNpc(api, NPC, { voice: "heiser vom Wind" });
  expect(moved.rev).toBe(before.rev + 1);

  // … so the token read before it is stale: 409, nothing written, and the
  // answer carries the npc as it stands now.
  const stale = await patch({ rev: before.rev, role: "Niemand mehr" });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "rev_conflict", rev: moved.rev, npc: moved });
  expect(await getNpc(api, NPC)).toEqual(moved);

  // A key that is no field of an npc is a 400 that names it, and writes
  // nothing either.
  const unknown = await patch({ rev: moved.rev, title: "Hafenmeisterin" });
  expect(unknown.status).toBe(400);
  expect(((await unknown.json()) as { error: string }).error).toContain('"title"');
  expect(await getNpc(api, NPC)).toEqual(moved);
});

test("clearing a field deletes the key instead of writing an empty value", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  expect(before.fields.location).toBe("leuchtturm");
  expect(before.fields.handouts).toEqual(["Karte von Salzhafen"]);

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

  // In the stored row the location is GONE, not an empty string, and the list
  // is empty. (The dialog closes only after the write answered, so the scene
  // is settled here.)
  const after = await sceneSplit(api);
  expect(after.fields.location).toBeUndefined();
  expect(after.fields.handouts).toEqual([]);
  // Everything else stands, the body byte-identical.
  expect(after.fields.tags).toEqual(["social", "travel"]);
  expect(after.fields.status).toBe("ready");
  expect(after.fields.npcs).toEqual(["jorna"]);
  expect(after.body).toBe(before.body);
});

test("NPC properties: role, status and a quickstat round-trip into the header", async ({
  page,
  api,
}) => {
  const before = await getNpc(api, NPC);
  const role = "Auftraggeberin, seit dem Herbst auch im Rat";

  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");

  const dialog = await openProperties(page);
  await expect(dialog).toContainText("NPC: Eigenschaften");
  await expect(dialog).toContainText("jorna");
  // The NPC form has its own field list — the scene's keys are not in it.
  await expect(dialog.getByLabel("Tags")).toHaveCount(0);
  await expect(dialog.getByLabel("Rolle")).toHaveValue(
    "Auftraggeberin, Hafenmeisterin von Salzhafen",
  );

  // An npc always has a status (its column is NOT NULL): the select offers
  // the four values and no empty choice.
  const status = dialog.getByLabel("Status");
  await expect(status).toHaveValue("alive");
  await expect(status.locator("option")).toHaveText([
    "Lebendig",
    "Tot",
    "Vermisst",
    "Unbekannt",
  ]);
  await expect(status.locator('option[value=""]')).toHaveCount(0);

  await dialog.getByLabel("Rolle").fill(role);
  await status.selectOption("missing");
  // Quickstats are free key/value rows — jorna has two, this is the third.
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
  await expect(dialog).toContainText('Name „insight“ doppelt');
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

  await expect.poll(async () => (await getNpc(api, NPC)).status).toBe("missing");
  const after = await getNpc(api, NPC);
  expect(after.role).toBe(role);
  // A DM-typed relative value stays the STRING it was typed as; the numbers
  // already stored stay numbers.
  expect(after.quickstats).toEqual({ insight: 2, "passive-perception": 12, deception: "+1" });
  expect(after.id).toBe("jorna");
  expect(after.name).toBe("Hafenmeisterin Jorna");
  expect(after.voice).toBe("knapp, wetterrau, duzt jeden");
  expect(after.body).toBe(before.body);
});

test("Abbrechen and Esc ask before they throw typed values away", async ({ page, api }) => {
  const before = await sceneSplit(api);

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // Nothing typed, nothing to lose: the cancel action is immediate.
  let dialog = await openProperties(page);
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // With something typed, Esc asks first — and keeping on editing keeps it.
  dialog = await openProperties(page);
  const title = dialog.getByLabel("Titel");
  await title.fill("Ankunft am Leuchtturm, nie gespeichert");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("dialog").filter({ hasText: "Änderungen verwerfen?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(title).toHaveValue("Ankunft am Leuchtturm, nie gespeichert");

  // Cancelling asks the same question, and discarding closes everything.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The reading view is as it was, and nothing was written.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  expect(await sceneSplit(api)).toEqual(before);
});

test("navigating away closes the dialog — no diff of scene A lands in npc B", async ({
  page,
  api,
}) => {
  const scene = await sceneSplit(api);
  const role = "Auftraggeberin, nach der ⌘K-Navigation gespeichert";

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // Type into the SCENE's form, then leave the scene WITHOUT closing it: the
  // ⌘K hotkey is a window listener, so the palette opens over the modal and
  // navigates the route underneath it — this is a click path, not a theory.
  const sceneDialog = await openProperties(page);
  await sceneDialog.getByLabel("Titel").fill("Titel, der nie geschrieben werden darf");
  await page.keyboard.press("ControlOrMeta+KeyK");
  const search = page.getByPlaceholder("Szenen, NPCs, Orte durchsuchen …");
  await expect(search).toBeFocused();
  await search.fill("Hafenmeisterin");
  await page.getByRole("option").filter({ hasText: "Hafenmeisterin Jorna" }).first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/jorna$/);

  // The dialog is gone with its scene — it may not stand over another reading
  // view, holding the frozen values (and the rev) of the one it left.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // And the NPC's own dialog opens fresh: its fields, no carried-over diff.
  const npcDialog = await openProperties(page);
  await expect(npcDialog).toContainText("NPC: Eigenschaften");
  await expect(npcDialog.getByLabel("Titel")).toHaveCount(0);
  // Anchored: the quickstat rows carry a suffixed name label as well.
  await expect(npcDialog.getByLabel(/^Name/)).toHaveValue("Hafenmeisterin Jorna");
  await expect(npcDialog.getByRole("button", { name: "Speichern" })).toBeDisabled();

  // A save from here writes THIS npc only.
  await npcDialog.getByLabel("Rolle").fill(role);
  await npcDialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(async () => (await getNpc(api, NPC)).role).toBe(role);
  expect(await sceneSplit(api)).toEqual(scene);
});

test("Ort and Kapitel have the form too — the campaign brings its own", async ({
  page,
}) => {
  // The four entities with a reading view offer it, each on its own route
  // (decisions/resources) …
  const withForm: [string, string, string][] = [
    ["scenes/smuggler-captured", "Von den Schmugglern erwischt", "Szene"],
    ["npcs/fenn", "Fenn", "NPC"],
    ["locations/leuchtturm", "Der Leuchtturm von Salzhafen", "Ort"],
    ["chapters/01-salzhafen", "Kapitel 1: Der Leuchtturm von Salzhafen", "Kapitel"],
  ];
  for (const [route, heading, kindLabel] of withForm) {
    await page.goto(`/campaigns/beispiel/${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    const dialog = await openProperties(page);
    await expect(dialog).toContainText(`${kindLabel}: Eigenschaften`);
    // Clean exit — nothing changed, nothing written.
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // The lists have no reading view (decisions/resources), so there is none on which a
  // form could be missing.

  // The campaign's route is the chapter overview, and its one edit action in
  // the header opens its own dialog over name, description and text.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Kampagne bearbeiten");
});

test("a status outside the closed list is refused and writes nothing", async ({ api }) => {
  // The four status columns and the scene type are CHECK constraints of their
  // columns (decisions/constraints), so the scene's write refuses a foreign value with a
  // 400 and its own code instead of letting SQLite fail. The form can only
  // ever offer the allowed positions — this asserts the rule on the endpoint,
  // which is what protects the column against the generator and a direct
  // write as well.
  const before = await sceneSplit(api);
  const current = await getScene(api, SCENE);
  const response = await api.fetch(scenePath(api, SCENE), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: current.rev, status: "halbfertig" }),
  });
  expect(response.status).toBe(400);
  // The body carries what the sentence in the app needs: which column, the
  // value that was written, and the positions in column order.
  expect(await response.json()).toMatchObject({
    code: "status_not_allowed",
    kind: "scene",
    value: "halbfertig",
    allowed: ["draft", "ready", "played", "dropped"],
  });
  // A refusal writes nothing — no field moved, and the guard token stands.
  expect(await sceneSplit(api)).toEqual(before);
  expect((await getScene(api, SCENE)).rev).toBe(current.rev);
});

// Critical path 8: the same form at phone size. The dialog is the only place
// in the reading view where the DM types more than one field, so it has to
// work here — the header action row wraps to a second line for it.
test.describe("at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the properties dialog opens, edits and saves at phone size", async ({ page, api }) => {
    const before = await sceneSplit(api);
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

    await expect.poll(() => getScene(api, SCENE)).toHaveProperty("title", title);
    const after = await sceneSplit(api);
    expect(after.fields.status).toBe("ready");
    expect(after.body).toBe(before.body);
  });
});
