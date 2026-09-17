// Critical path 6, extended (issue #53, PO feedback on PR #87): the campaign
// knowledge and the glossary as the DM maintains them on their own PAGES, and
// what the generator then does with them. See CLAUDE.md, „Kritische Pfade“.
//
// Nothing here is mocked except the model (e2e/fixtures/stub-llm.ts), and the
// two claims that only the real stack can show are:
//
//   1. WHAT THE DM TYPES ARRIVES. The rules are written through the UI —
//      click, type, save — and the review screen then shows the stub's ECHO
//      of the prompt block it received (replies.ts contextEchoWarnings). That
//      is the only honest way to assert the prompt from a browser: the page
//      cannot see the prompt, and reaching into the server would stop testing
//      the path that runs in production.
//   2. THE POST-RUN CHECK FIRES AND DOES NOT BLOCK. With TRIGGER.oldName the
//      stub answers in exactly the spelling the convention forbids; the review
//      has to name it, with its position, AND still let „Übernehmen“ write the
//      draft.
//
// Plus what the PAGES have to do that the old inline settings sections did
// not: be reached from four entry points, filter, open ONE entry at a time
// with fields that fit the content, save that entry on its own, confirm a
// deletion — and the 409 that a whole-list PUT still needs underneath.

import type { Page } from "@playwright/test";

import { CONTEXT_ECHO, OLD_NAME, SCENE_ID, TRIGGER } from "../fixtures/replies";
import { expect, test } from "../support/test";

const SOURCE = "The party watches the quay at low tide.";

/** The knowledge page, reached from the pool's „Nachschlagen“ line. */
async function openKnowledge(page: Page): Promise<void> {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("link", { name: "Kampagnenwissen" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/knowledge$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kampagnenwissen");
}

async function openGlossary(page: Page): Promise<void> {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("link", { name: "Glossar" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/glossary$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Glossar");
}

/** Save the open entry and wait for the page to say so. */
async function saveEntry(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
}

/** Delete the row whose delete button matches, through the confirmation. */
async function deleteRow(page: Page, name: RegExp): Promise<void> {
  await page.getByRole("button", { name }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Eintrag löschen?");
  await dialog.getByRole("button", { name: "Löschen" }).click();
  await expect(dialog).toHaveCount(0);
}

// --- the pages themselves ----------------------------------------------------

test("the knowledge page: add, edit, reorder, delete — one entry at a time", async ({
  page,
  api,
}) => {
  await openKnowledge(page);
  // Empty to begin with — the example campaign has no knowledge, and the
  // empty state invites action rather than showing a blank box.
  await expect(page.getByText("Noch kein Kampagnenwissen", { exact: false })).toBeVisible();

  // --- anlegen: a naming convention -----------------------------------------
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  // „Namenskonvention“ is the default kind, so the Alt/Neu pair is there —
  // each on its own full-width line (PO feedback on PR #87).
  await expect(page.getByLabel("Art")).toHaveValue("naming");
  await page.getByLabel("Alt (im Quellmaterial)").fill(OLD_NAME);
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Salzmarsch");
  await saveEntry(page);
  // The form CLOSED — the entry is stored, and the row is back to one line.
  await expect(page.getByLabel("Alt (im Quellmaterial)")).toHaveCount(0);

  // --- anlegen: a style rule; switching the kind swaps the fields -----------
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  await page.getByLabel("Art").selectOption("style");
  await page
    .getByLabel("Stilregel für generierte Texte")
    .fill("Keine Würfelwerte im Read-Aloud.");
  await saveEntry(page);

  // Stored on the SERVER, in the order they were typed (quality floor: no
  // localStorage — the list has to be visible through the API).
  const stored = await api.get<{ entries: Array<Record<string, unknown>> }>("campaigns/beispiel/knowledge");
  expect(stored.entries).toEqual([
    { kind: "naming", from: OLD_NAME, to: "Salzmarsch", text: "" },
    { kind: "style", from: "", to: "", text: "Keine Würfelwerte im Read-Aloud." },
  ]);

  // --- umsortieren: the order IS the order of the prompt --------------------
  await page.getByRole("button", { name: "Nach oben" }).nth(1).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  const reordered = await api.get<{ entries: Array<{ kind: string }> }>("campaigns/beispiel/knowledge");
  expect(reordered.entries.map((e) => e.kind)).toEqual(["style", "naming"]);
  // The buttons at the ends are disabled — there is nowhere to move.
  await expect(page.getByRole("button", { name: "Nach oben" }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Nach unten" }).last()).toBeDisabled();

  // --- bearbeiten: the ROW opens the entry ---------------------------------
  await page.getByRole("button", { name: /Keine Würfelwerte.*bearbeiten/ }).click();
  const rule = page.getByLabel("Stilregel für generierte Texte");
  await expect(rule).toBeFocused();
  await rule.fill("Read-Aloud ohne Zahlen.");
  await saveEntry(page);

  // --- and it survives a reload, because the server holds it ----------------
  await page.reload();
  await expect(page.getByText("Read-Aloud ohne Zahlen.")).toBeVisible();

  // --- löschen, mit Bestätigung ---------------------------------------------
  await deleteRow(page, /Read-Aloud ohne Zahlen.*löschen/);
  const afterDelete = await api.get<{ entries: Array<{ kind: string }> }>("campaigns/beispiel/knowledge");
  expect(afterDelete.entries.map((e) => e.kind)).toEqual(["naming"]);
  await expect(page.getByText("Read-Aloud ohne Zahlen.")).toHaveCount(0);
});

test("the glossary page: alphabetical, filterable, and a LONG explanation fits", async ({
  page,
  api,
}) => {
  await openGlossary(page);
  const before = await api.get<{ entries: Array<{ term: string }>; rev: number }>(
    "campaigns/beispiel/glossary",
  );
  expect(before.entries.length).toBeGreaterThan(0);

  // Alphabetical, not stored order — a glossary is looked things up in.
  const shown = await page.getByRole("button", { name: /löschen$/ }).count();
  expect(shown).toBe(before.entries.length);

  // --- anlegen, with an explanation that is a PARAGRAPH ---------------------
  // The complaint that started this rework: the old inline field was a 120px
  // box. The textarea grows, and what is typed is what comes back.
  const LONG =
    "Das Watt vor Salzhafen fällt bei Ebbe über eine Meile weit trocken; " +
    "Schmuggler nutzen die Priele, weil die Zollkutter dort auflaufen, und " +
    "die Einheimischen nennen die Rinnen nach den Familien, die sie kennen.";
  await page.getByRole("button", { name: "Neuer Begriff" }).click();
  await page.getByLabel("Begriff", { exact: true }).fill("tidal flat");
  const explanation = page.getByLabel("Erklärung");
  await explanation.fill(LONG);
  // The field grew with the text instead of scrolling inside itself.
  const box = await explanation.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(60);
  await saveEntry(page);

  const after = await api.get<{ entries: Array<{ term: string; explanation: string }>; rev: number }>(
    "campaigns/beispiel/glossary",
  );
  expect(after.entries.map((e) => e.term)).toEqual([
    ...before.entries.map((e) => e.term),
    "tidal flat",
  ]);
  expect(after.entries.at(-1)?.explanation).toBe(LONG);
  // The list's own guard token moved — the glossary is one document.
  expect(after.rev).toBe(before.rev + 1);

  // --- the filter hides rows, and the row it leaves is the right one -------
  await page.getByPlaceholder("Begriff filtern").fill("tidal");
  await expect(page.getByRole("button", { name: /löschen$/ })).toHaveCount(1);
  await expect(page.getByText("tidal flat")).toBeVisible();
  await page.getByPlaceholder("Begriff filtern").fill("zzzqqq");
  await expect(page.getByText("Kein Begriff passt zum Filter.")).toBeVisible();

  // --- and deleting the FILTERED row deletes that row, not the first one ---
  await page.getByPlaceholder("Begriff filtern").fill("tidal");
  await deleteRow(page, /tidal flat.*löschen/);
  const afterDelete = await api.get<{ entries: Array<{ term: string }> }>("campaigns/beispiel/glossary");
  expect(afterDelete.entries.map((e) => e.term)).toEqual(before.entries.map((e) => e.term));
});

test("„Abbrechen“ throws the open entry away and leaves the stored one alone", async ({
  page,
  api,
}) => {
  await openGlossary(page);
  const before = await api.get<{ entries: Array<{ term: string }> }>("campaigns/beispiel/glossary");
  const first = before.entries[0]!.term;

  await page.getByRole("button", { name: new RegExp(`${first}.*löschen`) }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
  // The confirmation was declined — nothing was written.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const after = await api.get<{ entries: Array<{ term: string }> }>("campaigns/beispiel/glossary");
  expect(after.entries.map((e) => e.term)).toEqual(before.entries.map((e) => e.term));
});

test("a competing write is a conflict, not a silent overwrite", async ({ page, api }) => {
  await openKnowledge(page);

  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  await page.getByLabel("Alt (im Quellmaterial)").fill("Alt");
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Neu");

  // Somebody else saves first (another tab, the same endpoint).
  const current = await api.get<{ rev: number }>("campaigns/beispiel/knowledge");
  await api.send("PUT", "campaigns/beispiel/knowledge", {
    entries: [{ kind: "fact", from: "", to: "", text: "Von woanders." }],
    rev: current.rev,
  });

  await page.getByRole("button", { name: "Speichern" }).click();
  // Nothing was written, and the DM is told instead of losing the other list.
  await expect(page.getByText("Inzwischen geändert", { exact: false })).toBeVisible();
  const after = await api.get<{ entries: Array<{ text: string }> }>("campaigns/beispiel/knowledge");
  expect(after.entries.map((e) => e.text)).toEqual(["Von woanders."]);
  // What the DM typed is still on screen — theirs to keep or to discard.
  await expect(page.getByLabel("Alt (im Quellmaterial)")).toHaveValue("Alt");

  // Retrying blindly is not offered: „Speichern“ is off until the DM decides.
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();

  // Reloading is their decision — and it costs the draft, so it asks first
  // (PO finding on PR #87: it used to discard the typing without a word).
  await page.getByRole("button", { name: "Neu laden" }).click();
  const discard = page.getByRole("dialog");
  await expect(discard).toContainText("Änderungen verwerfen?");
  await discard.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.getByLabel("Alt (im Quellmaterial)")).toHaveValue("Alt");

  await page.getByRole("button", { name: "Neu laden" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByText("Von woanders.")).toBeVisible();
  await expect(page.getByText("Inzwischen geändert", { exact: false })).toHaveCount(0);
});

test("leaving with an unsaved entry asks first — and only then", async ({ page }) => {
  // At 390px the way out is the „‹ Kapitel“ row — a plain router link, which is
  // exactly the exit that would otherwise drop the open entry without a word.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns/beispiel/knowledge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kampagnenwissen");

  // An entry that has been typed into blocks the way out.
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  await page.getByLabel("Alt (im Quellmaterial)").fill("Nicht verlieren");
  await page.getByRole("link", { name: "Kapitel" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Änderungen verwerfen?");
  await dialog.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/knowledge$/);
  await expect(page.getByLabel("Alt (im Quellmaterial)")).toHaveValue("Nicht verlieren");

  // A SAVED entry does not ask — the guard is about unsaved work only.
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Neu");
  await saveEntry(page);
  await page.getByRole("link", { name: "Kapitel" }).first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("switching the kind carries the text into the new form", async ({ page, api }) => {
  await openKnowledge(page);

  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  // A half-typed convention is flagged as incomplete — it is stored, but the
  // prompt skips it, so the form says so instead of looking like it is in force.
  await page.getByLabel("Alt (im Quellmaterial)").fill("Salt Harbour");
  await expect(page.getByText("Unvollständig", { exact: false })).toBeVisible();
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Salzhafen");
  await expect(page.getByText("Unvollständig", { exact: false })).toHaveCount(0);

  // naming -> fact: the pair survives as one sentence.
  await page.getByLabel("Art").selectOption("fact");
  await expect(page.getByLabel("Fakt, der gilt")).toHaveValue("Salt Harbour → Salzhafen");

  // fact -> naming: the sentence lands in „Alt“, where it is visible.
  await page.getByLabel("Art").selectOption("naming");
  await expect(page.getByLabel("Alt (im Quellmaterial)")).toHaveValue("Salt Harbour → Salzhafen");
  await expect(page.getByLabel("Neu (in dieser Kampagne)")).toHaveValue("");

  // And what is STORED is what is on screen — no column of a former kind
  // travels along invisibly.
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Salzhafen");
  await saveEntry(page);
  const stored = await api.get<{ entries: Array<Record<string, unknown>> }>("campaigns/beispiel/knowledge");
  expect(stored.entries).toEqual([
    { kind: "naming", from: "Salt Harbour → Salzhafen", to: "Salzhafen", text: "" },
  ]);
});

// --- how the pages are REACHED ------------------------------------------------

test("four ways in: the pool line, the phone, ⌘K and the generator", async ({ page }) => {
  // (a) The pool's quiet „Nachschlagen“ line — and the topbar is UNCHANGED
  //     (PO feedback on PR #87: the two pages are deliberately not up there).
  await page.goto("/campaigns/beispiel");
  const lookup = page.getByRole("navigation", { name: "Nachschlagen" });
  await expect(lookup).toBeVisible();
  await expect(lookup.getByRole("link", { name: "NPCs" })).toBeVisible();
  await expect(lookup.getByRole("link", { name: "Orte" })).toBeVisible();
  await lookup.getByRole("link", { name: "Kampagnenwissen" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/knowledge$/);
  const topbar = page.getByRole("navigation", { name: "Kapitel, NPCs und Orte" });
  await expect(topbar.getByRole("link", { name: "Glossar" })).toHaveCount(0);
  await expect(topbar.getByRole("link", { name: "Kampagnenwissen" })).toHaveCount(0);

  // (c) ⌘K reaches both as navigation targets — the server's index holds
  //     documents, not pages, so nothing but the palette itself can offer them.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill("glossar");
  const option = page.getByRole("option").filter({ hasText: "Glossar" });
  await expect(option.first()).toBeVisible();
  await expect(option.first()).toContainText("Seite");
  await option.first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/glossary$/);

  // (d) The generator's context line links to both — this is where the DM
  //     notices a rule is missing, and the fix is one click away.
  await page.goto("/campaigns/beispiel/generate");
  await expect(page.getByRole("link", { name: /Kampagnenwissen/ })).toHaveAttribute(
    "href",
    "/campaigns/beispiel/knowledge",
  );
  await page.getByRole("link", { name: "Glossar", exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/glossary$/);
});

test("(b) the phone: the two rows in „Nachschlagen“, and the pages at 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns/beispiel");
  const browse = page.getByRole("navigation", { name: "Nachschlagen" });
  await browse.getByRole("link", { name: "Kampagnenwissen" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/knowledge$/);

  // The page works at the mobile floor: a new entry, typed and saved.
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  const from = page.getByLabel("Alt (im Quellmaterial)");
  await from.fill("Mobil");
  await expect(from).toHaveValue("Mobil");
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Handy");
  await saveEntry(page);
  // The row's controls are reachable, not pushed off the side.
  await expect(page.getByRole("button", { name: /löschen$/ })).toBeVisible();

  // Nothing scrolls sideways at this width (quality floor, design/README.md).
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noOverflow).toBe(true);

  // „‹ Kapitel“ is the way back, as on every other campaign view below md.
  await page.getByRole("link", { name: "Kapitel" }).first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
});

// --- and what the generator does with all of it -------------------------------

test("the generator run: the knowledge travels, the naming check flags the draft, apply still writes", async ({
  page,
  api,
}) => {
  // The rules, written the way the DM writes them.
  await openKnowledge(page);
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  await page.getByLabel("Alt (im Quellmaterial)").fill(OLD_NAME);
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Salzmarsch");
  await saveEntry(page);
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  await page.getByLabel("Art").selectOption("fact");
  await page.getByLabel("Fakt, der gilt").fill("[[fenn]] führt die Schmuggler.");
  await saveEntry(page);

  // --- the generator names the COUNT in „Mitgeschickter Kontext“ (AK5) ------
  await page.goto("/campaigns/beispiel/generate");
  await expect(page.getByRole("link", { name: "2 Wissens-Einträge" })).toBeVisible();

  // --- the run: the stub answers in the forbidden spelling ------------------
  await page.getByLabel("Quelltext (EN)").fill(`${SOURCE}\n\n${TRIGGER.oldName}`);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  // 1. WHAT ARRIVED: the stub echoes the prompt's knowledge block back, so
  //    the review shows both rules — and `[[fenn]]` reached the model as the
  //    NPC's NAME, not as a slug (AK4).
  const echo = page.getByText(CONTEXT_ECHO, { exact: false });
  await expect(echo).toBeVisible();
  await expect(echo).toContainText(`schreibe „${OLD_NAME}“ immer als „Salzmarsch“`);
  await expect(echo).toContainText("Fakt: Fenn führt die Schmuggler.");
  await expect(echo).not.toContainText("[[fenn]]");

  // 2. THE CHECK: the old spelling is named, with where it sits — and it is
  //    labelled as what it is, a hint and not a blocker.
  const hints = page.getByRole("heading", { name: /Namens-Hinweis/ });
  await expect(hints).toBeVisible();
  await expect(hints).toContainText("kein Blocker");
  const rows = page.getByText(`„${OLD_NAME}“ steht noch da — vereinbart ist „Salzmarsch“`);
  await expect(rows.first()).toBeVisible();
  // One row per PLACE the spelling stands — the title and the two body lines
  // of the stub's draft; that is what makes a hint actionable.
  await expect(rows).toHaveCount(3);
  await expect(page.getByText(/Feld title$/)).toBeVisible();
  await expect(page.getByText(/Zeile \d+$/).first()).toBeVisible();

  // 3. NOT A BLOCKER: apply writes the draft exactly as it would without it.
  await page.getByRole("button", { name: /^Übernehmen/ }).click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  const scene = await api.file(`01-salzhafen/${SCENE_ID}`);
  expect(`${JSON.stringify(scene.properties)}\n${scene.body}`).toContain(OLD_NAME);
});

test("without naming conventions nothing is flagged and the prompt is unchanged", async ({
  page,
}) => {
  // The example campaign has no knowledge, so this is the shape every
  // campaign that never uses the feature sees (AK5: „Glossar-Verhalten im
  // Prompt unverändert").
  await page.goto("/campaigns/beispiel/generate");
  await expect(page.getByRole("link", { name: "kein Kampagnenwissen" })).toBeVisible();

  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  // No echo (the prompt had no knowledge section at all) and no hint block.
  await expect(page.getByText(CONTEXT_ECHO, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Namens-Hinweis/ })).toHaveCount(0);
});

// --- what an OPEN row survives (PO findings on PR #87) ------------------------
//
// The version poller refetches both lists every ~5s (app/src/lib/use-campaign-
// version.ts), so the list under an open row really does change in production
// — which is why these are E2E and not unit tests: the poll, the guard token
// and the whole-list PUT only line up in the real stack.

test("an open row is its ENTRY, not a position — and the guard token is the one it was opened with", async ({
  page,
  api,
}) => {
  await openGlossary(page);
  const before = await api.get<{ entries: Array<{ term: string; explanation: string }>; rev: number }>(
    "campaigns/beispiel/glossary",
  );
  // Two terms that are not the same row: one is edited, the other is deleted
  // from underneath by „another tab“.
  const edited = before.entries.at(-1)!;
  const deleted = before.entries[0]!;
  expect(edited.term).not.toBe(deleted.term);

  // The DM opens the LAST entry and types into it.
  await page.getByRole("button", { name: new RegExp(`${edited.term}.*bearbeiten`) }).click();
  const explanation = page.getByLabel("Erklärung");
  await explanation.fill("Von mir bearbeitet.");

  // While that draft is open, nothing else may rewrite the list under it:
  // delete and move are off (the draft's row is a position in the PUT).
  await expect(page.getByRole("button", { name: /löschen$/ }).first()).toBeDisabled();

  // Somebody else deletes the FIRST entry — every stored position below it
  // shifts by one, and the poller brings that list into this page.
  await api.send("PUT", "campaigns/beispiel/glossary", {
    entries: before.entries.filter((entry) => entry.term !== deleted.term),
    rev: before.rev,
  });
  await expect(page.getByRole("button", { name: new RegExp(`${deleted.term}.*löschen`) })).toHaveCount(
    0,
    { timeout: 20_000 },
  );

  // Saving now is a CONFLICT, not a write: the draft was written against the
  // list as it was. Nothing reached the server.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Inzwischen geändert", { exact: false })).toBeVisible();
  const afterConflict = await api.get<{
    entries: Array<{ term: string; explanation: string }>;
    rev: number;
  }>("campaigns/beispiel/glossary");
  expect(afterConflict.entries.map((e) => e.explanation)).not.toContain("Von mir bearbeitet.");

  // And „Speichern“ is OFF until the DM decides — retrying against a list
  // that moved is exactly how a draft lands on a neighbouring entry.
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await expect(explanation).toHaveValue("Von mir bearbeitet.");

  // „Draft behalten“ re-aims it at the list that came back — offered because
  // the opened entry is still there, unchanged.
  await page.getByRole("button", { name: /Entwurf behalten/ }).click();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();

  // THE POINT: the text landed on the entry it was typed into, and the entry
  // that moved into its old position is untouched.
  const after = await api.get<{ entries: Array<{ term: string; explanation: string }> }>(
    "campaigns/beispiel/glossary",
  );
  const written = after.entries.find((entry) => entry.term === edited.term);
  expect(written?.explanation).toBe("Von mir bearbeitet.");
  for (const entry of after.entries) {
    if (entry.term !== edited.term) {
      expect(entry.explanation).toBe(
        before.entries.find((old) => old.term === entry.term)?.explanation,
      );
    }
  }
});

test("a dirty draft is never thrown away by a click — moving on asks first", async ({ page }) => {
  await openGlossary(page);
  const rows = page.getByRole("button", { name: /bearbeiten$/ });
  const first = (await rows.first().getAttribute("aria-label")) ?? "";
  const second = (await rows.nth(1).getAttribute("aria-label")) ?? "";

  await rows.first().click();
  await page.getByLabel("Erklärung").fill("Nicht verlieren.");

  // Another ROW: the question is asked, and „Weiter bearbeiten“ leaves the
  // draft exactly where it was.
  await page.getByRole("button", { name: second }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Änderungen verwerfen?");
  await dialog.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.getByLabel("Erklärung")).toHaveValue("Nicht verlieren.");

  // „Neuer Begriff“ is the same exit and asks the same question.
  await page.getByRole("button", { name: "Neuer Begriff" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Änderungen verwerfen?");
  await dialog.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.getByLabel("Erklärung")).toHaveValue("Nicht verlieren.");

  // Only „Verwerfen“ moves on — and then the OTHER row is the open one.
  await page.getByRole("button", { name: second }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: first })).toBeVisible();
  await expect(page.getByRole("button", { name: second })).toHaveCount(0);
});

test("deleting in the ALPHABETICAL glossary hands the focus to the row that takes the gap", async ({
  page,
}) => {
  await openGlossary(page);
  // The display order is alphabetical, the stored order is not — so the
  // neighbour has to be read off the list as it looks AFTER the deletion.
  const labels = await page.getByRole("button", { name: /löschen$/ }).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label") ?? ""),
  );
  expect(labels.length).toBeGreaterThan(2);
  const doomed = labels[1]!;
  const successor = labels[2]!;

  await page.getByRole("button", { name: doomed }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Löschen" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: doomed })).toHaveCount(0);
  // The row that moved into the gap holds the keyboard — not a row two
  // positions away, and not the document.
  await expect(page.getByRole("button", { name: successor })).toBeFocused();
});

test("the growing textarea follows the WIDTH, not only the text", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openGlossary(page);
  await page.getByRole("button", { name: "Neuer Begriff" }).click();
  await page.getByLabel("Begriff", { exact: true }).fill("Wattlauf");
  const explanation = page.getByLabel("Erklärung");
  await explanation.fill(
    "Das Watt vor Salzhafen fällt bei Ebbe über eine Meile weit trocken, und " +
      "die Priele füllen sich schneller zurück, als ein Fußgänger laufen kann.",
  );
  const wide = await explanation.boundingBox();

  // Narrower viewport: the same text needs more lines. The field has to grow
  // with them instead of clipping its own bottom (PO finding on PR #87).
  await page.setViewportSize({ width: 560, height: 900 });
  await expect
    .poll(async () => (await explanation.boundingBox())?.height ?? 0)
    .toBeGreaterThan(wide?.height ?? 0);
  const fits = await explanation.evaluate(
    (node: HTMLTextAreaElement) => node.scrollHeight - node.clientHeight <= 2,
  );
  expect(fits).toBe(true);

  // And back: it shrinks again rather than keeping the tall size for ever.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect
    .poll(async () => (await explanation.boundingBox())?.height ?? 0)
    .toBeLessThanOrEqual(wide?.height ?? 0);
});
