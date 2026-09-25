// Critical path 9: editing a markdown body in the app — open → change the body
// → save → rendered; 409 on a CONCURRENT SECOND WRITE offers the two answers
// instead of silently overwriting; see CLAUDE.md.
//
// The database is the only truth (ADR #13), so "someone changed the scene
// outside" cannot happen — the conflict this path is about is a second write
// through the API while the editor stands open. A scene is written through its
// own resource, PATCH …/scenes/<id> with `rev` (ADR #31); its other fields
// must come out untouched, and every assertion reads the scene back through
// the API.
//
// Unlike the status control (critical path 7) the conflict is DETERMINISTIC:
// the editing session holds the version it started from and sends it with every
// attempt, so the ~5s version poll cannot heal the staleness while the DM
// types. No retry loop.
//
// Because fields and text share ONE row and ONE version, a second write that
// touched only the status is a conflict just like a text one — a status set
// next to the open editor is not adopted behind the DM's back. A refused save
// keeps the draft and offers exactly two answers, and the spec drives both:
// reloading adopts the stored scene, forcing writes only the fields this
// request carries, so the other writer's status survives a forced text save.
//
// An npc and a location keep one prose FIELD beside their text —
// `motivation` and `atmosphere` (ADR #29) — and the edit surface carries it:
// set, cleared, saved in the same write as the text, and under the same
// guard, so the conflict line and both of its answers hold for it too. The
// properties dialog does not show it. Both are their own resources (ADR #31)
// and are read back from there.
//
// Two more ways to lose text are covered here as well — a navigation must not
// leave edit mode armed, and a failing background refetch must not tear the
// open editor down.
//
// The edit action opens the BLOCK COMPOSER, so this spec covers the raw
// markdown half of edit mode: the textarea, its preview and the whole
// save/409/discard machinery as seen from the fallback surface. The composer
// itself — and the fact that it is the default — is
// `tests/block-composer.e2e.ts`, on the same critical path.

import type { Page } from "@playwright/test";

import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { campaignPath, getCampaign } from "../support/campaign";
import { chapterPath, getChapter, patchChapter } from "../support/chapter";
import { getLocation } from "../support/location";
import { getNpc, npcExists, patchNpc } from "../support/npc";
import { getScene, patchScene, scenePath } from "../support/scene";
import { createGlossaryTerm, getGlossaryTerms } from "../support/glossary-term";

const SCENE = "lighthouse-arrival";
const SCENE_URL = `/campaigns/beispiel/scenes/${SCENE}`;
/** The npc the npc cases edit — its own resource and route (ADR #31). */
const NPC = "jorna";
const NPC_URL = `/campaigns/beispiel/npcs/${NPC}`;
/** The shared conflict line (EditConflict) — the only role="alert" of the app. */
const CONFLICT_LINE = "Inzwischen geändert";
/** aria-label of the raw-markdown textarea (BodyEditor). */
const TEXTAREA = "Markdown-Text von";

/**
 * Read a scene: its text, and every other field beside it — what a text save
 * has to leave alone.
 */
async function sceneSplit(api: Api, id: string = SCENE) {
  const { body, rev: _rev, ...fields } = await getScene(api, id);
  return { fields, body };
}

/** A scene's text. */
async function sceneBody(api: Api, id: string = SCENE): Promise<string> {
  return (await getScene(api, id)).body;
}

/** Read the npc: its fields, `body` among them, without its guard. */
async function npcFields(api: Api) {
  const { rev: _rev, ...fields } = await getNpc(api, NPC);
  return fields;
}

/**
 * The conflict line of the surface under test, with its two actions.
 *
 * Scoped to the alert role on purpose: the status control next to the editor
 * has a stale message of its own whose wording starts with the same words, and
 * a plain text match would not tell the two apart.
 */
function conflict(page: Page) {
  const line = page.getByRole("alert").filter({ hasText: CONFLICT_LINE });
  return {
    line,
    reload: line.getByRole("button", { name: "Neu laden" }),
    force: line.getByRole("button", { name: "Trotzdem speichern" }),
  };
}

/**
 * Enter edit mode and switch to the raw markdown surface.
 *
 * The edit action opens the block composer, so everything the
 * fallback surface owns costs one more click: the raw-markdown side of the mode
 * toggle. Switching is lossless by construction (the draft round-trips through
 * serializeBlocks/parseBlocks), which is why the textarea below is still
 * seeded with the entry's body byte for byte and the save button is still
 * disabled right after opening.
 */
async function openMarkdownEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  // exact: the composer's per-card controls carry a numbered block name of
  // their own that starts with the same word.
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
}

test("editing the body: save writes the entry and the reading view shows it", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const added = "Am Fuß der Treppe liegt eine angelaufene Messingpfeife im Sand.";

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");

  // The trigger sits in the header action row, next to the properties action;
  // raw markdown is the fallback surface this spec is about.
  await openMarkdownEditor(page);

  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toBeVisible();
  // Seeded with the body — WITHOUT the other fields, which this editor never
  // touches (and says so).
  await expect(textarea).toHaveValue(before.body);
  await expect(page.getByText("Nur der Textkörper — die Eigenschaften bleiben unverändert.")).toBeVisible();
  // The header keeps standing: title, chips and the status control stay put.
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Bereit" })).toBeVisible();
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

  // Stored: every other field untouched, body exactly what was typed.
  await expect.poll(() => sceneBody(api)).toContain(added);
  const after = await sceneSplit(api);
  expect(after.fields).toEqual(before.fields);
  expect(after.body).toBe(`${before.body}\n${added}\n`);
});

test("a mention in the text stays text — nothing created, no error", async ({ page, api }) => {
  // A reference names something that exists (ADR #19) — but a MENTION in
  // the body is not a reference: `[[niemand]]` and a `## Beziehungen` line
  // are prose. Saving them is a normal save: nothing is created, nothing is
  // refused, and the text comes back as written.
  const before = await npcFields(api);
  const mention = "Sie spricht von [[niemand]] und meint es ernst.";
  const relation = "- holm: schuldet ihr noch Hafengeld";

  await page.goto(NPC_URL);
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await textarea.fill(`${before.body}\n${mention}\n\n## Beziehungen\n\n${relation}\n`);
  await page.getByRole("button", { name: "Speichern" }).click();

  // Saved, rendered, and readable as typed — the unknown slug included.
  await expect(textarea).toHaveCount(0);
  const article = page.getByRole("article");
  await expect(article).toContainText("[[niemand]]");
  // Rendered as the list item it is, so without the markdown dash.
  await expect(article).toContainText("holm: schuldet ihr noch Hafengeld");
  // …and neither mention brought an npc into existence.
  expect(await npcExists(api, "niemand")).toBe(false);
  expect(await npcExists(api, "holm")).toBe(false);
  const after = await npcFields(api);
  expect(after.body).toContain(mention);
  expect(after.body).toContain(relation);
});

test("a scene whose location changed stays at its route and stays editable", async ({
  page,
  api,
}) => {
  // A scene is reached by its id (ADR #31): correcting its location changes a
  // field, not the link — a bookmark written before still opens it, and the
  // text saves through it like any other edit.
  // The location has to exist before a scene can name it (ADR #19).
  await api.send("POST", "campaigns/beispiel/locations", { name: "Nordbucht" });
  await patchScene(api, SCENE, { location: "nordbucht" });

  await page.goto(SCENE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(page).toHaveURL(new RegExp(`${SCENE_URL}$`));

  const before = await sceneSplit(api);
  const added = "Der Weg zur Nordbucht ist bei Ebbe trocken.";
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await textarea.fill(`${before.body}\n${added}\n`);
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(added);
  await expect.poll(() => sceneBody(api)).toContain(added);
  // …and the other fields are untouched, the changed `location` included.
  const after = await sceneSplit(api);
  expect(after.fields).toEqual(before.fields);
});

test("the preview toggle renders the draft through the real markdown pipeline", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const loot = "> [!loot] Eine angelaufene Messingpfeife, Gravur: „Nordbucht“.";

  await page.goto(SCENE_URL);
  // The rendered body is on screen before edit mode …
  await expect(page.locator("[data-callout='readaloud']")).toHaveCount(1);
  await openMarkdownEditor(page);

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

  // Back to the text, unchanged by the round trip. This edit action is the raw
  // markdown surface's own preview/edit toggle, not the header trigger — that
  // one is gone while edit mode runs, and the blocks switch is a button of its
  // own, so the name stays unambiguous.
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  await expect(textarea).toHaveValue(`${before.body}\n${loot}\n`);

  // … and saved, the callout is part of the entry.
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(page.locator("[data-callout='loot']")).toContainText(
    "Eine angelaufene Messingpfeife",
  );
  const after = await sceneSplit(api);
  expect(after.fields).toEqual(before.fields);
  expect(after.body).toContain(loot);
});

test("a concurrent second write: the save reports the conflict, the second one works", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const mine = "Von der DM im Editor der App ergänzt.";
  // Same fields, different body — only the row's guard token moves, and
  // that is what the server compares against.
  const otherBody = "\n## Flow\n\nVon einem zweiten Schreiber geändert.\n";

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);

  // A SECOND WRITE lands while the editor stands open: the same PATCH the app
  // uses, with a token fetched a moment ago, so it succeeds and bumps the row.
  // No race to win — the editing session holds the version it started from
  // until the DM answers the conflict, so the version poll cannot make the
  // app's write succeed silently.
  await patchScene(api, SCENE, { body: otherBody });
  await textarea.fill(`${before.body}\n${mine}\n`);
  await page.getByRole("button", { name: "Speichern" }).click();

  // Refused, and said so — quietly, under the editor that holds the draft,
  // with both honest answers as controls.
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  await expect(conflicted.force).toBeVisible();
  // The editor stays open and the typed text survives — that is the point.
  await expect(textarea).toHaveValue(`${before.body}\n${mine}\n`);
  // Nothing was written: the other writer's body stands, untouched.
  const stored = await sceneSplit(api);
  expect(stored.body).toBe(otherBody);
  expect(stored.fields).toEqual(before.fields);

  // Reloading adopts what is stored: the draft is gone and there is nothing
  // left to save. The SURFACE stays as it was — the same textarea is still
  // standing, now holding the adopted text byte for byte. Answering a conflict
  // is not a reason to move the DM onto the other surface.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await expect(textarea).toHaveValue(otherBody);
  expect(await sceneSplit(api)).toEqual(stored);

  // And from that adopted version the DM's sentence saves in one click —
  // deliberately on top of the other writer's body: they saw it and decided.
  await textarea.fill(`${otherBody}${mine}\n`);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(textarea).toHaveCount(0);
  await expect(conflicted.line).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);

  await expect.poll(() => sceneBody(api)).toContain(mine);
  const after = await sceneSplit(api);
  expect(after.fields).toEqual(before.fields);
  expect(after.body).toBe(`${otherBody}${mine}\n`);
});

// Fields and text are ONE row and ONE version (ADR #23), so a write that
// touched only the status makes an open editor's version stale exactly like
// a text write does. That is deliberate: there is no "text-neutral" change the
// editor may adopt on its own, because adopting one means writing the draft
// against a row the DM has not seen.
//
// The status control right next to the editor is the everyday way this happens,
// and it is the DM's own click — so the conflict has to be answerable, not just
// reported. These two tests are the same setup and the two answers.
test("a status-only second write conflicts too — reloading adopts it", async ({
  page,
  api,
}) => {
  const opened = await getScene(api, SCENE);
  const before = { body: opened.body };
  const mine = "Während des Statuswechsels geschrieben.";

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}\n${mine}\n`);

  // The status of THIS scene is set out of band, with a token fetched a moment
  // ago: one field, not one byte of the body — and the row's version moves
  // all the same.
  const bumped = (await patchScene(api, SCENE, { status: "played" })).rev;
  expect(bumped).toBe(opened.rev + 1);

  await page.getByRole("button", { name: "Speichern" }).click();

  // Refused, with both answers offered.
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  await expect(conflicted.reload).toBeVisible();
  await expect(conflicted.force).toBeVisible();
  await expect(textarea).toHaveValue(`${before.body}\n${mine}\n`);
  // Nothing of the draft was written.
  const stored = await sceneSplit(api);
  expect(stored.body).toBe(before.body);
  expect(stored.fields.status).toBe("played");

  // Reloading drops the draft and continues from what is stored: the saved
  // text is back in the textarea and the changed status is on the page.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Status ändern, aktuell/ })).toHaveText(
    /Gespielt/,
  );
  // Still the same textarea: reseeding keeps the surface.
  await expect(textarea).toHaveValue(before.body);
  // The sentence is gone, as the DM asked — nothing was written at all.
  expect(await sceneSplit(api)).toEqual(stored);
});

test("a forced save writes only the text — the other writer's status survives", async ({
  page,
  api,
}) => {
  const before = await sceneSplit(api);
  const mine = "Trotz des Statuswechsels gespeichert.";

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}\n${mine}\n`);

  await patchScene(api, SCENE, { status: "played" });
  await page.getByRole("button", { name: "Speichern" }).click();

  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();

  // Forcing writes the refused fields on top of the row as it stands — and this
  // editor carries the body only, so the status set in between is untouched.
  await conflicted.force.click();
  await expect(textarea).toHaveCount(0);
  await expect(conflicted.line).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);

  await expect.poll(() => sceneBody(api)).toContain(mine);
  const after = await sceneSplit(api);
  expect(after.body).toBe(`${before.body}\n${mine}\n`);
  expect(after.fields).toEqual({ ...before.fields, status: "played" });
  // And the page agrees, without a reload.
  await expect(page.getByRole("button", { name: /^Status ändern, aktuell/ })).toHaveText(
    /Gespielt/,
  );
});

// Fields and text in ONE request are asserted here on the write path itself,
// for a scene (whose edit surface sends `body` alone); the npc's edit surface,
// which sends text and motivation together, has its own cases below. One
// PATCH, one transaction, ONE step of the version — how much a request carried
// is not readable from `rev`.
test("fields and body in ONE write are one version step", async ({ api }) => {
  const opened = await getScene(api, SCENE);
  const before = await sceneSplit(api);
  const rev = opened.rev;
  const body = `${before.body}\nIn einem Zug mit den Feldern geschrieben.\n`;

  const written = await patchScene(api, SCENE, {
    rev,
    status: "played",
    tags: ["social", "travel", "zusammen"],
    body,
  });

  expect(written.rev).toBe(rev + 1);
  expect(written.body).toBe(body);
  expect(written.status).toBe("played");

  const after = await sceneSplit(api);
  expect(after.body).toBe(body);
  expect(after.fields).toEqual({
    ...before.fields,
    status: "played",
    tags: ["social", "travel", "zusammen"],
  });

  // A request that names no field is refused rather than counted as a write.
  const empty = await api.fetch(scenePath(api, SCENE), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: written.rev }),
  });
  expect(empty.status).toBe(400);
  expect(await empty.json()).toMatchObject({ code: "nothing_to_write" });
  expect((await getScene(api, SCENE)).rev).toBe(written.rev);
});

test("navigating away ends edit mode — coming back never re-opens it", async ({ page, api }) => {
  const before = await sceneSplit(api);

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
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
  expect(await sceneSplit(api)).toEqual(before);
});

test("a failing background refetch leaves the open editor standing", async ({ page, api }) => {
  const before = await sceneSplit(api);
  const draft = `${before.body}\nGeschrieben, während der Server weg war.\n`;

  await page.goto(SCENE_URL);
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(draft);

  // Every further READ of this scene fails — a restarted server, a network
  // blip. Only GET is blocked, so the write endpoint stays reachable.
  let aborted = 0;
  await page.route("**/api/campaigns/beispiel/scenes/**", (route) => {
    if (route.request().method() !== "GET") {
      void route.fallback();
      return;
    }
    if (route.request().url().includes("lighthouse-arrival")) aborted++;
    void route.abort();
  });
  // The version poll (~5s) notices the second writer's change and refetches,
  // so the scene query runs into the abort (retry: 1 -> two attempts, then
  // 'error'). The write goes through the API: only the app's own READ of this
  // scene is blocked, the server stays reachable.
  await patchScene(api, SCENE, { body: "\n## Flow\n\nVon einem zweiten Schreiber geändert.\n" });
  await expect.poll(() => aborted, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // The cached scene is still there, so the PAGE must not swap itself for its
  // error line and take the unsaved text with it.
  await expect(page.getByText("Eintrag nicht ladbar — Pfad prüfen")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(textarea).toHaveValue(draft);
});

test("Abbrechen asks before it throws work away", async ({ page, api }) => {
  const before = await sceneSplit(api);

  await page.goto(SCENE_URL);

  // Without changes there is nothing to lose: no dialog, straight out — the
  // detour through raw markdown and back is no change either (lossless round trip).
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveCount(0);

  // With changes it asks — and continuing to edit keeps the text.
  await openMarkdownEditor(page);
  await textarea.fill(`${before.body}\nEin Satz, der nie gespeichert wird.\n`);
  await page.getByRole("button", { name: "Abbrechen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Änderungen verwerfen?");
  await dialog.getByRole("button", { name: "Weiter bearbeiten" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveValue(/Ein Satz, der nie gespeichert wird\./);

  // Discarding closes the editor and the reading view is as it was.
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Verwerfen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(textarea).toHaveCount(0);
  await expect(page.locator("[data-callout='readaloud']")).toContainText(
    "Der Turm ragt schwarz gegen den Abendhimmel auf.",
  );
  await expect(page.getByRole("article")).not.toContainText("nie gespeichert wird");
  // Nothing was written.
  expect(await sceneSplit(api)).toEqual(before);
});

test("the NPC reading view edits its body the same way", async ({ page, api }) => {
  const before = await npcFields(api);
  const added = "- metta: schuldet Jorna einen Gefallen aus dem letzten Herbst";

  await page.goto(NPC_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hafenmeisterin Jorna");

  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}${added}\n`);
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(textarea).toHaveCount(0);
  // The NPC header (quickstats, voice) stands untouched around the new body.
  await expect(page.getByRole("article")).toContainText("knapp, wetterrau, duzt jeden");
  await expect(page.getByRole("article")).toContainText("schuldet Jorna einen Gefallen");

  await expect.poll(async () => (await getNpc(api, NPC)).body).toContain(added);
  // Every other field of the npc is as it was.
  const { body: _before, ...fieldsBefore } = before;
  const { body: _after, ...fieldsAfter } = await npcFields(api);
  expect(fieldsAfter).toEqual(fieldsBefore);
});

test("a location and a chapter offer the editor on their own routes", async ({ page }) => {
  // The entities whose prose the DM maintains offer the body editor — each on
  // its own route (ADR #31).
  for (const url of [
    "/campaigns/beispiel/locations/leuchtturm",
    "/campaigns/beispiel/chapters/01-salzhafen",
  ]) {
    await page.goto(url);
    await openMarkdownEditor(page);
    await expect(page.getByRole("textbox", { name: TEXTAREA })).toBeVisible();
    // Clean exit — no dialog, nothing written.
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("textbox", { name: TEXTAREA })).toHaveCount(0);
  }
});

test("a chapter's text is edited on its reading view; its other fields stay", async ({
  page,
  api,
}) => {
  const before = await getChapter(api, "01-salzhafen");
  const added = "Wer das Feuer löscht, will nicht gesehen werden.";

  await page.goto("/campaigns/beispiel/chapters/01-salzhafen");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Kapitel 1: Der Leuchtturm von Salzhafen",
  );
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await expect(textarea).toHaveValue(before.body);
  await textarea.fill(`${before.body}\n${added}\n`);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();

  // The editor closes and the reading view renders the new text.
  await expect(textarea).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(added);
  const after = await getChapter(api, "01-salzhafen");
  expect(after.body).toBe(`${before.body}\n${added}\n`);
  // Only the text was sent: title and status are as they were.
  expect({ title: after.title, status: after.status }).toEqual({
    title: before.title,
    status: before.status,
  });
});

test("a chapter's text and a second writer: the conflict line, and „Neu laden“ adopts it", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel/chapters/01-salzhafen");
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await textarea.fill("Mein Entwurf.\n");

  // The second writer: a status change of the same row, its own fresh rev.
  await patchChapter(api, "01-salzhafen", { status: "done" });
  await page.getByRole("button", { name: "Speichern", exact: true }).click();

  // Nothing written — the draft stays, the conflict line asks.
  await expect(page.getByRole("alert")).toContainText(CONFLICT_LINE);
  await expect(textarea).toHaveValue("Mein Entwurf.\n");
  expect((await getChapter(api, "01-salzhafen")).body).not.toContain("Mein Entwurf.");

  await page.getByRole("button", { name: "Neu laden" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(textarea).toHaveValue((await getChapter(api, "01-salzhafen")).body);
  expect((await getChapter(api, "01-salzhafen")).status).toBe("done");
});

test("the chapter and the campaign are their own resources; the entry addresses are gone", async ({
  api,
}) => {
  // Every field flat, `body` among them, beside the guard — no `kind`, no
  // `path`, no `properties`.
  const chapter = await getChapter(api, "01-salzhafen");
  expect(Object.keys(chapter).sort()).toEqual(["body", "id", "rev", "status", "title"]);
  expect(chapter).toMatchObject({
    id: "01-salzhafen",
    title: "Kapitel 1: Der Leuchtturm von Salzhafen",
    status: "active",
  });
  const campaign = await getCampaign(api);
  expect(Object.keys(campaign).sort()).toEqual(["body", "description", "id", "name", "rev"]);
  expect(campaign.name).toBe("Der Leuchtturm von Salzhafen");

  // A stale rev is 409 with the current state and writes nothing.
  const staleChapter = await api.fetch(chapterPath(api, "01-salzhafen"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: chapter.rev - 1, title: "Veraltet" }),
  });
  expect(staleChapter.status).toBe(409);
  expect(((await staleChapter.json()) as { chapter: { title: string } }).chapter.title).toBe(
    chapter.title,
  );
  const staleCampaign = await api.fetch(campaignPath(api), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: campaign.rev - 1, name: "Veraltet" }),
  });
  expect(staleCampaign.status).toBe(409);
  expect((await getCampaign(api)).name).toBe(campaign.name);

  // A field the entity does not have is a 400 that names it.
  const unknownChapter = await api.fetch(chapterPath(api, "01-salzhafen"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: chapter.rev, location: "leuchtturm" }),
  });
  expect(unknownChapter.status).toBe(400);
  expect(await unknownChapter.text()).toContain("location");
  const unknownCampaign = await api.fetch(campaignPath(api), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rev: campaign.rev, title: "Kein Feld der Kampagne" }),
  });
  expect(unknownCampaign.status).toBe(400);
  expect(await unknownCampaign.text()).toContain("title");
  expect(await getChapter(api, "01-salzhafen")).toEqual(chapter);

  // There is no general endpoint over several entities: every address the
  // former `…/entries/*` spelled answers 404 — the chapter, the campaign, the
  // lists, and the npc, location and scene that have their own resources. No
  // redirect and no alias — this is the ONE place the suite asserts it.
  for (const rel of [
    "01-salzhafen",
    "campaign",
    "sessions/2026-01-15",
    "inbox",
    "glossary",
    "npcs/jorna",
    "locations/leuchtturm",
    "01-salzhafen/lighthouse-arrival",
  ]) {
    const address = rel.split("/").map(encodeURIComponent).join("/");
    for (const method of ["GET", "PATCH"] as const) {
      const res = await api.fetch(`campaigns/beispiel/entries/${address}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify({ rev: 1, body: "\nAlles neu.\n" }),
      });
      expect(res.status).toBe(404);
    }
  }
});

test("a glossary term is a row of its own, kept on the glossary page", async ({ page, api }) => {
  // A glossary term is its own resource (ADR #31) and has no text to edit as
  // markdown. The glossary page is where the DM keeps the terms — row by
  // row, never as markdown.
  const created = await createGlossaryTerm(api, { term: "tide flat", explanation: "Gezeitenwatt" });
  expect((await getGlossaryTerms(api)).map((term) => term.id)).toContain(created.id);

  // The glossary page shows the term, and carries no markdown editor.
  await page.goto("/campaigns/beispiel/glossary");
  await expect(page.getByText("Gezeitenwatt")).toBeVisible();
  await expect(page.getByRole("textbox", { name: TEXTAREA })).toHaveCount(0);
});

// --- the prose field beside the text ------------------------------------------

/** The motivation field of the npc edit surface („Will“). */
function motivationField(page: Page) {
  return page.getByRole("textbox", { name: "Will", exact: true });
}

test("the npc edit surface carries the motivation: set with the text, cleared with null", async ({
  page,
  api,
}) => {
  const before = await npcFields(api);
  const mine = "Das Leuchtfeuer brennen sehen — und [[fenn]] endlich zur Rede stellen.";

  await page.goto(NPC_URL);
  await openMarkdownEditor(page);
  const field = motivationField(page);
  await expect(field).toHaveValue(String(before.motivation));
  await expect(
    page.getByText("Textkörper und Will — die übrigen Eigenschaften bleiben unverändert."),
  ).toBeVisible();

  // A field change alone is something to save.
  const save = page.getByRole("button", { name: "Speichern" });
  await expect(save).toBeDisabled();
  await field.fill(mine);
  await expect(save).toBeEnabled();
  await save.click();

  // Rendered in the header, the reference as the current name.
  await expect(field).toHaveCount(0);
  const article = page.getByRole("article");
  await expect(article).toContainText("und Fenn endlich zur Rede stellen");
  await expect(article).not.toContainText("[[fenn]]");
  const saved = await npcFields(api);
  // Only the motivation moved — the text was not touched, so it was not sent.
  expect(saved).toEqual({ ...before, motivation: mine });

  // Emptying the field clears it — no empty value stays behind.
  await openMarkdownEditor(page);
  await motivationField(page).fill("");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(motivationField(page)).toHaveCount(0);
  await expect.poll(async () => Object.hasOwn(await getNpc(api, NPC), "motivation")).toBe(false);
  await expect(article).not.toContainText("zur Rede stellen");
});

test("the location edit surface carries the atmosphere; the properties dialog shows neither", async ({
  page,
  api,
}) => {
  const before = await getLocation(api, "leuchtturm");
  const mine = "Kaltes Lampenöl, und der Wind pfeift durch die Wendeltreppe.";

  await page.goto("/campaigns/beispiel/locations/leuchtturm");
  // Not in the dialog: it is edited where the prose is edited.
  await page.getByRole("button", { name: "Eigenschaften" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Ort: Eigenschaften");
  await expect(dialog.getByRole("textbox", { name: "Atmosphäre" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(dialog).toHaveCount(0);

  await openMarkdownEditor(page);
  const field = page.getByRole("textbox", { name: "Atmosphäre", exact: true });
  await expect(field).toHaveValue(String(before.atmosphere));
  await field.fill(mine);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(field).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText(mine);
  const after = await getLocation(api, "leuchtturm");
  expect(after.atmosphere).toBe(mine);
  // The text was not touched, so it was not sent.
  expect(after.body).toBe(before.body);

  // …and the npc's dialog leaves the motivation out the same way.
  await page.goto(NPC_URL);
  await page.getByRole("button", { name: "Eigenschaften" }).click();
  await expect(page.getByRole("dialog")).toContainText("NPC: Eigenschaften");
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "Will" })).toHaveCount(0);
});

test("text and motivation share the guard: a second write is the conflict line — „Neu laden“ takes the stored state", async ({
  page,
  api,
}) => {
  const before = await npcFields(api);
  const theirs = "Die Hafenkasse retten, koste es, was es wolle.";

  await page.goto(NPC_URL);
  await openMarkdownEditor(page);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await motivationField(page).fill("Meine Fassung der Motivation.");
  await textarea.fill(`${before.body}
Meine Zeile.
`);

  // Somebody else writes the motivation while the surface stands.
  await patchNpc(api, NPC, { motivation: theirs });
  await page.getByRole("button", { name: "Speichern" }).click();

  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();
  // Nothing of the draft was written.
  expect((await getNpc(api, NPC)).motivation).toBe(theirs);
  expect((await getNpc(api, NPC)).body).toBe(before.body);

  // Reloading drops BOTH halves of the draft for the stored state.
  await conflicted.reload.click();
  await expect(conflicted.line).toHaveCount(0);
  await expect(motivationField(page)).toHaveValue(theirs);
  await expect(textarea).toHaveValue(before.body);
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
});

test("„Trotzdem speichern“ writes text and motivation — a foreign status survives", async ({
  page,
  api,
}) => {
  const before = await npcFields(api);
  const mine = "Trotz allem das Leuchtfeuer.";
  const line = "Trotz des Statuswechsels gespeichert.";

  await page.goto(NPC_URL);
  await openMarkdownEditor(page);
  await motivationField(page).fill(mine);
  const textarea = page.getByRole("textbox", { name: TEXTAREA });
  await textarea.fill(`${before.body}
${line}
`);

  // A write of another field by a second writer is a conflict all the same.
  await patchNpc(api, NPC, { status: "missing" });
  await page.getByRole("button", { name: "Speichern" }).click();
  const conflicted = conflict(page);
  await expect(conflicted.line).toBeVisible();

  await conflicted.force.click();
  await expect(textarea).toHaveCount(0);
  await expect(conflicted.line).toHaveCount(0);

  await expect.poll(async () => (await getNpc(api, NPC)).motivation).toBe(mine);
  const after = await npcFields(api);
  // Only what the surface shows was written: the status set in between stays.
  expect(after).toEqual({
    ...before,
    motivation: mine,
    status: "missing",
    body: `${before.body}
${line}
`,
  });
  await expect(page.getByRole("article")).toContainText(mine);
});
