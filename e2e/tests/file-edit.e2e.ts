// Critical path 9: editing a file's markdown body in the app — open → change
// the body → save → rendered; 409 on an external change means reload instead
// of a silent overwrite; see CLAUDE.md.
//
// The write goes through the documented API with its mtime check (PUT /file,
// CLAUDE.md), and the frontmatter block must come out byte-identical — so
// every assertion here reads the file back from disk and compares the block
// against the one that was there before.
//
// Unlike the status control (critical path 7) the conflict is DETERMINISTIC:
// the editor freezes the mtime it was seeded from, on purpose, so the ~5s
// version poll cannot heal the staleness while the DM types. No retry loop.
//
// The other half of that freeze is what must NOT become a conflict: the status
// regler right next to the editor writes a new version of the same body, and
// the DM's own click may not answer their save with „Datei extern geändert".
// Two more ways to lose text are covered here as well — a navigation must not
// leave edit mode armed, and a failing background refetch must not tear the
// open editor down.

import { expect, test, type CampaignFiles } from "../support/test";

const SCENE = "01-salzhafen/hafen/ankunft-leuchtturm.md";
const SCENE_URL = `/beispiel/file/${SCENE}`;
const NPC = "npcs/jorna.md";
const STALE_MESSAGE = "Datei extern geändert — neu laden";
/** aria-label of the raw-markdown textarea (FileBodyEditor). */
const TEXTAREA = "Markdown-Text der Datei";

/**
 * The frontmatter block including both fences and the newline after the
 * closing one — what PUT /file promises to leave alone.
 */
function frontmatterBlock(raw: string): string {
  const match = /^---\n[\s\S]*?\n---\n/.exec(raw);
  expect(match, "the fixture file has no frontmatter block").not.toBeNull();
  return match?.[0] ?? "";
}

/** Read the file and hand back its frontmatter block and the rest. */
async function split(files: CampaignFiles, rel: string) {
  const raw = await files.read(rel);
  const frontmatter = frontmatterBlock(raw);
  return { raw, frontmatter, body: raw.slice(frontmatter.length) };
}

test("editing the body: save writes the file and the reading view shows it", async ({
  page,
  files,
}) => {
  const before = await split(files, SCENE);
  const added = "Am Fuß der Treppe liegt eine angelaufene Messingpfeife im Sand.";

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // The trigger sits in the header action row, next to „Umbenennen".
  await page.getByRole("button", { name: "Bearbeiten" }).click();

  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toBeVisible();
  // Seeded with the body — WITHOUT the frontmatter, which this editor never
  // touches (and says so).
  await expect(textarea).toHaveValue(before.body);
  await expect(page.getByText("Nur der Textkörper — Frontmatter bleibt unverändert.")).toBeVisible();
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

  // On disk: frontmatter block byte-identical, body exactly what was typed.
  await expect.poll(() => files.read(SCENE)).toContain(added);
  const after = await split(files, SCENE);
  expect(after.frontmatter).toBe(before.frontmatter);
  expect(after.body).toBe(`${before.body}\n${added}\n`);
});

test("the preview toggle renders the draft through the real markdown pipeline", async ({
  page,
  files,
}) => {
  const before = await split(files, SCENE);
  const loot = "> [!loot] Eine angelaufene Messingpfeife, Gravur: „Nordbucht“.";

  await page.goto(SCENE_URL);
  // The rendered body is on screen before edit mode …
  await expect(page.locator("[data-callout='readaloud']")).toHaveCount(1);
  await page.getByRole("button", { name: "Bearbeiten" }).click();

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

  // Back to the text, unchanged by the round trip …
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(textarea).toHaveValue(`${before.body}\n${loot}\n`);

  // … and saved, the callout is part of the file.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.locator("[data-callout='loot']")).toContainText(
    "Eine angelaufene Messingpfeife",
  );
  const after = await split(files, SCENE);
  expect(after.frontmatter).toBe(before.frontmatter);
  expect(after.body).toContain(loot);
});

test("externally changed file: the save reports the conflict, the second one works", async ({
  page,
  files,
}) => {
  const before = await split(files, SCENE);
  const mine = "Von der DM im Editor der App ergänzt.";
  // Same frontmatter, different body — only the mtime moves, and that is what
  // the server compares against. The "saved it in the external editor while
  // the app was open" case.
  const externalBody = "\n## Flow\n\nVon Hand im externen Editor geändert.\n";

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);

  // The file moves under the open editor. No race to win: the editor holds the
  // mtime it started from until a conflict tells it otherwise, so the version
  // poll cannot make this write succeed silently.
  await files.write(SCENE, `${before.frontmatter}${externalBody}`);
  await textarea.fill(`${before.body}\n${mine}\n`);
  await page.getByRole("button", { name: "Speichern" }).click();

  // Refused, and said so — quietly, in the editor's own message line.
  await expect(page.getByText(STALE_MESSAGE)).toBeVisible();
  // The editor stays open and the typed text survives — that is the point.
  await expect(textarea).toHaveValue(`${before.body}\n${mine}\n`);
  // Nothing was written: the external content stands, untouched.
  const conflicted = await split(files, SCENE);
  expect(conflicted.body).toBe(externalBody);
  expect(conflicted.frontmatter).toBe(before.frontmatter);

  // The editor re-read the file, so the SAME click works now — deliberately
  // on top of the external body: the DM saw the message and decided.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);

  await expect.poll(() => files.read(SCENE)).toContain(mine);
  const after = await split(files, SCENE);
  expect(after.frontmatter).toBe(before.frontmatter);
  expect(after.body).toBe(`${before.body}\n${mine}\n`);
  expect(after.body).not.toContain("Von Hand im externen Editor");
});

test("the status regler next to the editor is no conflict for the own save", async ({
  page,
  files,
}) => {
  const before = await split(files, SCENE);
  const mine = "Während des Statuswechsels geschrieben.";

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}\n${mine}\n`);

  // The pill stays usable while the editor runs (issue #28) — and its PATCH
  // bumps the file's mtime without touching one byte of the body.
  const trigger = page.getByRole("button", { name: /^Status ändern, aktuell/ });
  await trigger.click();
  await page.getByRole("menuitemradio", { name: "gespielt" }).click();
  await expect(trigger).toHaveText(/gespielt/);
  await expect.poll(() => files.read(SCENE)).toContain("status: played");

  // The DM's OWN change must not come back as „Datei extern geändert": a new
  // version with an identical body is adopted, a changed body still 409s.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.getByText(STALE_MESSAGE)).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);

  await expect.poll(() => files.read(SCENE)).toContain(mine);
  const after = await split(files, SCENE);
  expect(after.body).toBe(`${before.body}\n${mine}\n`);
  expect(after.frontmatter).toContain("status: played");
});

test("navigating away ends edit mode — coming back never re-opens it", async ({ page, files }) => {
  const before = await split(files, SCENE);

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await textarea.fill(`${before.body}\nEin Satz, der die Navigation nicht überlebt.\n`);

  // In-app navigation to the scene's NPC (the aside card): the SAME route with
  // another path, so the view is not remounted and could carry edit mode over.
  await page.getByRole("link", { name: /Jorna/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");
  await expect(textarea).toHaveCount(0);

  // Back on the scene: the reading view. An editor seeded from disk would look
  // exactly like the one the DM left — with their paragraph silently missing.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
  await expect(page.locator("[data-callout='readaloud']")).toBeVisible();
  expect(await files.read(SCENE)).toBe(before.raw);
});

test("a failing background refetch leaves the open editor standing", async ({ page, files }) => {
  const before = await split(files, SCENE);
  const draft = `${before.body}\nGeschrieben, während der Server weg war.\n`;

  await page.goto(SCENE_URL);
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(draft);

  // Every further READ of this file fails — a restarted server, a network
  // blip. The write endpoint (PUT, no query string) stays reachable.
  // Counted per file: the NPC card of this scene reads through the same
  // endpoint, and its failures say nothing about the scene's query.
  let aborted = 0;
  await page.route("**/api/beispiel/file?**", (route) => {
    if (route.request().url().includes("ankunft-leuchtturm")) aborted++;
    void route.abort();
  });
  // The version poll (~5s) notices the change on disk and refetches, so the
  // file query runs into the abort (retry: 1 -> two attempts, then 'error').
  await files.write(SCENE, `${before.frontmatter}\n## Flow\n\nVon außen geändert.\n`);
  await expect.poll(() => aborted, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // The cached file is still there, so the PAGE must not swap itself for its
  // error line and take the unsaved text with it. (The status pill next to the
  // editor says „Datei nicht ladbar" for its own failed read — that is its job
  // and stays, which is why this looks for the route's full sentence.)
  await expect(page.getByText("Datei nicht ladbar — Pfad prüfen")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(textarea).toHaveValue(draft);
});

test("Abbrechen asks before it throws work away", async ({ page, files }) => {
  const before = await split(files, SCENE);

  await page.goto(SCENE_URL);

  // Without changes there is nothing to lose: no dialog, straight out.
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveCount(0);

  // With changes it asks — and „Weiter bearbeiten" keeps the text.
  await page.getByRole("button", { name: "Bearbeiten" }).click();
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
  expect(await files.read(SCENE)).toBe(before.raw);
});

test("the NPC reading view edits its body the same way", async ({ page, files }) => {
  const before = await split(files, NPC);
  const added = "- metta: schuldet Jorna einen Gefallen aus dem letzten Herbst";

  await page.goto(`/beispiel/file/${NPC}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");

  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(before.body.replace("## Notizen", `${added}\n\n## Notizen`));
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(textarea).toHaveCount(0);
  // The NPC header (quickstats, voice) stands untouched around the new body.
  await expect(page.getByRole("article")).toContainText("knapp, wetterrau, duzt jeden");
  await expect(page.getByRole("article")).toContainText("schuldet Jorna einen Gefallen");

  await expect.poll(() => files.read(NPC)).toContain(added);
  const after = await split(files, NPC);
  expect(after.frontmatter).toBe(before.frontmatter);
});

test("location and chapter offer the editor, session and inbox do not", async ({ page, files }) => {
  // The kinds whose prose the DM maintains offer the body editor …
  for (const rel of ["locations/leuchtturm.md", "01-salzhafen/_chapter.md"]) {
    await page.goto(`/beispiel/file/${rel}`);
    await page.getByRole("button", { name: "Bearbeiten" }).click();
    await expect(page.getByRole("textbox", { name: TEXTAREA })).toBeVisible();
    // Clean exit — no dialog, nothing written.
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("textbox", { name: TEXTAREA })).toHaveCount(0);
  }

  // … the append-only logs do not: a free-hand rewrite of a log is not a
  // maintenance action (ADR #4).
  await page.goto("/beispiel/file/sessions/2026-01-15.md");
  await expect(page.getByRole("article")).toContainText("Spuren gefunden");
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);

  await page.goto("/beispiel/file/inbox.md");
  await expect(page.getByRole("article")).toContainText("Der Dorfschmied repariert");
  await expect(page.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);

  // And the rule belongs to the ENDPOINT, not to the hidden button: a
  // hand-made PUT on an append-only file is refused, nothing is written.
  for (const rel of ["sessions/2026-01-15.md", "inbox.md"]) {
    const rawBefore = await files.read(rel);
    const res = await page.request.put("/api/beispiel/file", {
      data: { path: rel, mtimeMs: Date.now(), body: "\nAlles neu.\n" },
    });
    expect(res.status()).toBe(400);
    expect(await files.read(rel)).toBe(rawBefore);
  }
});

test("_campaign.md keeps its ONE Bearbeiten — the metadata dialog", async ({ page }) => {
  await page.goto("/beispiel/file/_campaign.md");
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
