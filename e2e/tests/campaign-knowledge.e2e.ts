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
import { ui, uiPattern } from "../support/ui";

const SOURCE = "The party watches the quay at low tide.";
/** The spelling the naming convention asks for instead of OLD_NAME. */
const NEW_NAME = "Brinemarsh";

/** A row control's name for ANY row — the catalog sentence around its title. */
function anyRow(key: "editableList.edit" | "editableList.remove"): RegExp {
  return uiPattern(key, { name: /.+/ }, { exact: true });
}

/** The edit button's name of the row titled `name`. */
function editRow(name: string): string {
  return ui("editableList.edit", { name });
}

/** The delete button's name of the row titled `name`. */
function removeRow(name: string): string {
  return ui("editableList.remove", { name });
}

/** The heading of the naming hints, for any number of them. */
function anyNamingHeading(): RegExp {
  const forms = [1, 2].map((count) =>
    uiPattern("generate.review.namingHeading", { count }).source.replace(String(count), "\\d+"),
  );
  return new RegExp(`^(?:${forms.join("|")})$`);
}

/** The knowledge page, reached from the chapter overview's lookup line. */
async function openKnowledge(page: Page): Promise<void> {
  await page.goto("/campaigns/beispiel");
  await page
    .getByRole("navigation", { name: ui("lookup.heading") })
    .getByRole("link", { name: ui("knowledge.title") })
    .click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/knowledge$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("knowledge.title"));
}

async function openGlossary(page: Page): Promise<void> {
  await page.goto("/campaigns/beispiel");
  await page
    .getByRole("navigation", { name: ui("lookup.heading") })
    .getByRole("link", { name: ui("glossary.title") })
    .click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/glossary$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("glossary.title"));
}

/** Save the open entry and wait for the page to say so. */
async function saveEntry(page: Page): Promise<void> {
  await page.getByRole("button", { name: ui("common.save") }).click();
  await expect(page.getByText(ui("editableList.saved"), { exact: true })).toBeVisible();
}

/** Delete the row titled `name`, through the confirmation that names it. */
async function deleteRow(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: removeRow(name) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName(ui("editableList.confirmDelete.title", { name }));
  await dialog.getByRole("button", { name: ui("editableList.confirmDelete.confirm") }).click();
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
  await patchGlossaryTerm(api, keeper.id, { explanation: "keeper of the light" });
  const stale = await api.fetch(glossaryTermPath(api, keeper.id), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: keeper.rev, explanation: "Overwritten" }),
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: "rev_conflict",
    glossaryTerm: { id: keeper.id, explanation: "keeper of the light", rev: 2 },
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
  const after = await patchCampaign(api, { glossaryIntro: "Terms from the module." });
  expect(after).toEqual({
    ...before,
    glossaryIntro: "Terms from the module.\n",
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
  await expect(page.getByText(ui("knowledge.empty"))).toBeVisible();

  // --- creating: a naming convention ----------------------------------------
  await page.getByRole("button", { name: ui("knowledge.add") }).click();
  // The naming convention is the default kind, so the old/new pair is there —
  // each on its own full-width line.
  await expect(page.getByLabel(ui("knowledge.kindLabel"))).toHaveValue("naming");
  await page.getByLabel(ui("knowledge.from")).fill(OLD_NAME);
  await page.getByLabel(ui("knowledge.to")).fill(NEW_NAME);
  await saveEntry(page);
  // The form CLOSED — the item is stored, and the row is back to one line.
  await expect(page.getByLabel(ui("knowledge.from"))).toHaveCount(0);

  // --- anlegen: a style rule; switching the kind swaps the fields -----------
  await page.getByRole("button", { name: ui("knowledge.add") }).click();
  await page.getByLabel(ui("knowledge.kindLabel")).selectOption("style");
  await page
    .getByLabel(ui("knowledge.styleText"))
    .fill("No dice values in the read-aloud.");
  await saveEntry(page);

  // Stored on the SERVER, each item its own resource, in the order they were
  // typed (quality floor: no localStorage).
  const stored = await getKnowledgeItems(api);
  expect(stored.map(content)).toEqual([
    { kind: "naming", from: OLD_NAME, to: NEW_NAME, text: "" },
    { kind: "style", from: "", to: "", text: "No dice values in the read-aloud." },
  ]);

  // --- umsortieren: the order IS the order of the prompt --------------------
  const orderBefore = await getKnowledgeItemOrder(api);
  await page.getByRole("button", { name: ui("editableList.moveUp") }).nth(1).click();
  await expect(page.getByText(ui("editableList.saved"), { exact: true })).toBeVisible();
  const reordered = await getKnowledgeItems(api);
  expect(reordered.map((item) => item.kind)).toEqual(["style", "naming"]);
  // The order has its own guard: it moved, and no item's `rev` did.
  expect((await getKnowledgeItemOrder(api)).rev).toBe(orderBefore.rev + 1);
  expect(reordered.map((item) => item.rev)).toEqual([1, 1]);
  // The buttons at the ends are disabled — there is nowhere to move.
  await expect(page.getByRole("button", { name: ui("editableList.moveUp") }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: ui("editableList.moveDown") }).last()).toBeDisabled();

  // --- bearbeiten: the ROW opens the item ----------------------------------
  await page.getByRole("button", { name: editRow("No dice values in the read-aloud.") }).click();
  const rule = page.getByLabel(ui("knowledge.styleText"));
  await expect(rule).toBeFocused();
  await rule.fill("Read-aloud without numbers.");
  await saveEntry(page);

  // --- and it survives a reload, because the server holds it ----------------
  await page.reload();
  await expect(page.getByText("Read-aloud without numbers.")).toBeVisible();

  // --- deleting, with a confirmation ----------------------------------------
  await deleteRow(page, "Read-aloud without numbers.");
  expect((await getKnowledgeItems(api)).map((item) => item.kind)).toEqual(["naming"]);
  await expect(page.getByText("Read-aloud without numbers.")).toHaveCount(0);
});

test("the glossary page: alphabetical, filterable, and a LONG explanation fits", async ({
  page,
  api,
}) => {
  await openGlossary(page);
  const before = await getGlossaryTerms(api);
  expect(before.length).toBeGreaterThan(0);

  // Every term has its row.
  const shown = await page.getByRole("button", { name: anyRow("editableList.remove") }).count();
  expect(shown).toBe(before.length);

  // --- anlegen, with an explanation that is a PARAGRAPH ---------------------
  // An explanation is a paragraph, not a 120px box: the textarea grows, and
  // what is typed is what comes back.
  const LONG =
    "The mudflats off the harbour fall dry for more than a mile at low tide; " +
    "smugglers use the tidal creeks because the customs cutters run aground there, and " +
    "the locals name the channels after the families who know them.";
  await page.getByRole("button", { name: ui("glossary.add") }).click();
  await page.getByLabel(ui("glossary.term"), { exact: true }).fill("tidal flat");
  const explanation = page.getByLabel(ui("glossary.explanation"));
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
  await page.getByRole("button", { name: ui("glossary.add") }).click();
  await page.getByLabel(ui("glossary.term"), { exact: true }).fill("tidal flat");
  await page.getByRole("button", { name: ui("common.save") }).click();
  await expect(
    page.getByText(ui("server.glossary_term_taken", { term: "tidal flat" })),
  ).toBeVisible();
  expect(await getGlossaryTerms(api)).toEqual(after);
  await page.getByRole("button", { name: ui("common.cancel") }).click();

  // --- the filter hides rows, and the row it leaves is the right one -------
  await page.getByRole("textbox", { name: ui("glossary.filter") }).fill("tidal");
  await expect(page.getByRole("button", { name: anyRow("editableList.remove") })).toHaveCount(1);
  await expect(page.getByText("tidal flat")).toBeVisible();
  await page.getByRole("textbox", { name: ui("glossary.filter") }).fill("zzzqqq");
  await expect(page.getByText(ui("glossary.noMatch"))).toBeVisible();

  // --- and deleting the FILTERED row deletes that row, not the first one ---
  await page.getByRole("textbox", { name: ui("glossary.filter") }).fill("tidal");
  await deleteRow(page, "tidal flat");
  expect(await getGlossaryTerms(api)).toEqual(before);
});

test("cancelling the delete confirmation leaves the stored row alone", async ({
  page,
  api,
}) => {
  await openGlossary(page);
  const before = await getGlossaryTerms(api);
  const first = before[0]!.term;

  await page.getByRole("button", { name: removeRow(first) }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: ui("common.cancel") }).click();
  // The confirmation was declined — nothing was written.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await getGlossaryTerms(api)).toEqual(before);
});

test("a competing write is a conflict, not a silent overwrite — for an item and for the order", async ({
  page,
  api,
}) => {
  const first = await createKnowledgeItem(api, { kind: "naming", from: "Old", to: "New" });
  const second = await createKnowledgeItem(api, { kind: "fact", text: "Der Turm ist leer." });
  const third = await createKnowledgeItem(api, { kind: "style", text: "Keep it short." });
  await openKnowledge(page);

  // --- the item: the DM changes one field, somebody else another ------------
  await page.getByRole("button", { name: editRow("Old → New") }).click();
  await page.getByLabel(ui("knowledge.to")).fill("My new");
  await api.send("PATCH", knowledgeItemPath(api, first.id), { rev: first.rev, from: "Foreign" });

  await page.getByRole("button", { name: ui("common.save") }).click();
  // Nothing was written, and the DM is told instead of losing the other write.
  await expect(page.getByText(ui("editConflict.line"), { exact: false })).toBeVisible();
  expect(content((await getKnowledgeItems(api))[0]!)).toEqual({
    kind: "naming",
    from: "Foreign",
    to: "New",
    text: "",
  });
  // What the DM typed is still on screen, and retrying blindly is not offered.
  await expect(page.getByLabel(ui("knowledge.to"))).toHaveValue("My new");
  await expect(page.getByRole("button", { name: ui("common.save"), exact: true })).toBeDisabled();

  // Reloading costs the draft, so it asks first.
  await page.getByRole("button", { name: ui("editConflict.reload") }).click();
  const discard = page.getByRole("dialog");
  await expect(discard).toHaveAccessibleName(ui("properties.discard.title"));
  await discard.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(page.getByLabel(ui("knowledge.to"))).toHaveValue("My new");

  // Writing anyway writes only the field the DM changed: the other writer's
  // field stays.
  await page.getByRole("button", { name: ui("editConflict.force") }).click();
  await expect(page.getByText(ui("editableList.saved"), { exact: true })).toBeVisible();
  expect(content((await getKnowledgeItems(api))[0]!)).toEqual({
    kind: "naming",
    from: "Foreign",
    to: "My new",
    text: "",
  });

  // --- the order: somebody else rearranged it in between --------------------
  // The other writer's PUT and the DM's click run in ONE browser task: the
  // click follows the PUT's answer in the same continuation, so the version
  // poll cannot bring the fresh order — and its guard — into the page in
  // between. The page still holds the guard it read, and the move is a 409.
  const stale = await getKnowledgeItemOrder(api);
  const written = await page.evaluate(
    async ({ url, order, moveDown }) => {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(order),
      });
      // The first row's move-down button — the list on screen is still the
      // one before the PUT.
      document.querySelector<HTMLButtonElement>(`button[aria-label="${moveDown}"]`)?.click();
      return res.status;
    },
    {
      url: api.url(knowledgeItemOrderPath(api)),
      order: { items: [third.id, first.id, second.id], rev: stale.rev },
      moveDown: ui("editableList.moveDown"),
    },
  );
  expect(written).toBe(200);
  await expect(page.getByText(ui("editConflict.line"), { exact: false })).toBeVisible();
  // Nothing was written: the order is the other writer's.
  expect((await getKnowledgeItemOrder(api)).items).toEqual([third.id, first.id, second.id]);
  // Reloading brings the order that is stored, and the conflict line goes.
  await page.getByRole("button", { name: ui("editConflict.reload") }).click();
  await expect(page.getByText(ui("editConflict.line"), { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: anyRow("editableList.edit") }).first()).toHaveAccessibleName(
    editRow("Keep it short."),
  );
});

test("leaving with an unsaved entry asks first — and only then", async ({ page }) => {
  // At 390px the way out is the back row to the chapter overview — a plain router link, which is
  // exactly the exit that would otherwise drop the open entry without a word.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns/beispiel/knowledge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("knowledge.title"));

  // An entry that has been typed into blocks the way out.
  await page.getByRole("button", { name: ui("knowledge.add") }).click();
  await page.getByLabel(ui("knowledge.from")).fill("Do not lose this");
  await page.getByRole("link", { name: ui("mobileBack.chapterOverview") }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName(ui("properties.discard.title"));
  await dialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/knowledge$/);
  await expect(page.getByLabel(ui("knowledge.from"))).toHaveValue("Do not lose this");

  // A SAVED entry does not ask — the guard is about unsaved work only.
  await page.getByLabel(ui("knowledge.to")).fill("Neu");
  await saveEntry(page);
  await page.getByRole("link", { name: ui("mobileBack.chapterOverview") }).first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("switching the kind carries the text into the new form", async ({ page, api }) => {
  await openKnowledge(page);

  await page.getByRole("button", { name: ui("knowledge.add") }).click();
  // A half-typed convention is flagged as incomplete — it is stored, but the
  // prompt skips it, so the form says so instead of looking like it is in force.
  await page.getByLabel(ui("knowledge.from")).fill("Salt Harbour");
  await expect(page.getByText(ui("knowledge.incomplete"))).toBeVisible();
  await page.getByLabel(ui("knowledge.to")).fill("Brinehaven");
  await expect(page.getByText(ui("knowledge.incomplete"))).toHaveCount(0);

  // naming -> fact: the pair survives as one sentence.
  await page.getByLabel(ui("knowledge.kindLabel")).selectOption("fact");
  await expect(page.getByLabel(ui("knowledge.factText"))).toHaveValue("Salt Harbour → Brinehaven");

  // fact -> naming: the sentence lands in the old-spelling field, where it is visible.
  await page.getByLabel(ui("knowledge.kindLabel")).selectOption("naming");
  await expect(page.getByLabel(ui("knowledge.from"))).toHaveValue("Salt Harbour → Brinehaven");
  await expect(page.getByLabel(ui("knowledge.to"))).toHaveValue("");

  // And what is STORED is what is on screen — no column of a former kind
  // travels along invisibly.
  await page.getByLabel(ui("knowledge.to")).fill("Brinehaven");
  await saveEntry(page);
  expect((await getKnowledgeItems(api)).map(content)).toEqual([
    { kind: "naming", from: "Salt Harbour → Brinehaven", to: "Brinehaven", text: "" },
  ]);
});

// --- how the pages are REACHED ------------------------------------------------

test("four ways in: the chapter overview line, the phone, ⌘K and the generator", async ({ page }) => {
  // (a) The chapter overview's quiet lookup line — and the topbar carries neither page
  //     (the two pages are deliberately not up there).
  await page.goto("/campaigns/beispiel");
  const lookup = page.getByRole("navigation", { name: ui("lookup.heading") });
  await expect(lookup).toBeVisible();
  await expect(lookup.getByRole("link", { name: ui("browse.title.npcs") })).toBeVisible();
  await expect(lookup.getByRole("link", { name: ui("browse.title.locations") })).toBeVisible();
  await lookup.getByRole("link", { name: ui("knowledge.title") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/knowledge$/);
  const topbar = page.getByRole("navigation", { name: ui("topbar.nav.aria") });
  await expect(topbar.getByRole("link", { name: ui("glossary.title") })).toHaveCount(0);
  await expect(topbar.getByRole("link", { name: ui("knowledge.title") })).toHaveCount(0);

  // (c) ⌘K reaches both as navigation targets — the server's index holds
  //     entries, not pages, so nothing but the palette itself can offer them.
  await page.keyboard.press("ControlOrMeta+KeyK");
  await page.getByRole("combobox").fill(ui("glossary.title"));
  const option = page.getByRole("option").filter({ hasText: ui("glossary.title") });
  await expect(option.first()).toBeVisible();
  await expect(option.first()).toContainText(ui("palette.kind.page"));
  await option.first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/glossary$/);

  // (d) The generator's context line links to both — this is where the DM
  //     notices a rule is missing, and the fix is one click away.
  await page.goto("/campaigns/beispiel/generate");
  // The example campaign has no knowledge, so the link counts none.
  await expect(
    page.getByRole("link", { name: ui("generate.input.knowledgeCount", { count: 0 }) }),
  ).toHaveAttribute(
    "href",
    "/campaigns/beispiel/knowledge",
  );
  await page.getByRole("link", { name: ui("generate.input.glossary"), exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/glossary$/);
});

test("(b) the phone: the two rows in the lookup section, and the pages at 390px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/campaigns/beispiel");
  const browse = page.getByRole("navigation", { name: ui("lookup.heading") });
  await browse.getByRole("link", { name: ui("knowledge.title") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/knowledge$/);

  // The page works at the mobile floor: a new entry, typed and saved.
  await page.getByRole("button", { name: ui("knowledge.add") }).click();
  const from = page.getByLabel(ui("knowledge.from"));
  await from.fill("Mobile");
  await expect(from).toHaveValue("Mobile");
  await page.getByLabel(ui("knowledge.to")).fill("Phone");
  await saveEntry(page);
  // The row's controls are reachable, not pushed off the side.
  await expect(page.getByRole("button", { name: anyRow("editableList.remove") })).toBeVisible();

  // Nothing scrolls sideways at this width (quality floor, design/README.md).
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(noOverflow).toBe(true);

  // The back row to the chapter overview is the way out, as on every other
  // campaign view below md.
  await page.getByRole("link", { name: ui("mobileBack.chapterOverview") }).first().click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
});

// --- and what the generator does with all of it -------------------------------

test("the generator run: the knowledge travels, the naming check flags the draft, apply still writes", async ({
  page,
  api,
}) => {
  // The rules, written the way the DM writes them.
  await openKnowledge(page);
  await page.getByRole("button", { name: ui("knowledge.add") }).click();
  await page.getByLabel(ui("knowledge.from")).fill(OLD_NAME);
  await page.getByLabel(ui("knowledge.to")).fill(NEW_NAME);
  await saveEntry(page);
  await page.getByRole("button", { name: ui("knowledge.add") }).click();
  await page.getByLabel(ui("knowledge.kindLabel")).selectOption("fact");
  await page.getByLabel(ui("knowledge.factText")).fill("[[fenn]] leads the smugglers.");
  await saveEntry(page);

  // --- the generator names the COUNT in the sent-context summary -----------
  await page.goto("/campaigns/beispiel/generate");
  await expect(page.getByRole("link", { name: ui("generate.input.knowledgeCount", { count: 2 }) })).toBeVisible();

  // --- the run: the stub answers in the forbidden spelling ------------------
  await page.getByLabel(ui("generate.input.sourceLabel")).fill(`${SOURCE}\n\n${TRIGGER.oldName}`);
  await page.getByRole("button", { name: ui("generate.input.submit.scene") }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("generate.review.title"), {
    timeout: 30_000,
  });

  // 1. WHAT ARRIVED: the stub echoes the prompt's knowledge block back, so
  //    the review shows both rules — and `[[fenn]]` reached the model as the
  //    NPC's NAME, not as a slug. The lines are the prompt's own wording
  //    (server/src/store/knowledge-items.ts), not UI text.
  const echo = page.getByText(CONTEXT_ECHO, { exact: false });
  await expect(echo).toBeVisible();
  await expect(echo).toContainText(`schreibe „${OLD_NAME}“ immer als „${NEW_NAME}“`);
  await expect(echo).toContainText("Fakt: Fenn leads the smugglers.");
  await expect(echo).not.toContainText("[[fenn]]");

  // 2. THE CHECK: the old spelling is named, with where it sits — and it is
  //    labelled as what it is, a hint and not a blocker.
  const hints = page.getByRole("heading", {
    name: ui("generate.review.namingHeading", { count: 3 }),
    exact: true,
  });
  await expect(hints).toBeVisible();
  const rows = page.getByText(ui("generate.review.namingHint", { from: OLD_NAME, to: NEW_NAME }));
  await expect(rows.first()).toBeVisible();
  // One row per PLACE the spelling stands — the title and the two body lines
  // of the stub's draft; that is what makes a hint actionable.
  await expect(rows).toHaveCount(3);
  const where = `scenes/${SCENE_ID}`;
  await expect(
    page.getByText(ui("generate.review.namingWhereField", { path: where, field: "title" })),
  ).toBeVisible();
  await expect(
    page
      .getByText(uiPattern("generate.review.namingWhereBody", { path: where, line: /.+/ }, { exact: true }))
      .first(),
  ).toBeVisible();

  // 3. NOT A BLOCKER: apply writes the draft exactly as it would without it.
  // The stub's one scene, and no proposed npc or location.
  const summary = ui("generate.review.summary", { scenes: 1, stubs: 0 });
  await page
    .getByRole("button", { name: ui("generate.review.apply", { count: summary }), exact: true })
    .click();
  await expect(page.getByText(ui("generate.written.title.scene"))).toBeVisible();
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
  await expect(page.getByRole("link", { name: ui("generate.input.knowledgeCount", { count: 0 }) })).toBeVisible();

  await page.getByLabel(ui("generate.input.sourceLabel")).fill(SOURCE);
  await page.getByRole("button", { name: ui("generate.input.submit.scene") }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("generate.review.title"), {
    timeout: 30_000,
  });
  // No echo (the prompt had no knowledge section at all) and no hint block.
  await expect(page.getByText(CONTEXT_ECHO, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: anyNamingHeading() })).toHaveCount(0);
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
  await page.getByRole("button", { name: editRow(edited.term) }).click();
  const explanation = page.getByLabel(ui("glossary.explanation"));
  await explanation.fill("Edited by me.");

  // Somebody else deletes the FIRST term, and the poller brings that list
  // into this page.
  await deleteGlossaryTerm(api, deleted.id);
  await expect(page.getByRole("button", { name: removeRow(deleted.term) })).toHaveCount(
    0,
    { timeout: 20_000 },
  );
  await expect(explanation).toHaveValue("Edited by me.");

  // Saving writes THIS term against its own guard — nobody touched it, so
  // there is nothing to be in conflict with.
  await page.getByRole("button", { name: ui("common.save") }).click();
  await expect(page.getByText(ui("editableList.saved"), { exact: true })).toBeVisible();

  // THE POINT: the text landed on the term it was typed into, and every
  // other term is untouched.
  const after = await getGlossaryTerms(api);
  expect(after.find((term) => term.id === edited.id)?.explanation).toBe("Edited by me.");
  expect(after.filter((term) => term.id !== edited.id)).toEqual(
    before.filter((term) => term.id !== edited.id && term.id !== deleted.id),
  );
});

test("a dirty draft is never thrown away by a click — moving on asks first", async ({ page }) => {
  await openGlossary(page);
  const rows = page.getByRole("button", { name: anyRow("editableList.edit") });
  const first = (await rows.first().getAttribute("aria-label")) ?? "";
  const second = (await rows.nth(1).getAttribute("aria-label")) ?? "";

  await rows.first().click();
  await page.getByLabel(ui("glossary.explanation")).fill("Do not lose this.");

  // Another ROW: the question is asked, and continuing to edit leaves the
  // draft exactly where it was.
  await page.getByRole("button", { name: second }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName(ui("properties.discard.title"));
  await dialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(page.getByLabel(ui("glossary.explanation"))).toHaveValue("Do not lose this.");

  // Starting a new term is the same exit and asks the same question.
  await page.getByRole("button", { name: ui("glossary.add") }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName(ui("properties.discard.title"));
  await dialog.getByRole("button", { name: ui("properties.discard.keepEditing") }).click();
  await expect(page.getByLabel(ui("glossary.explanation"))).toHaveValue("Do not lose this.");

  // Only discarding moves on — and then the OTHER row is the open one.
  await page.getByRole("button", { name: second }).click();
  await page.getByRole("dialog").getByRole("button", { name: ui("common.discard") }).click();
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
  const labels = await page.getByRole("button", { name: anyRow("editableList.remove") }).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label") ?? ""),
  );
  expect(labels.length).toBeGreaterThan(2);
  const doomed = labels[1]!;
  const successor = labels[2]!;

  await page.getByRole("button", { name: doomed }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: ui("editableList.confirmDelete.confirm") }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: doomed })).toHaveCount(0);
  // The row that moved into the gap holds the keyboard — not a row two
  // positions away, and not the page body.
  await expect(page.getByRole("button", { name: successor })).toBeFocused();
});

test("the growing textarea follows the WIDTH, not only the text", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openGlossary(page);
  await page.getByRole("button", { name: ui("glossary.add") }).click();
  await page.getByLabel(ui("glossary.term"), { exact: true }).fill("mudflat walk");
  const explanation = page.getByLabel(ui("glossary.explanation"));
  await explanation.fill(
    "The mudflats off the harbour fall dry for more than a mile at low tide, and " +
      "the tidal creeks fill back up faster than anyone on foot can run.",
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
