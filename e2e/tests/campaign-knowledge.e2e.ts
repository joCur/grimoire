// Critical path 6, extended: the campaign
// knowledge and the glossary as the DM maintains them on their own PAGES, and
// what the generator then does with them. See the critical paths in CLAUDE.md.
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
//      has to name it, with its position, AND still let the accept action write
//      the draft.
//
// Plus what the PAGES have to do: be reached from four entry points, filter,
// open ONE row at a time with fields that fit the content, save that row on
// its own against its own guard, confirm a deletion — and the 409 of a row
// and of the order of the knowledge items. Each glossary term and each
// knowledge item is its own resource (decisions/resources).

import type { Page } from "@playwright/test";

import { CONTEXT_ECHO, OLD_NAME, SCENE_ID, TRIGGER } from "../fixtures/replies";
import { underCampaign } from "../support/api";
import { getCampaign, patchCampaign } from "../support/campaign";
import {
  deleteGlossaryTerm,
  getGlossaryTerm,
  getGlossaryTerms,
  glossaryTermPath,
  patchGlossaryTerm,
} from "../support/glossary-term";
import {
  createKnowledgeItem,
  getKnowledgeItemOrder,
  getKnowledgeItems,
  knowledgeItemPath,
  knowledgeItemOrderPath,
} from "../support/knowledge-item";
import { getScene } from "../support/scene";
import { expect, test } from "../support/test";

const SOURCE = "The party watches the quay at low tide.";

/** The knowledge page, reached from the chapter overview's lookup line. */
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
  await expect(dialog).toContainText(/„.+“ löschen\?/);
  await dialog.getByRole("button", { name: "Löschen" }).click();
  await expect(dialog).toHaveCount(0);
}

// --- the resources underneath -------------------------------------------------

/** A glossary term or a knowledge item without the fields the server hands out. */
function content<T extends { id: string; rev: number }>(row: T): Omit<T, "id" | "rev"> {
  const { id: _id, rev: _rev, ...fields } = row;
  return fields;
}

test("the former list addresses name nothing; every term and item answers flat", async ({ api }) => {
  // No list is swapped as a whole: GET and PUT on the list addresses
  // are 404, without a redirect.
  for (const list of ["glossary", "knowledge"]) {
    expect((await api.fetch(underCampaign(api, list))).status).toBe(404);
    const put = await api.fetch(underCampaign(api, list), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: [], rev: 1 }),
    });
    expect(put.status).toBe(404);
  }

  // A term is its own resource: every field flat, its own guard.
  const keeper = await getGlossaryTerm(api, "lighthouse-keeper");
  expect(keeper).toEqual({
    id: "lighthouse-keeper",
    term: "lighthouse keeper",
    explanation: "Leuchtturmwärter",
    rev: 1,
  });
  // A stale rev is 409 with the term as it stands; an unknown field is 400.
  await patchGlossaryTerm(api, keeper.id, { explanation: "Leuchtturmwärterin" });
  const stale = await api.fetch(glossaryTermPath(api, keeper.id), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: keeper.rev, explanation: "Überschrieben" }),
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: "rev_conflict",
    glossaryTerm: { id: keeper.id, explanation: "Leuchtturmwärterin", rev: 2 },
  });
  const unknownTermField = await api.fetch(glossaryTermPath(api, keeper.id), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: 2, kind: "fact" }),
  });
  expect(unknownTermField.status).toBe(400);
  expect(await unknownTermField.text()).toContain("kind");

  // The same for a knowledge item.
  const item = await createKnowledgeItem(api, { kind: "fact", text: "Der Turm ist leer." });
  expect(item).toEqual({
    id: item.id,
    kind: "fact",
    from: "",
    to: "",
    text: "Der Turm ist leer.",
    rev: 1,
  });
  const unknownItemField = await api.fetch(knowledgeItemPath(api, item.id), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: 1, term: "x" }),
  });
  expect(unknownItemField.status).toBe(400);
  expect(await unknownItemField.text()).toContain("term");
});

test("the glossary intro is a field of the campaign, written with the campaign", async ({ api }) => {
  const before = await getCampaign(api);
  expect(before.glossaryIntro).toBe("");
  const after = await patchCampaign(api, { glossaryIntro: "Begriffe aus dem Modul." });
  expect(after).toEqual({
    ...before,
    glossaryIntro: "Begriffe aus dem Modul.\n",
    rev: before.rev + 1,
  });
  // The terms did not move: the intro is no term.
  expect((await getGlossaryTerms(api)).every((term) => term.rev === 1)).toBe(true);
});

// --- the pages themselves ----------------------------------------------------

test("the knowledge page: add, edit, reorder, delete — one item at a time", async ({
  page,
  api,
}) => {
  await openKnowledge(page);
  // Empty to begin with — the example campaign has no knowledge, and the
  // empty state invites action rather than showing a blank box.
  await expect(page.getByText("Noch kein Kampagnenwissen", { exact: false })).toBeVisible();

  // --- creating: a naming convention ----------------------------------------
  await page.getByRole("button", { name: "Wissen hinzufügen" }).click();
  // The naming convention is the default kind, so the old/new pair is there —
  // each on its own full-width line.
  await expect(page.getByLabel("Art")).toHaveValue("naming");
  await page.getByLabel("Alt (im Quellmaterial)").fill(OLD_NAME);
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Salzmarsch");
  await saveEntry(page);
  // The form CLOSED — the item is stored, and the row is back to one line.
  await expect(page.getByLabel("Alt (im Quellmaterial)")).toHaveCount(0);

  // --- anlegen: a style rule; switching the kind swaps the fields -----------
  await page.getByRole("button", { name: "Wissen hinzufügen" }).click();
  await page.getByLabel("Art").selectOption("style");
  await page
    .getByLabel("Stilregel für generierte Texte")
    .fill("Keine Würfelwerte im Read-Aloud.");
  await saveEntry(page);

  // Stored on the SERVER, each item its own resource, in the order they were
  // typed (quality floor: no localStorage).
  const stored = await getKnowledgeItems(api);
  expect(stored.map(content)).toEqual([
    { kind: "naming", from: OLD_NAME, to: "Salzmarsch", text: "" },
    { kind: "style", from: "", to: "", text: "Keine Würfelwerte im Read-Aloud." },
  ]);

  // --- umsortieren: the order IS the order of the prompt --------------------
  const orderBefore = await getKnowledgeItemOrder(api);
  await page.getByRole("button", { name: "Nach oben" }).nth(1).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  const reordered = await getKnowledgeItems(api);
  expect(reordered.map((item) => item.kind)).toEqual(["style", "naming"]);
  // The order has its own guard: it moved, and no item's `rev` did.
  expect((await getKnowledgeItemOrder(api)).rev).toBe(orderBefore.rev + 1);
  expect(reordered.map((item) => item.rev)).toEqual([1, 1]);
  // The buttons at the ends are disabled — there is nowhere to move.
  await expect(page.getByRole("button", { name: "Nach oben" }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Nach unten" }).last()).toBeDisabled();

  // --- bearbeiten: the ROW opens the item ----------------------------------
  await page.getByRole("button", { name: /Keine Würfelwerte.*bearbeiten/ }).click();
  const rule = page.getByLabel("Stilregel für generierte Texte");
  await expect(rule).toBeFocused();
  await rule.fill("Read-Aloud ohne Zahlen.");
  await saveEntry(page);

  // --- and it survives a reload, because the server holds it ----------------
  await page.reload();
  await expect(page.getByText("Read-Aloud ohne Zahlen.")).toBeVisible();

  // --- deleting, with a confirmation ----------------------------------------
  await deleteRow(page, /Read-Aloud ohne Zahlen.*löschen/);
  expect((await getKnowledgeItems(api)).map((item) => item.kind)).toEqual(["naming"]);
  await expect(page.getByText("Read-Aloud ohne Zahlen.")).toHaveCount(0);
});

test("the glossary page: alphabetical, filterable, and a LONG explanation fits", async ({
  page,
  api,
}) => {
  await openGlossary(page);
  const before = await getGlossaryTerms(api);
  expect(before.length).toBeGreaterThan(0);

  // Every term has its row.
  const shown = await page.getByRole("button", { name: /löschen$/ }).count();
  expect(shown).toBe(before.length);

  // --- anlegen, with an explanation that is a PARAGRAPH ---------------------
  // An explanation is a paragraph, not a 120px box: the textarea grows, and
  // what is typed is what comes back.
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

  const after = await getGlossaryTerms(api);
  expect(after.map((term) => term.term)).toEqual([...before.map((term) => term.term), "tidal flat"]);
  expect(after.at(-1)?.explanation).toBe(LONG);
  // A new term is a row of its own: nothing else moved.
  expect(after.slice(0, -1)).toEqual(before);

  // --- a term stands in the glossary once -----------------------------------
  await page.getByRole("button", { name: "Neuer Begriff" }).click();
  await page.getByLabel("Begriff", { exact: true }).fill("tidal flat");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(
    page.getByText("Den Begriff „tidal flat“ gibt es im Glossar schon — bitte den vorhandenen bearbeiten."),
  ).toBeVisible();
  expect(await getGlossaryTerms(api)).toEqual(after);
  await page.getByRole("button", { name: "Abbrechen" }).click();

  // --- the filter hides rows, and the row it leaves is the right one -------
  await page.getByPlaceholder("Begriff filtern").fill("tidal");
  await expect(page.getByRole("button", { name: /löschen$/ })).toHaveCount(1);
  await expect(page.getByText("tidal flat")).toBeVisible();
  await page.getByPlaceholder("Begriff filtern").fill("zzzqqq");
  await expect(page.getByText("Kein Begriff passt zum Filter.")).toBeVisible();

  // --- and deleting the FILTERED row deletes that row, not the first one ---
  await page.getByPlaceholder("Begriff filtern").fill("tidal");
  await deleteRow(page, /tidal flat.*löschen/);
  expect(await getGlossaryTerms(api)).toEqual(before);
});

test("„Abbrechen“ throws the open row away and leaves the stored one alone", async ({
  page,
  api,
}) => {
  await openGlossary(page);
  const before = await getGlossaryTerms(api);
  const first = before[0]!.term;

  await page.getByRole("button", { name: new RegExp(`${first}.*löschen`) }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Abbrechen" }).click();
  // The confirmation was declined — nothing was written.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getGlossaryTerms(api)).toEqual(before);
});

test("a competing write is a conflict, not a silent overwrite — for an item and for the order", async ({
  page,
  api,
}) => {
  const first = await createKnowledgeItem(api, { kind: "naming", from: "Alt", to: "Neu" });
  const second = await createKnowledgeItem(api, { kind: "fact", text: "Der Turm ist leer." });
  const third = await createKnowledgeItem(api, { kind: "style", text: "Kurz halten." });
  await openKnowledge(page);

  // --- the item: the DM changes one field, somebody else another ------------
  await page.getByRole("button", { name: /Alt → Neu.*bearbeiten/ }).click();
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Mein Neu");
  await api.send("PATCH", knowledgeItemPath(api, first.id), { rev: first.rev, from: "Fremd" });

  await page.getByRole("button", { name: "Speichern" }).click();
  // Nothing was written, and the DM is told instead of losing the other write.
  await expect(page.getByText("Inzwischen geändert", { exact: false })).toBeVisible();
  expect(content((await getKnowledgeItems(api))[0]!)).toEqual({
    kind: "naming",
    from: "Fremd",
    to: "Neu",
    text: "",
  });
  // What the DM typed is still on screen, and retrying blindly is not offered.
  await expect(page.getByLabel("Neu (in dieser Kampagne)")).toHaveValue("Mein Neu");
  await expect(page.getByRole("button", { name: "Speichern", exact: true })).toBeDisabled();

  // Reloading costs the draft, so it asks first.
  await page.getByRole("button", { name: "Neu laden" }).click();
  const discard = page.getByRole("dialog");
  await expect(discard).toContainText("Änderungen verwerfen?");
  await discard.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.getByLabel("Neu (in dieser Kampagne)")).toHaveValue("Mein Neu");

  // Writing anyway writes only the field the DM changed: the other writer's
  // field stays.
  await page.getByRole("button", { name: "Trotzdem speichern" }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  expect(content((await getKnowledgeItems(api))[0]!)).toEqual({
    kind: "naming",
    from: "Fremd",
    to: "Mein Neu",
    text: "",
  });

  // --- the order: somebody else rearranged it in between --------------------
  // The other writer's PUT and the DM's click run in ONE browser task: the
  // click follows the PUT's answer in the same continuation, so the version
  // poll cannot bring the fresh order — and its guard — into the page in
  // between. The page still holds the guard it read, and the move is a 409.
  const stale = await getKnowledgeItemOrder(api);
  const written = await page.evaluate(
    async ({ url, order }) => {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(order),
      });
      // The first row's „Nach unten" — the list on screen is still the one
      // before the PUT.
      document.querySelector<HTMLButtonElement>('button[aria-label="Nach unten"]')?.click();
      return res.status;
    },
    {
      url: api.url(knowledgeItemOrderPath(api)),
      order: { items: [third.id, first.id, second.id], rev: stale.rev },
    },
  );
  expect(written).toBe(200);
  await expect(page.getByText("Inzwischen geändert", { exact: false })).toBeVisible();
  // Nothing was written: the order is the other writer's.
  expect((await getKnowledgeItemOrder(api)).items).toEqual([third.id, first.id, second.id]);
  // Reloading brings the order that is stored, and the conflict line goes.
  await page.getByRole("button", { name: "Neu laden" }).click();
  await expect(page.getByText("Inzwischen geändert", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /bearbeiten$/ }).first()).toHaveAccessibleName(
    /Kurz halten/,
  );
});

test("leaving with an unsaved entry asks first — and only then", async ({ page }) => {
  // At 390px the way out is the back row to the chapter overview — a plain router link, which is
  // exactly the exit that would otherwise drop the open entry without a word.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns/beispiel/knowledge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kampagnenwissen");

  // An entry that has been typed into blocks the way out.
  await page.getByRole("button", { name: "Wissen hinzufügen" }).click();
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

  await page.getByRole("button", { name: "Wissen hinzufügen" }).click();
  // A half-typed convention is flagged as incomplete — it is stored, but the
  // prompt skips it, so the form says so instead of looking like it is in force.
  await page.getByLabel("Alt (im Quellmaterial)").fill("Salt Harbour");
  await expect(page.getByText("Unvollständig", { exact: false })).toBeVisible();
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Salzhafen");
  await expect(page.getByText("Unvollständig", { exact: false })).toHaveCount(0);

  // naming -> fact: the pair survives as one sentence.
  await page.getByLabel("Art").selectOption("fact");
  await expect(page.getByLabel("Fakt, der gilt")).toHaveValue("Salt Harbour → Salzhafen");

  // fact -> naming: the sentence lands in the old-spelling field, where it is visible.
  await page.getByLabel("Art").selectOption("naming");
  await expect(page.getByLabel("Alt (im Quellmaterial)")).toHaveValue("Salt Harbour → Salzhafen");
  await expect(page.getByLabel("Neu (in dieser Kampagne)")).toHaveValue("");

  // And what is STORED is what is on screen — no column of a former kind
  // travels along invisibly.
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Salzhafen");
  await saveEntry(page);
  expect((await getKnowledgeItems(api)).map(content)).toEqual([
    { kind: "naming", from: "Salt Harbour → Salzhafen", to: "Salzhafen", text: "" },
  ]);
});

// --- how the pages are REACHED ------------------------------------------------

test("four ways in: the chapter overview line, the phone, ⌘K and the generator", async ({ page }) => {
  // (a) The chapter overview's quiet lookup line — and the topbar carries neither page
  //     (the two pages are deliberately not up there).
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
  //     entries, not pages, so nothing but the palette itself can offer them.
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
  await page.getByRole("button", { name: "Wissen hinzufügen" }).click();
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

  // The back row to the chapter overview is the way out, as on every other
  // campaign view below md.
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
  await page.getByRole("button", { name: "Wissen hinzufügen" }).click();
  await page.getByLabel("Alt (im Quellmaterial)").fill(OLD_NAME);
  await page.getByLabel("Neu (in dieser Kampagne)").fill("Salzmarsch");
  await saveEntry(page);
  await page.getByRole("button", { name: "Wissen hinzufügen" }).click();
  await page.getByLabel("Art").selectOption("fact");
  await page.getByLabel("Fakt, der gilt").fill("[[fenn]] führt die Schmuggler.");
  await saveEntry(page);

  // --- the generator names the COUNT in the sent-context summary -----------
  await page.goto("/campaigns/beispiel/generate");
  await expect(page.getByRole("link", { name: "2 Punkte Kampagnenwissen" })).toBeVisible();

  // --- the run: the stub answers in the forbidden spelling ------------------
  await page.getByLabel("Quelltext (EN)").fill(`${SOURCE}\n\n${TRIGGER.oldName}`);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  // 1. WHAT ARRIVED: the stub echoes the prompt's knowledge block back, so
  //    the review shows both rules — and `[[fenn]]` reached the model as the
  //    NPC's NAME, not as a slug.
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
  const scene = await getScene(api, SCENE_ID);
  expect(`${scene.title}\n${scene.body}`).toContain(OLD_NAME);
});

test("without naming conventions nothing is flagged and the prompt is unchanged", async ({
  page,
}) => {
  // The example campaign has no knowledge, so this is the shape every
  // campaign that never uses the feature sees: the glossary's behaviour in the
  // prompt is the same as always.
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

// --- what an OPEN row survives ------------------------------------------------
//
// The version poller refetches the terms every ~5s (app/src/lib/use-campaign-
// version.ts), so the list under an open row really does change in production
// — which is why this is E2E and not a unit test: the poll and the guard of
// each row only line up in the real stack.

test("an open row is its TERM, not a position — a change elsewhere is no conflict for it", async ({
  page,
  api,
}) => {
  await openGlossary(page);
  const before = await getGlossaryTerms(api);
  // Two terms that are not the same row: one is edited, the other is deleted
  // from underneath by a second writer, standing in for another tab.
  const edited = before.at(-1)!;
  const deleted = before[0]!;
  expect(edited.id).not.toBe(deleted.id);

  // The DM opens the LAST created term and types into it.
  await page.getByRole("button", { name: new RegExp(`${edited.term}.*bearbeiten`) }).click();
  const explanation = page.getByLabel("Erklärung");
  await explanation.fill("Von mir bearbeitet.");

  // Somebody else deletes the FIRST term, and the poller brings that list
  // into this page.
  await deleteGlossaryTerm(api, deleted.id);
  await expect(page.getByRole("button", { name: new RegExp(`${deleted.term}.*löschen`) })).toHaveCount(
    0,
    { timeout: 20_000 },
  );
  await expect(explanation).toHaveValue("Von mir bearbeitet.");

  // Saving writes THIS term against its own guard — nobody touched it, so
  // there is nothing to be in conflict with.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();

  // THE POINT: the text landed on the term it was typed into, and every
  // other term is untouched.
  const after = await getGlossaryTerms(api);
  expect(after.find((term) => term.id === edited.id)?.explanation).toBe("Von mir bearbeitet.");
  expect(after.filter((term) => term.id !== edited.id)).toEqual(
    before.filter((term) => term.id !== edited.id && term.id !== deleted.id),
  );
});

test("a dirty draft is never thrown away by a click — moving on asks first", async ({ page }) => {
  await openGlossary(page);
  const rows = page.getByRole("button", { name: /bearbeiten$/ });
  const first = (await rows.first().getAttribute("aria-label")) ?? "";
  const second = (await rows.nth(1).getAttribute("aria-label")) ?? "";

  await rows.first().click();
  await page.getByLabel("Erklärung").fill("Nicht verlieren.");

  // Another ROW: the question is asked, and continuing to edit leaves the
  // draft exactly where it was.
  await page.getByRole("button", { name: second }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Änderungen verwerfen?");
  await dialog.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.getByLabel("Erklärung")).toHaveValue("Nicht verlieren.");

  // Starting a new term is the same exit and asks the same question.
  await page.getByRole("button", { name: "Neuer Begriff" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Änderungen verwerfen?");
  await dialog.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.getByLabel("Erklärung")).toHaveValue("Nicht verlieren.");

  // Only discarding moves on — and then the OTHER row is the open one.
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
  // positions away, and not the page body.
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
  // with them instead of clipping its own bottom.
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
