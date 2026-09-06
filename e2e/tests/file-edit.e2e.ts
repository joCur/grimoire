// Critical path 9: editing a file's markdown body in the app — open → change
// the body → save → rendered; 409 on a CONCURRENT SECOND WRITE means reload
// instead of a silent overwrite; see CLAUDE.md.
//
// Since the cutover (issue #57) the database is the only truth, so "someone
// changed the file outside" can no longer happen — the conflict this path is
// about is a second write through the API while the editor stands open.
// Everything else is unchanged: the write goes through PUT /file with its
// guard token, the properties block must come out byte-identical, and every
// assertion reads the file back — through the API instead of from disk.
//
// Unlike the status control (critical path 7) the conflict is DETERMINISTIC:
// the editor freezes the guard token it was seeded from, on purpose, so the
// ~5s version poll cannot heal the staleness while the DM types. No retry loop.
//
// The other half of that freeze is what must NOT become a conflict: the status
// regler right next to the editor writes a new version of the same body, and
// the DM's own click may not answer their save with „Inzwischen geändert".
// Two more ways to lose text are covered here as well — a navigation must not
// leave edit mode armed, and a failing background refetch must not tear the
// open editor down.
//
// Since issue #43 „Bearbeiten" opens the BLOCK COMPOSER, so this spec covers
// the „Roh" half of edit mode: the textarea, its „Vorschau" and the whole
// save/409/discard machinery as seen from the fallback surface. The composer
// itself — and the fact that it is the default — is
// `tests/block-composer.e2e.ts`, on the same critical path.

import type { Page } from "@playwright/test";

import { expect, test, type Api } from "../support/test";

const SCENE = "01-salzhafen/hafen/lighthouse-arrival";
const SCENE_URL = `/beispiel/file/${SCENE}`;
const NPC = "npcs/jorna";
const STALE_MESSAGE = "Inzwischen geändert — neu laden";
/** aria-label of the raw-markdown textarea (FileBodyEditor). */
const TEXTAREA = "Markdown-Text von";

/**
 * The properties block including both fences and the newline after the
 * closing one — what PUT /file promises to leave alone.
 */
function propertiesBlock(raw: string): string {
  const match = /^---\n[\s\S]*?\n---\n/.exec(raw);
  expect(match, "the fixture file has no properties block").not.toBeNull();
  return match?.[0] ?? "";
}

/** Read the file and hand back its properties block and the rest. */
async function split(api: Api, rel: string) {
  const raw = await api.raw(rel);
  const properties = propertiesBlock(raw);
  return { raw, properties, body: raw.slice(properties.length) };
}

/**
 * Enter edit mode and switch to the raw markdown surface.
 *
 * „Bearbeiten" opens the block composer since issue #43, so everything the
 * fallback surface owns costs one more click: the „Roh" side of the mode
 * toggle. Switching is lossless by construction (the draft round-trips through
 * serializeBlocks/parseBlocks), which is why the textarea below is still
 * seeded with the file's body byte for byte and „Speichern" is still disabled
 * right after opening.
 */
async function openRawEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  // exact: the composer's per-card controls are named „Roh-Block 1 …".
  await page.getByRole("button", { name: "Roh", exact: true }).click();
}

test("editing the body: save writes the file and the reading view shows it", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const added = "Am Fuß der Treppe liegt eine angelaufene Messingpfeife im Sand.";

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // The trigger sits in the header action row, next to „Eigenschaften"; „Roh" is
  // the fallback surface this spec is about.
  await openRawEditor(page);

  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toBeVisible();
  // Seeded with the body — WITHOUT the properties, which this editor never
  // touches (and says so).
  await expect(textarea).toHaveValue(before.body);
  await expect(page.getByText("Nur der Textkörper — die Eigenschaften bleiben unverändert.")).toBeVisible();
  // The header keeps standing: title, chips and the status regler stay put.
  await expect(page.getByRole("button", { name: "Status ändern, aktuell bereit" })).toBeVisible();
  // While the editor runs the header trigger is gone — the toolbar toggle owns
  // the mode from here on, and it currently offers the OTHER side.
  await expect(page.getByRole("button", { name: "Vorschau" })).toBeVisible();

  // Nothing changed yet, so there is nothing to save.
  const save = page.getByRole("button", { name: "Speichern" });
  await expect(save).toBeDisabled();

  await textarea.fill(`${before.body}\n${added}\n`);
  await expect(save).toBeEnabled();
  await save.click();

  // The editor closes and the reading view renders the new body.
  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
  await expect(page.getByRole("article")).toContainText(added);
  // The old text is still there — this was an append, not a replace.
  await expect(page.locator("[data-callout='readaloud']")).toContainText(
    "Der Turm ragt schwarz gegen den Abendhimmel auf.",
  );

  // On disk: properties block byte-identical, body exactly what was typed.
  await expect.poll(() => api.raw(SCENE)).toContain(added);
  const after = await split(api, SCENE);
  expect(after.properties).toBe(before.properties);
  expect(after.body).toBe(`${before.body}\n${added}\n`);
});

test("the preview toggle renders the draft through the real markdown pipeline", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const loot = "> [!loot] Eine angelaufene Messingpfeife, Gravur: „Nordbucht“.";

  await page.goto(SCENE_URL);
  // The rendered body is on screen before edit mode …
  await expect(page.locator("[data-callout='readaloud']")).toHaveCount(1);
  await openRawEditor(page);

  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toBeVisible();
  // … and gone while the raw markdown is being edited — never both at once.
  await expect(page.locator("[data-callout='readaloud']")).toHaveCount(0);

  await textarea.fill(`${before.body}\n${loot}\n`);

  // Vorschau renders the DRAFT: the callouts that were already there plus the
  // one just typed, through the same renderer the reading view uses.
  await page.getByRole("button", { name: "Vorschau" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.locator("[data-callout='readaloud']")).toContainText(
    "Der Turm ragt schwarz gegen den Abendhimmel auf.",
  );
  await expect(page.locator("[data-callout='check']")).toContainText("Wisdom (Perception) DC 13");
  await expect(page.locator("[data-callout='secret']")).toBeVisible();
  const lootCallout = page.locator("[data-callout='loot']");
  await expect(lootCallout).toContainText("Beute");
  await expect(lootCallout).toContainText("Eine angelaufene Messingpfeife");
  // Still edit mode: the save buttons stand, only the surface swapped.
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeVisible();

  // Back to the text, unchanged by the round trip. This „Bearbeiten" is the
  // „Roh" surface's own toggle (Vorschau ⇄ Bearbeiten), not the header trigger
  // — that one is gone while edit mode runs, and „Blöcke" is a button of its
  // own, so the name stays unambiguous.
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(textarea).toHaveValue(`${before.body}\n${loot}\n`);

  // … and saved, the callout is part of the file.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.locator("[data-callout='loot']")).toContainText(
    "Eine angelaufene Messingpfeife",
  );
  const after = await split(api, SCENE);
  expect(after.properties).toBe(before.properties);
  expect(after.body).toContain(loot);
});

test("a concurrent second write: the save reports the conflict, the second one works", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const mine = "Von der DM im Editor der App ergänzt.";
  // Same properties, different body — only the row's guard token moves, and
  // that is what the server compares against.
  const otherBody = "\n## Flow\n\nVon einem zweiten Schreiber geändert.\n";

  await page.goto(SCENE_URL);
  await openRawEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);

  // A SECOND WRITE lands while the editor stands open: the same PUT /file the
  // app uses, with a token fetched a moment ago, so it succeeds and bumps the
  // row. No race to win — the editor holds the token it started from until a
  // conflict tells it otherwise, so the version poll cannot make the app's
  // write succeed silently.
  await api.writeBody(SCENE, otherBody);
  await textarea.fill(`${before.body}\n${mine}\n`);
  await page.getByRole("button", { name: "Speichern" }).click();

  // Refused, and said so — quietly, in the editor's own message line.
  await expect(page.getByText(STALE_MESSAGE)).toBeVisible();
  // The editor stays open and the typed text survives — that is the point.
  await expect(textarea).toHaveValue(`${before.body}\n${mine}\n`);
  // Nothing was written: the other writer's body stands, untouched.
  const conflicted = await split(api, SCENE);
  expect(conflicted.body).toBe(otherBody);
  expect(conflicted.properties).toBe(before.properties);

  // The editor re-read the file, so the SAME click works now — deliberately
  // on top of the other writer's body: the DM saw the message and decided.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);

  await expect.poll(() => api.raw(SCENE)).toContain(mine);
  const after = await split(api, SCENE);
  expect(after.properties).toBe(before.properties);
  expect(after.body).toBe(`${before.body}\n${mine}\n`);
  expect(after.body).not.toContain("Von einem zweiten Schreiber");
});

test("the status regler next to the editor is no conflict for the own save", async ({
  page,
  api,
}) => {
  const before = await split(api, SCENE);
  const mine = "Während des Statuswechsels geschrieben.";

  await page.goto(SCENE_URL);
  await openRawEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}\n${mine}\n`);

  // The pill stays usable while the editor runs (issue #28) — and its PATCH
  // bumps the file's rev without touching one byte of the body.
  const trigger = page.getByRole("button", { name: /^Status ändern, aktuell/ });
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "gespielt" }).click();
  await expect(trigger).toHaveText(/gespielt/);
  await expect.poll(() => api.raw(SCENE)).toContain("status: played");

  // The DM's OWN change must not come back as „Inzwischen geändert": a new
  // version with an identical body is adopted, a changed body still 409s.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);

  await expect.poll(() => api.raw(SCENE)).toContain(mine);
  const after = await split(api, SCENE);
  expect(after.body).toBe(`${before.body}\n${mine}\n`);
  expect(after.properties).toContain("status: played");
});

test("navigating away ends edit mode — coming back never re-opens it", async ({ page, api }) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);
  await openRawEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await textarea.fill(`${before.body}\nEin Satz, der die Navigation nicht überlebt.\n`);

  // In-app navigation to the scene's NPC (the aside card): the SAME route with
  // another path, so the view is not remounted and could carry edit mode over.
  await page.getByRole("link", { name: /Jorna/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  await expect(textarea).toHaveCount(0);

  // Back on the scene: the reading view. An editor seeded from the server would
  // exactly like the one the DM left — with their paragraph silently missing.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
  await expect(page.locator("[data-callout='readaloud']")).toBeVisible();
  expect(await api.raw(SCENE)).toBe(before.raw);
});

test("a failing background refetch leaves the open editor standing", async ({ page, api }) => {
  const before = await split(api, SCENE);
  const draft = `${before.body}\nGeschrieben, während der Server weg war.\n`;

  await page.goto(SCENE_URL);
  await openRawEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(draft);

  // Every further READ of this file fails — a restarted server, a network
  // blip. The write endpoint (PUT, no query string) stays reachable.
  // Counted per file: the NPC card of this scene reads through the same
  // endpoint, and its failures say nothing about the scene's query.
  let aborted = 0;
  await page.route("**/api/beispiel/file?**", (route) => {
    if (route.request().url().includes("lighthouse-arrival")) aborted++;
    void route.abort();
  });
  // The version poll (~5s) notices the second writer's change and refetches,
  // so the file query runs into the abort (retry: 1 -> two attempts, then
  // 'error'). The write goes through the API: only the app's own READ of this
  // file is blocked, the server stays reachable.
  await api.writeBody(SCENE, "\n## Flow\n\nVon einem zweiten Schreiber geändert.\n");
  await expect.poll(() => aborted, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // The cached file is still there, so the PAGE must not swap itself for its
  // error line and take the unsaved text with it. (The status pill next to the
  // editor says „Eintrag nicht ladbar" for its own failed read — that is its job
  // and stays, which is why this looks for the route's full sentence.)
  await expect(page.getByText("Eintrag nicht ladbar — Pfad prüfen")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(textarea).toHaveValue(draft);
});

test("Abbrechen asks before it throws work away", async ({ page, api }) => {
  const before = await split(api, SCENE);

  await page.goto(SCENE_URL);

  // Without changes there is nothing to lose: no dialog, straight out — the
  // detour through „Roh" and back is no change either (lossless round trip).
  await openRawEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveCount(0);

  // With changes it asks — and „Weiter bearbeiten" keeps the text.
  await openRawEditor(page);
  await textarea.fill(`${before.body}\nEin Satz, der nie gespeichert wird.\n`);
  await page.getByRole("button", { name: "Abbrechen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Änderungen verwerfen?");
  await dialog.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveValue(/Ein Satz, der nie gespeichert wird\./);

  // „Verwerfen" closes the editor and the reading view is as it was.
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveCount(0);
  await expect(page.locator("[data-callout='readaloud']")).toContainText(
    "Der Turm ragt schwarz gegen den Abendhimmel auf.",
  );
  await expect(page.getByRole("article")).not.toContainText("nie gespeichert wird");
  // Nothing reached the disk.
  expect(await api.raw(SCENE)).toBe(before.raw);
});

test("the NPC reading view edits its body the same way", async ({ page, api }) => {
  const before = await split(api, NPC);
  const added = "- metta: schuldet Jorna einen Gefallen aus dem letzten Herbst";

  await page.goto(`/beispiel/file/${NPC}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");

  await openRawEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(before.body.replace("## Notizen", `${added}\n\n## Notizen`));
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(textarea).toHaveCount(0);
  // The NPC header (quickstats, voice) stands untouched around the new body.
  await expect(page.getByRole("article")).toContainText("knapp, wetterrau, duzt jeden");
  await expect(page.getByRole("article")).toContainText("schuldet Jorna einen Gefallen");

  await expect.poll(() => api.raw(NPC)).toContain(added);
  const after = await split(api, NPC);
  expect(after.properties).toBe(before.properties);
});

test("location and chapter offer the editor, session and inbox do not", async ({ page, api }) => {
  // The kinds whose prose the DM maintains offer the body editor …
  for (const rel of ["locations/leuchtturm", "01-salzhafen/_chapter"]) {
    await page.goto(`/beispiel/file/${rel}`);
    await openRawEditor(page);
    await expect(page.getByRole("textbox", { name: TEXTAREA })).toBeVisible();
    // Clean exit — no dialog, nothing written.
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("textbox", { name: TEXTAREA })).toHaveCount(0);
  }

  // … the append-only logs do not: a free-hand rewrite of a log is not a
  // maintenance action (ADR #4).
  await page.goto("/beispiel/file/sessions/2026-01-15");
  await expect(page.getByRole("article")).toContainText("Spuren gefunden");
  // A session's heading is its DATE, derived from `started` — the id is opaque
  // since issue #58 and is never shown. (This fixture still carries the old
  // date-shaped id, which must make no difference to the heading.)
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toHaveText(
    "Session vom 15.01.2026",
  );
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);

  await page.goto("/beispiel/file/inbox");
  await expect(page.getByRole("article")).toContainText("Der Dorfschmied repariert");
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);

  // And the rule belongs to the ENDPOINT, not to the hidden button: a
  // hand-made PUT on an append-only file is refused, nothing is written.
  for (const rel of ["sessions/2026-01-15", "inbox"]) {
    const rawBefore = await api.raw(rel);
    const res = await page.request.put("/api/beispiel/file", {
      data: { path: rel, rev: Date.now(), body: "\nAlles neu.\n" },
    });
    expect(res.status()).toBe(400);
    expect(await api.raw(rel)).toBe(rawBefore);
  }
});

test("_campaign keeps its ONE Bearbeiten — the metadata dialog", async ({ page }) => {
  await page.goto("/beispiel/file/_campaign");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );

  // One label, one meaning (issue #34): the campaign file's „Bearbeiten" is
  // the name/description dialog, and there is no second one for the body.
  const edit = page.getByRole("button", { name: "Bearbeiten" });
  await expect(edit).toHaveCount(1);
  await edit.click();
  await expect(page.getByRole("dialog")).toContainText("Kampagne bearbeiten");
  await expect(page.getByRole("textbox", { name: TEXTAREA })).toHaveCount(0);
});

test("the glossary stays saveable while a session writes next to it", async ({ page, api }) => {
  // Critical path 9 for the campaign's list document, and the regression of a
  // cutover bug: `glossary` was guarded by `campaigns.version`, which EVERY
  // write bumps. A quick note during a running session therefore answered the
  // DM's open glossary edit with „Inzwischen geändert" — un-saveable exactly
  // while the campaign is in use. Each document carries its own token now.
  await page.goto("/beispiel/file/glossary");
  await expect(page.getByRole("article")).toContainText("Leuchtturmwärter");

  await openRawEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toBeVisible();

  // Something unrelated happens in the campaign while the editor stands open.
  await api.send("POST", "beispiel/session/start");
  await api.send("POST", "beispiel/log", { text: "Die Gruppe betritt den Turm" });

  const added = "- tide pool → Gezeitentümpel";
  await textarea.fill(`${await textarea.inputValue()}${added}\n`);
  const save = page.getByRole("button", { name: "Speichern" });
  await expect(save).toBeEnabled();
  await save.click();

  // No conflict, and the new term is stored and rendered.
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText("Gezeitentümpel");
  await expect.poll(() => api.raw("glossary")).toContain(added);
  // The structured endpoint agrees — the body was decomposed into rows.
  const glossary = await api.get<{ entries: Array<{ term: string }> }>("beispiel/glossary");
  expect(glossary.entries.map((e) => e.term)).toContain("tide pool");

  // A REAL second writer still conflicts — the token did not become toothless.
  await openRawEditor(page);
  await expect(page.getByRole("textbox", { name: TEXTAREA })).toBeVisible();
  await api.writeBody("glossary", "\n- harbour master → Hafenmeisterin\n");
  await page.getByRole("textbox", { name: TEXTAREA }).fill("\n- ganz was anderes → nope\n");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText(STALE_MESSAGE)).toBeVisible();
});
