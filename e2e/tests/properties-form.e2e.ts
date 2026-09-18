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
//   1. It is a PATCH, not a write of the whole entry. Only the keys the DM
//      actually changed may travel — a key the form knows but the DM did not
//      touch, and the whole body, have to come out of a save untouched.
//   2. The conflict is DETERMINISTIC here, unlike the status control: the
//      dialog freezes the rev it opened with on purpose, so the ~5s version
//      poll cannot heal the staleness while the DM types. No retry loop.
//   3. Everything the save uses is frozen at open, so the dialog belongs to
//      ONE entry: a navigation under the open modal (⌘K works over it) has to
//      close it, or the next save writes entry A's diff onto entry B. And
//      what is typed does not vanish without a question — neither on Esc nor
//      in an unfinished quickstat row.
//
// Every assertion reads the entry back through the API — what the UI shows
// and what the database holds are checked separately. An external change
// means a SECOND WRITER through the same API, which is what bumps the row's
// guard token.

import type { Locator, Page } from "@playwright/test";

import { expect, test, type Api } from "../support/test";

const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";
const SCENE_URL = `/campaigns/beispiel/entries/${SCENE}`;
const NPC = "npcs/jorna";
/** The shared conflict line (EditConflict) — the only role="alert" of the app. */
const CONFLICT_LINE = "Inzwischen geändert";

/** Read the entry: its properties and its text — the two halves every assertion looks at. */
async function split(api: Api, rel: string) {
  const { properties, body } = await api.entry(rel);
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

/** Open the header's properties action and hand back the dialog. */
async function openProperties(page: Page) {
  await page.getByRole("button", { name: "Eigenschaften" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test("scene properties: chips, reference and status land in the entry — nothing else moves", async ({
  page,
  api,
}) => {
  const pristine = await split(api, SCENE);
  // The location the scene is moved into below has to EXIST — a reference
  // names an entry, and nothing is created by naming it (ADR #19). Creating
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
  // The two values the form does NOT own are context, not fields: the id is
  // fixed at creation, the kind comes from the path.
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
  // it (ADR #19).
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
  // patch answers with the written entry and the mutation seeds it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const article = page.getByRole("article");
  await expect(article).toContainText("#stealth");
  await expect(article).toContainText("#nachtszene");
  await expect(article.getByText("Nordbucht", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Entwurf" })).toBeVisible();
  // The location IS the group, so the scene MOVED — and the
  // URL follows it (replace, so a step back does not reach the old address).
  await expect(page).toHaveURL(
    /\/campaigns\/beispiel\/entries\/01-salzhafen\/nordbucht\/lighthouse-arrival$/,
  );
  // The step back must not reach the address the scene just left: the redirect
  // REPLACES the history entry, so the step back is the page the DM came from
  // (the chapter overview), never `…/leuchtturm/lighthouse-arrival` — which would reload,
  // redirect forward again and trap the button.
  await page.goBack();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await page.goForward();
  await expect(page).toHaveURL(
    /\/campaigns\/beispiel\/entries\/01-salzhafen\/nordbucht\/lighthouse-arrival$/,
  );

  // The chapter overview re-sorts: a section for the new location, none for
  // the old one.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 3, name: "Nordbucht" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "Der Leuchtturm von Salzhafen" }),
  ).toHaveCount(0);
  // The old address still names the scene and reports the new one.
  expect((await api.entry(SCENE)).path).toBe("01-salzhafen/nordbucht/lighthouse-arrival");
  // `[[…]]` references resolve over ids, so the session log is untouched.
  expect(await api.body("sessions/2026-01-15")).toContain("lighthouse-arrival");

  // Stored: the three changed fields …
  await expect.poll(() => api.properties(SCENE)).toHaveProperty("status", "draft");
  const after = await split(api, SCENE);
  expect(after.properties.tags).toEqual(["social", "travel", "stealth", "nachtszene"]);
  expect(after.properties.location).toBe("nordbucht");
  // …and the location it names is untouched: a scene references its group, it
  // never writes it.
  expect((await api.entry("locations/nordbucht")).properties.name).toBe("Nordbucht");
  expect(after.properties.status).toBe("draft");
  // … the untouched ones with their values …
  expect(after.properties.id).toBe("lighthouse-arrival");
  expect(after.properties.title).toBe("Ankunft am Leuchtturm");
  expect(after.properties.type).toBe("planned");
  expect(after.properties.chapter).toBe("01-salzhafen");
  expect(after.properties.npcs).toEqual(["jorna"]);
  expect(after.properties.handouts).toEqual(["Karte von Salzhafen"]);
  // … and the body untouched, byte for byte.
  expect(after.body).toBe(pristine.body);
});

test("the Ort field reads a name as its id — a missing Ort is refused", async ({
  page,
  api,
}) => {
  // The group a scene sits under IS its `location`, and the column holds an
  // id — but the DM types a name, and the form reads it as the id it means.
  // What the save cannot do is invent the entry: a reference names something
  // that exists (ADR #19), so a name no location holds is refused until that
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
  // was typed, and NOTHING was written — neither the scene nor an entry.
  await expect(
    dialog.getByText('Den Ort „der-alte-hafen“ gibt es nicht — bitte zuerst anlegen.'),
  ).toBeVisible();
  await expect(ort).toHaveValue("Der alte Hafen");
  expect(await api.exists("locations/der-alte-hafen")).toBe(false);
  expect((await api.properties(SCENE)).location).toBe("leuchtturm");

  // With the location created, the same save lands and the scene moves into it.
  await api.send("POST", "campaigns/beispiel/locations", { name: "Der alte Hafen" });
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(
    /\/campaigns\/beispiel\/entries\/01-salzhafen\/der-alte-hafen\/lighthouse-arrival$/,
  );
  await expect.poll(() => api.properties(SCENE)).toHaveProperty("location", "der-alte-hafen");

  // …and the chapter overview heads the group with the location's name.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 3, name: "Der alte Hafen" })).toBeVisible();
});

test("a rejected save shows the SERVER sentence, not the generic one", async ({ page }) => {
  // The shared write layer answered every non-conflict rejection with its
  // caller's generic wording, so a 400 that names exactly what is wrong was
  // invisible to the DM. An unknown chapter is one of the five reference
  // refusals, and the app builds its sentence from the code (ADR #19).
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
  // A scene's chapter is part of its address, so the server refuses a patch
  // that removes it. The form says so under the field and the save button
  // stays disabled, instead of a save that leaves and comes back as a toast.
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
  expect(await api.properties(SCENE)).toHaveProperty("chapter", "01-salzhafen");
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
  const before = await split(api, SCENE);
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
  // request, because that is what the one write path is (ADR #23). A fresh
  // token, so it succeeds; the dialog holds the version its editing session
  // started from, so the version poll cannot make the DM's write succeed
  // silently.
  await api.patchEntry(SCENE, {
    properties: { title: externalTitle },
    body: externalBody,
  });

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
  const stored = await split(api, SCENE);
  expect(stored.properties.tags).not.toContain("konflikt");
  expect(stored.properties.title).toBe(externalTitle);
  expect(stored.body).toBe(externalBody);

  // Reloading shows the CURRENT values: the external title is in the field, the
  // draft chip is gone, and nothing was written on the way.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(dialog.getByLabel("Titel")).toHaveValue(externalTitle);
  await expect(dialog.getByRole("button", { name: "konflikt entfernen" })).toHaveCount(0);
  expect(await split(api, SCENE)).toEqual(stored);

  // From the adopted version the DM's chip saves in one click, and the save is
  // still a patch of the dialog's fields only: the external body survives.
  await tags.fill("konflikt");
  await tags.press("Enter");
  await save.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(async () => (await api.properties(SCENE)).tags).toContain("konflikt");
  const after = await split(api, SCENE);
  expect(after.properties.tags).toEqual([...(before.properties.tags as string[]), "konflikt"]);
  expect(after.properties.title).toBe(externalTitle);
  expect(after.body).toBe(externalBody);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(externalTitle);
  await expect(page.getByRole("article")).toContainText("#konflikt");
});

test("a forced save writes the dialog's fields only — a concurrent body survives", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const externalBody = "\n## Flow\n\nVon einem zweiten Schreiber geändert.\n";

  await page.goto(SCENE_URL);
  const dialog = await openProperties(page);

  const tags = dialog.getByLabel("Tags");
  await tags.fill("erzwungen");
  await tags.press("Enter");
  await expect(dialog.getByRole("button", { name: "erzwungen entfernen" })).toBeVisible();

  // The second writer touches only the TEXT — the dialog's own fields are not
  // in its request at all.
  await api.writeBody(SCENE, externalBody);

  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  const conflicted = conflict(dialog);
  await expect(conflicted.line).toBeVisible();

  // Forcing writes the refused fields on top of the row as it stands. This
  // dialog carries `properties` only, so the body it never saw is untouched.
  await conflicted.force.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(async () => (await api.properties(SCENE)).tags).toContain("erzwungen");
  const after = await split(api, SCENE);
  expect(after.properties.tags).toEqual([...(before.properties.tags as string[]), "erzwungen"]);
  expect(after.properties.title).toBe(before.properties.title);
  // The assertion this test exists for, read back through the API.
  expect(after.body).toBe(externalBody);
  await expect(page.getByRole("article")).toContainText("#erzwungen");
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

  // In the stored row both keys are GONE, not emptied: no `location` and no
  // empty `handouts` left behind. (The dialog closes only after the write
  // answered, so the entry is settled here.)
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

  await page.goto(`/campaigns/beispiel/entries/${NPC}`);
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

  await expect.poll(() => api.properties(NPC)).toHaveProperty("status", "missing");
  const after = await split(api, NPC);
  expect(after.properties.role).toBe(role);
  // A DM-typed relative value stays the STRING it was typed as; the numbers
  // already stored stay numbers.
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
  expect(await split(api, SCENE)).toEqual(before);
});

test("navigating away closes the dialog — no diff of entry A lands in entry B", async ({
  page,
  api,
}) => {
  const scene = await split(api, SCENE);
  const role = "Auftraggeberin, nach der ⌘K-Navigation gespeichert";

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // Type into the SCENE's form, then leave the entry WITHOUT closing it: the
  // ⌘K hotkey is a window listener, so the palette opens over the modal and
  // navigates the route underneath it — this is a click path, not a theory.
  const sceneDialog = await openProperties(page);
  await sceneDialog.getByLabel("Titel").fill("Titel, der nie geschrieben werden darf");
  await page.keyboard.press("ControlOrMeta+KeyK");
  const search = page.getByPlaceholder("Szenen, NPCs, Orte durchsuchen …");
  await expect(search).toBeFocused();
  await search.fill("Hafenmeisterin");
  await page.getByRole("option").filter({ hasText: "Hafenmeisterin Jorna" }).first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/entries\/npcs\/jorna$/);

  // The dialog is gone with its entry — it may not stand over another entry's
  // reading view, holding the frozen values (and the rev) of the one it left.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // And the NPC's own dialog opens fresh: its fields, no carried-over diff.
  const npcDialog = await openProperties(page);
  await expect(npcDialog).toContainText("NPC: Eigenschaften");
  await expect(npcDialog.getByLabel("Titel")).toHaveCount(0);
  // Anchored: the quickstat rows carry a suffixed name label as well.
  await expect(npcDialog.getByLabel(/^Name/)).toHaveValue("Hafenmeisterin Jorna");
  await expect(npcDialog.getByRole("button", { name: "Speichern" })).toBeDisabled();

  // A save from here writes THIS entry only.
  await npcDialog.getByLabel("Rolle").fill(role);
  await npcDialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expect.poll(() => api.properties(NPC)).toHaveProperty("role", role);
  expect(await split(api, SCENE)).toEqual(scene);
});

test("Ort and Kapitel have the form too — session and inbox do not", async ({
  page,
}) => {
  // The four kinds with typed properties offer it …
  const withForm: [string, string, string][] = [
    ["01-salzhafen/bucht/smuggler-captured", "Von den Schmugglern erwischt", "Szene"],
    ["npcs/fenn", "Fenn", "NPC"],
    ["locations/leuchtturm", "Der Leuchtturm von Salzhafen", "Ort"],
    ["01-salzhafen", "Kapitel 1: Der Leuchtturm von Salzhafen", "Kapitel"],
  ];
  for (const [rel, heading, kindLabel] of withForm) {
    await page.goto(`/campaigns/beispiel/entries/${rel}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    const dialog = await openProperties(page);
    await expect(dialog).toContainText(`${kindLabel}: Eigenschaften`);
    // Clean exit — nothing changed, nothing written.
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // … the app-managed and append-only entries do not (ADR #4), and neither does
  // the glossary, which has no typed properties to offer. Asserted only after
  // the content is on screen, so this cannot pass on a still-loading page.
  const withoutForm: [string, string][] = [
    ["sessions/2026-01-15", "Spuren gefunden"],
    ["inbox", "Der Dorfschmied repariert"],
    ["glossary", "Übersetzungs-Glossar"],
  ];
  for (const [rel, marker] of withoutForm) {
    await page.goto(`/campaigns/beispiel/entries/${rel}`);
    await expect(page.getByRole("article")).toContainText(marker);
    await expect(page.getByRole("button", { name: "Eigenschaften" })).toHaveCount(0);
  }

  // The campaign entry brings its OWN properties half: its name and
  // description are the two values no typed form models, so its dialog stands
  // under the properties name, and there is no generic form beside it.
  // The edit action there belongs to the body, like a chapter's.
  await page.goto("/campaigns/beispiel/entries/campaign");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );
  const campaignProperties = page.getByRole("button", { name: "Eigenschaften" });
  await expect(campaignProperties).toHaveCount(1);
  await campaignProperties.click();
  await expect(page.getByRole("dialog")).toContainText("Kampagne bearbeiten");
});

test("a status outside the closed list is refused and writes nothing", async ({ api }) => {
  // The four status columns and the scene type are CHECK constraints of their
  // columns (ADR #25), so the one write path refuses a foreign value with a
  // 400 and its own code instead of letting SQLite fail. The form can only
  // ever offer the allowed positions — this asserts the rule on the endpoint,
  // which is what protects the column against the generator and a direct
  // write as well.
  const before = await split(api, SCENE);
  const current = await api.entry(SCENE);
  const response = await api.fetch(
    `campaigns/beispiel/entries/${SCENE.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: current.rev, properties: { status: "halbfertig" } }),
    },
  );
  expect(response.status).toBe(400);
  // The body carries what the sentence in the app needs: which column, the
  // value that was written, and the positions in column order.
  expect(await response.json()).toMatchObject({
    code: "status_not_allowed",
    kind: "scene",
    value: "halbfertig",
    allowed: ["draft", "ready", "played", "dropped"],
  });
  // A refusal writes nothing — neither half moved, and the guard token stands.
  expect(await split(api, SCENE)).toEqual(before);
  expect((await api.entry(SCENE)).rev).toBe(current.rev);
});

// Critical path 8: the same form at phone size. The dialog is the only place
// in the reading view where the DM types more than one field, so it has to
// work here — the header action row wraps to a second line for it.
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
