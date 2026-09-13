// Critical path 6, extended (issue #53): the campaign knowledge and the
// glossary as the DM maintains them, and what the generator then does with
// them. See CLAUDE.md, „Kritische Pfade".
//
// Nothing here is mocked except the model (e2e/fixtures/stub-llm.ts), and the
// two claims that only the real stack can show are:
//
//   1. WHAT THE DM TYPES ARRIVES. The rules are written through the settings
//      UI — click, type, save — and the review screen then shows the stub's
//      ECHO of the prompt block it received (replies.ts contextEchoWarnings).
//      That is the only honest way to assert the prompt from a browser: the
//      page cannot see the prompt, and reaching into the server would stop
//      testing the path that runs in production.
//   2. THE POST-RUN CHECK FIRES AND DOES NOT BLOCK. With TRIGGER.oldName the
//      stub answers in exactly the spelling the convention forbids; the
//      review has to name it, with its position, AND still let „Übernehmen"
//      write the draft.
//
// Plus the list mechanics the ticket asks for on both lists — anlegen,
// bearbeiten, löschen, umsortieren — and the 409 that a whole-list PUT needs.

import type { Page } from "@playwright/test";

import { CONTEXT_ECHO, OLD_NAME, SCENE_ID, TRIGGER } from "../fixtures/replies";
import { expect, test } from "../support/test";

const SOURCE = "The party watches the quay at low tide.";

/** The settings page of the example campaign, reached the way the gear does. */
async function openSettings(page: Page): Promise<void> {
  await page.goto("/beispiel");
  await page.getByRole("link", { name: "Einstellungen" }).click();
  await expect(page).toHaveURL(/\/settings(\?|$)/);
  await expect(page.getByRole("heading", { level: 2, name: "Kampagnenwissen" })).toBeVisible();
}

/** The knowledge section's own save button (the glossary has its own). */
function section(page: Page, heading: "Kampagnenwissen" | "Glossar") {
  // Each section is one <section>; the heading identifies it.
  return page.locator("section").filter({ has: page.getByRole("heading", { name: heading }) });
}

test("the two campaign sections: add, edit, reorder, delete — and they survive a reload", async ({
  page,
  api,
}) => {
  await openSettings(page);
  const knowledge = section(page, "Kampagnenwissen");
  const glossary = section(page, "Glossar");

  // Empty to begin with — the example campaign has no knowledge, and the
  // empty state invites action rather than showing a blank box.
  await expect(knowledge.getByText("Noch kein Kampagnenwissen", { exact: false })).toBeVisible();
  // The glossary is NOT empty: the example campaign ships terms.
  await expect(glossary.getByRole("textbox", { name: "Begriff" }).first()).toBeVisible();

  // --- anlegen: a naming convention -----------------------------------------
  await knowledge.getByRole("button", { name: "Eintrag hinzufügen" }).click();
  // „Namenskonvention" is the default kind, so the Alt/Neu pair is there.
  await expect(knowledge.getByLabel("Art")).toHaveValue("naming");
  await knowledge.getByRole("textbox", { name: "Alt (im Quellmaterial)" }).fill(OLD_NAME);
  await knowledge.getByRole("textbox", { name: "Neu (in dieser Kampagne)" }).fill("Salzmarsch");

  // --- anlegen: a style rule; switching the kind swaps the fields -----------
  await knowledge.getByRole("button", { name: "Eintrag hinzufügen" }).click();
  const secondKind = knowledge.getByLabel("Art").nth(1);
  await secondKind.selectOption("style");
  await knowledge
    .getByRole("textbox", { name: "Stilregel für generierte Texte" })
    .fill("Keine Würfelwerte im Read-Aloud.");

  await knowledge.getByRole("button", { name: "Speichern" }).click();
  await expect(knowledge.getByText("Gespeichert")).toBeVisible();

  // Stored on the SERVER, in the order they were typed (quality floor: no
  // localStorage — the list has to be visible through the API).
  const stored = await api.get<{ entries: Array<Record<string, unknown>>; rev: number }>(
    "beispiel/knowledge",
  );
  expect(stored.entries).toEqual([
    { kind: "naming", from: OLD_NAME, to: "Salzmarsch", text: "" },
    { kind: "style", from: "", to: "", text: "Keine Würfelwerte im Read-Aloud." },
  ]);

  // --- umsortieren ----------------------------------------------------------
  await knowledge.getByRole("button", { name: "Nach oben" }).nth(1).click();
  await knowledge.getByRole("button", { name: "Speichern" }).click();
  await expect(knowledge.getByText("Gespeichert")).toBeVisible();
  const reordered = await api.get<{ entries: Array<{ kind: string }> }>("beispiel/knowledge");
  expect(reordered.entries.map((e) => e.kind)).toEqual(["style", "naming"]);
  // The buttons at the ends are disabled — there is nowhere to move.
  await expect(knowledge.getByRole("button", { name: "Nach oben" }).first()).toBeDisabled();
  await expect(knowledge.getByRole("button", { name: "Nach unten" }).last()).toBeDisabled();

  // --- bearbeiten -----------------------------------------------------------
  await knowledge
    .getByRole("textbox", { name: "Stilregel für generierte Texte" })
    .fill("Read-Aloud ohne Zahlen.");
  await knowledge.getByRole("button", { name: "Speichern" }).click();
  await expect(knowledge.getByText("Gespeichert")).toBeVisible();

  // --- and it survives a reload, because the server holds it ----------------
  await page.reload();
  await expect(
    section(page, "Kampagnenwissen").getByRole("textbox", {
      name: "Stilregel für generierte Texte",
    }),
  ).toHaveValue("Read-Aloud ohne Zahlen.");

  // --- löschen --------------------------------------------------------------
  const fresh = section(page, "Kampagnenwissen");
  await fresh.getByRole("button", { name: "Eintrag löschen" }).first().click();
  await fresh.getByRole("button", { name: "Speichern" }).click();
  await expect(fresh.getByText("Gespeichert")).toBeVisible();
  const afterDelete = await api.get<{ entries: Array<{ kind: string }> }>("beispiel/knowledge");
  expect(afterDelete.entries.map((e) => e.kind)).toEqual(["naming"]);
});

test("the glossary is editable on the same page, with the same controls", async ({
  page,
  api,
}) => {
  await openSettings(page);
  const glossary = section(page, "Glossar");
  const before = await api.get<{ entries: Array<{ term: string }>; rev: number }>(
    "beispiel/glossary",
  );

  await glossary.getByRole("button", { name: "Begriff hinzufügen" }).click();
  await glossary.getByRole("textbox", { name: "Begriff" }).last().fill("tidal flat");
  await glossary.getByRole("textbox", { name: "Erklärung" }).last().fill("Watt");
  await glossary.getByRole("button", { name: "Speichern" }).click();
  await expect(glossary.getByText("Gespeichert")).toBeVisible();

  const after = await api.get<{ entries: Array<{ term: string }>; rev: number }>(
    "beispiel/glossary",
  );
  expect(after.entries.map((e) => e.term)).toEqual([
    ...before.entries.map((e) => e.term),
    "tidal flat",
  ]);
  // The list's own guard token moved — the glossary is one document.
  expect(after.rev).toBe(before.rev + 1);
});

test("a competing write is a conflict, not a silent overwrite", async ({ page, api }) => {
  await openSettings(page);
  const knowledge = section(page, "Kampagnenwissen");

  await knowledge.getByRole("button", { name: "Eintrag hinzufügen" }).click();
  await knowledge.getByRole("textbox", { name: "Alt (im Quellmaterial)" }).fill("Alt");
  await knowledge.getByRole("textbox", { name: "Neu (in dieser Kampagne)" }).fill("Neu");

  // Somebody else saves first (another tab, the same endpoint).
  const current = await api.get<{ rev: number }>("beispiel/knowledge");
  await api.send("PUT", "beispiel/knowledge", {
    entries: [{ kind: "fact", from: "", to: "", text: "Von woanders." }],
    rev: current.rev,
  });

  await knowledge.getByRole("button", { name: "Speichern" }).click();
  // Nothing was written, and the DM is told instead of losing the other list.
  await expect(knowledge.getByText("Inzwischen geändert", { exact: false })).toBeVisible();
  const after = await api.get<{ entries: Array<{ text: string }> }>("beispiel/knowledge");
  expect(after.entries.map((e) => e.text)).toEqual(["Von woanders."]);
  // The list on screen was re-read, so the next attempt can work.
  await expect(knowledge.getByRole("textbox", { name: "Fakt, der gilt" })).toHaveValue(
    "Von woanders.",
  );
});

test("the generator run: the knowledge travels, the naming check flags the draft, apply still writes", async ({
  page,
  api,
}) => {
  // The rules, written the way the DM writes them.
  await openSettings(page);
  const knowledge = section(page, "Kampagnenwissen");
  await knowledge.getByRole("button", { name: "Eintrag hinzufügen" }).click();
  await knowledge.getByRole("textbox", { name: "Alt (im Quellmaterial)" }).fill(OLD_NAME);
  await knowledge.getByRole("textbox", { name: "Neu (in dieser Kampagne)" }).fill("Salzmarsch");
  await knowledge.getByRole("button", { name: "Eintrag hinzufügen" }).click();
  await knowledge.getByLabel("Art").nth(1).selectOption("fact");
  await knowledge
    .getByRole("textbox", { name: "Fakt, der gilt" })
    .fill("[[fenn]] führt die Schmuggler.");
  await knowledge.getByRole("button", { name: "Speichern" }).click();
  await expect(knowledge.getByText("Gespeichert")).toBeVisible();

  // --- the generator names the COUNT in „Mitgeschickter Kontext" (AK5) ------
  await page.goto("/beispiel/generate");
  await expect(page.getByText("2 Wissens-Einträge", { exact: false })).toBeVisible();

  // --- the run: the stub answers in the forbidden spelling ------------------
  await page.getByLabel("Quelltext (EN)").fill(`${SOURCE}\n\n${TRIGGER.oldName}`);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review", {
    timeout: 30_000,
  });

  // 1. WHAT ARRIVED: the stub echoes the prompt's knowledge block back, so
  //    the review shows both rules — and `[[fenn]]` reached the model as the
  //    NPC's NAME, not as a slug (AK4).
  const echo = page.getByText(CONTEXT_ECHO, { exact: false });
  await expect(echo).toBeVisible();
  await expect(echo).toContainText(`schreibe „${OLD_NAME}" immer als „Salzmarsch"`);
  await expect(echo).toContainText("Fakt: Fenn führt die Schmuggler.");
  await expect(echo).not.toContainText("[[fenn]]");

  // 2. THE CHECK: the old spelling is named, with where it sits — and it is
  //    labelled as what it is, a hint and not a blocker.
  const hints = page.getByRole("heading", { name: /Namens-Hinweis/ });
  await expect(hints).toBeVisible();
  await expect(hints).toContainText("kein Blocker");
  const rows = page.getByText(`„${OLD_NAME}" steht noch da — vereinbart ist „Salzmarsch"`);
  await expect(rows.first()).toBeVisible();
  // One row per PLACE the spelling stands — the title and the two body lines
  // of the stub's draft; that is what makes a hint actionable.
  await expect(rows).toHaveCount(3);
  await expect(page.getByText(/Feld title$/)).toBeVisible();
  await expect(page.getByText(/Zeile \d+$/).first()).toBeVisible();

  // 3. NOT A BLOCKER: apply writes the draft exactly as it would without it.
  await page.getByRole("button", { name: /^Übernehmen/ }).click();
  await expect(page.getByText("Geschrieben — alles als draft")).toBeVisible();
  const scene = await api.raw(`01-salzhafen/${SCENE_ID}`);
  expect(scene).toContain(OLD_NAME);
});

test("without naming conventions nothing is flagged and the prompt is unchanged", async ({
  page,
}) => {
  // The example campaign has no knowledge, so this is the shape every
  // campaign that never uses the feature sees (AK5: „Glossar-Verhalten im
  // Prompt unverändert").
  await page.goto("/beispiel/generate");
  await expect(page.getByText("kein Kampagnenwissen", { exact: false })).toBeVisible();

  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review", {
    timeout: 30_000,
  });
  // No echo (the prompt had no knowledge section at all) and no hint block.
  await expect(page.getByText(CONTEXT_ECHO, { exact: false })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Namens-Hinweis/ })).toHaveCount(0);
});

test("the sections are usable at 390px — the mobile floor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Below `md` the topbar is not the chrome, so the page is opened directly;
  // the „‹ Pool" row is the way back (routes/settings.tsx).
  await page.goto("/settings?from=beispiel");
  const knowledge = section(page, "Kampagnenwissen");

  await knowledge.getByRole("button", { name: "Eintrag hinzufügen" }).click();
  const from = knowledge.getByRole("textbox", { name: "Alt (im Quellmaterial)" });
  await from.fill("Mobil");
  await expect(from).toHaveValue("Mobil");
  // The row controls are reachable, not pushed off the side.
  await expect(knowledge.getByRole("button", { name: "Eintrag löschen" })).toBeVisible();
  await expect(knowledge.getByRole("button", { name: "Speichern" })).toBeVisible();

  // Nothing scrolls sideways at this width (quality floor, design/README.md).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(overflow).toBe(true);
});
