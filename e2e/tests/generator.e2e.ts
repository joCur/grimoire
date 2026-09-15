// Critical path 6: the generator cycle against the stub LLM; see CLAUDE.md.
//
// Job → review → apply → draft in the pool, plus the NPC mode and the failure
// path.
//
// One thing the cutover (issue #57) changed here: the draft is REVIEWED under
// the file name the model chose (`SCENE_ID`) but STORED under its id
// (`SCENE_ID`), because a scene's address is `<chapter>/<id>` now. So the
// review assertions use the slug and everything after „Übernehmen" the id.
//
// Nothing about it is mocked except the model itself: the app starts a real
// background job, the server calls a real HTTP endpoint
// (e2e/fixtures/stub-llm.ts) through the real OpenAICompatProvider and
// validates the reply mechanically exactly as in production.

import {
  ASCII_QUOTE_LINE,
  LOCATION_STUB_ID,
  LOCATION_STUB_NAME,
  NPC_DEFAULT_NAME,
  NPC_ROLE,
  NPC_STUB_ID,
  NPC_STUB_NAME,
  SCENE_ID,
  SCENE_TITLE,
  TRIGGER,
} from "../fixtures/replies";
import { expect, test } from "../support/test";

/**
 * How the REVIEW addresses the draft: `<chapter>/<id>`, built by the server
 * from the run's chapter and the frontmatter id (issue #100).
 */
const DRAFT_PATH = `01-salzhafen/${SCENE_ID}`;
/**
 * …and where it LIVES once accepted: the group segment is the draft's
 * `location`, which the reply fixture sets to the `bucht` entry it proposes
 * in the same run (issue #100, AK1).
 */
const SCENE_PATH = `01-salzhafen/${LOCATION_STUB_ID}/${SCENE_ID}`;

const SOURCE = `The party watches the quay at low tide. Two lanterns move along the
mole while Fenn's crew shifts a cargo before dawn.`;

const NPC_SOURCE = `Brakk Ironhand, an ageing fisherman who knows every sandbank
of the north bay. He has seen strangers carrying crates at night and keeps
quiet out of fear.`;

test("scene run: job, review, apply — the draft is stored and in the pool", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel/generate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Szenen generieren");

  // The active chapter is preselected, and the context hint names what travels.
  await expect(
    page.getByRole("button", { name: "Kapitel 1: Der Leuchtturm von Salzhafen" }),
  ).toHaveAttribute("aria-pressed", "true");
  // The knowledge count is part of that line since issue #53; the example
  // campaign has none, so it says so. The knowledge path itself is
  // campaign-knowledge.e2e.ts.
  // Two locations: `bucht` is a scene's location in the example campaign, so
  // the import created an entry for it (#100).
  await expect(page.getByText("2 NPCs · 2 Orte")).toBeVisible();
  // The knowledge and the glossary halves are LINKS to their own pages now
  // (issue #53, PO feedback on PR #87) — this line is where the DM notices a
  // rule is missing, so the fix is one click from here.
  await expect(page.getByRole("link", { name: "kein Kampagnenwissen" })).toHaveAttribute(
    "href",
    "/beispiel/knowledge",
  );
  await expect(page.getByRole("link", { name: "Glossar", exact: true })).toHaveAttribute(
    "href",
    "/beispiel/glossary",
  );

  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  // The review of the finished job (the working state may flash by).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  await expect(page.getByText("1 Szene · 2 vorgeschlagene Einträge · noch nichts geschrieben")).toBeVisible();
  // What the run cost: since issue #102 it is summed over every CALL of the
  // pipeline — the outline plus the one scene plus the two entries.
  await expect(page.getByText(/~[\d.]+ Tokens · 4 Aufrufe/)).toBeVisible();
  // The model's warning is shown, not swallowed.
  await expect(page.getByText("Der Frachtbrief ist erfunden", { exact: false })).toBeVisible();

  // The draft card: title, target path, status pill, rendered body.
  const card = page.locator("div").filter({ hasText: DRAFT_PATH }).last();
  await expect(page.getByRole("heading", { level: 2, name: SCENE_TITLE })).toBeVisible();
  // The status chip shows the LABEL, not the raw frontmatter value (#88).
  await expect(card.getByText("Entwurf", { exact: true })).toBeVisible();
  await expect(card.locator("[data-callout='readaloud']")).toContainText("Die Flut zieht sich");
  await expect(card.locator("[data-callout='loot']")).toContainText("Beute");
  await expect(card.locator("details[data-if-section]")).toHaveCount(2);
  // Issue #68: the draft's prose uses `[[slug]]` and the review resolves it —
  // `[[fenn]]` becomes the NPC's current name as a link, while `[[grella]]`
  // (only a STUB in this reply, no entity yet) stays visible as source text.
  await expect(card.getByRole("link", { name: "NPC: Fenn" }).first()).toHaveText("Fenn");
  await expect(card).toContainText("[[grella]]");

  // Nothing is stored before "Übernehmen" — under neither name.
  expect(await api.exists(DRAFT_PATH)).toBe(false);
  expect(await api.exists(SCENE_PATH)).toBe(false);

  // Suggested entries are decided one by one. An undecided row is the innermost div that
  // carries the target path AND its own "Ablehnen" button.
  const acceptStub = async (targetPath: string, name: string) => {
    const row = page
      .locator("div")
      .filter({ hasText: targetPath })
      .filter({ has: page.getByRole("button", { name: "Ablehnen" }) })
      .last();
    await expect(row).toContainText(name);
    await row.getByRole("button", { name: "Annehmen" }).click();
  };
  await expect(page.getByText("Vorgeschlagene Einträge — einzeln entscheiden")).toBeVisible();
  await acceptStub(`npcs/${NPC_STUB_ID}`, NPC_STUB_NAME);
  await acceptStub(`locations/${LOCATION_STUB_ID}`, LOCATION_STUB_NAME);
  await expect(page.getByRole("button", { name: "Angenommen" })).toHaveCount(2);

  await page.getByRole("button", { name: /^Übernehmen \(1 Szene · 2 vorgeschlagene Einträge\)$/ }).click();

  // Done state lists exactly what was written — the ADDRESSES, so the DM sees
  // where the scene actually landed and not the model's file name.
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  await expect(page.getByText(SCENE_PATH)).toBeVisible();

  // Stored: the draft plus both stubs, and a location stub without a status.
  const scene = await api.raw(SCENE_PATH);
  expect(scene).toContain("status: draft");
  expect(scene).toContain(`title: ${SCENE_TITLE}`);
  expect(scene).toContain("> [!loot]");
  const npcFile = await api.raw(`npcs/${NPC_STUB_ID}`);
  expect(npcFile).toContain("status: alive");
  const locationFile = await api.raw(`locations/${LOCATION_STUB_ID}`);
  expect(locationFile).not.toContain("status:");
  // The review's own address is a STALE address for the scene now, not a
  // dead one: it names the same id, so it resolves and reports where the
  // scene actually is (issue #100, ADR #17).
  expect((await api.file(DRAFT_PATH)).path).toBe(SCENE_PATH);

  // Back in the pool the draft shows up with the German status label.
  await page.getByRole("button", { name: "Zu den Kapiteln" }).click();
  await expect(page).toHaveURL(/\/beispiel$/);
  const row = page.getByRole("link", { name: new RegExp(SCENE_TITLE) });
  await expect(row).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Status ändern, aktuell Entwurf" }),
  ).toBeVisible();
  await expect(page.getByText("1 Kapitel · 3 Szenen")).toBeVisible();
});

/**
 * Issue #107 AK5, the PO case of 15.09.: the scene body carries German
 * quotation marks closed with an ASCII `"`. Under the old JSON wrapper that
 * quote ended the `content` string and an inhaltlich correct scene cost the
 * run a correction turn — and often a „Formprüfung nicht bestanden". As a raw
 * document it is text, so the run reaches the review in ONE call per part and
 * the quotation marks arrive byte for byte.
 */
test("a scene with ASCII closing quotes is accepted without a correction turn", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(`${SOURCE}\n\n${TRIGGER.asciiQuotes}`);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  // One scene, no suggested entries — and, the point of the case, exactly TWO
  // calls: the outline and the one scene. A correction turn would be a third.
  await expect(
    page.getByText("1 Szene · 0 vorgeschlagene Einträge · noch nichts geschrieben"),
  ).toBeVisible();
  await expect(page.getByText(/~[\d.]+ Tokens · 2 Aufrufe/)).toBeVisible();
  // Nothing failed, so no error block and no „Erneut versuchen".
  await expect(page.getByRole("button", { name: "Erneut versuchen" })).toHaveCount(0);

  // The read-aloud carries the mixed quotation marks, rendered as written.
  const card = page.locator("div").filter({ hasText: DRAFT_PATH }).last();
  await expect(card.locator("[data-callout='readaloud']")).toContainText(ASCII_QUOTE_LINE);

  await page
    .getByRole("button", { name: /^Übernehmen \(1 Szene · 0 vorgeschlagene Einträge\)$/ })
    .click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  // …and they are stored byte for byte: the server corrects no typography.
  const stored = await api.raw(`01-salzhafen/${SCENE_ID}`);
  expect(stored).toContain(ASCII_QUOTE_LINE);
});

test("npc run: pinned id, review, apply", async ({ page, api }) => {
  await page.goto("/beispiel/generate");
  await page.getByRole("button", { name: "NPC", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("NPC generieren");

  await page.getByLabel("Quelltext", { exact: true }).fill(NPC_SOURCE);
  await page.getByLabel("id (optional)").fill("brakk");
  await expect(page.getByText("wird angelegt als: npcs/brakk")).toBeVisible();

  await page.getByRole("button", { name: "NPC generieren", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vorschlag prüfen", {
    timeout: 30_000,
  });
  await expect(page.getByText("1 NPC · noch nichts geschrieben")).toBeVisible();
  const card = page.locator("div").filter({ hasText: "npcs/brakk" }).last();
  await expect(page.getByRole("heading", { level: 2, name: NPC_DEFAULT_NAME })).toBeVisible();
  await expect(card).toContainText("Lebendig");
  await expect(card).toContainText(NPC_ROLE);
  // Quoted quickstats survive as strings — the plus is still there.
  await expect(card).toContainText("insight +1");
  await expect(card.locator("[data-callout='secret']")).toContainText("Hat gesehen");

  expect(await api.exists("npcs/brakk")).toBe(false);
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();

  await expect(page.getByText("Geschrieben — NPC-Eintrag angelegt")).toBeVisible();
  const npc = await api.raw("npcs/brakk");
  expect(npc).toContain("id: brakk");
  expect(npc).toContain("status: alive");
  // Quoted quickstats stay STRINGS; the YAML the store emits quotes them in
  // its own style (documented normalization — server/src/store/render.ts).
  expect(npc).toContain("insight: '+1'");

  // "NPC ansehen" opens the file that now exists.
  await page.getByRole("button", { name: "NPC ansehen" }).click();
  await expect(page).toHaveURL(/\/beispiel\/file\/npcs\/brakk$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_DEFAULT_NAME);
});

test("failure path: an invalid model reply shows the 422 block with the raw reply", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(`${SOURCE}\n\n${TRIGGER.invalid}`);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  // The run fails after the correction turn (LLM_CORRECTION_TURNS=1) and the
  // view goes back to the form WITH the server's 422 body above it.
  const block = page.getByText("Das Modell hat die Formprüfung nicht bestanden — nichts generiert.");
  await expect(block).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('"status" must be "draft"', { exact: false })).toBeVisible();
  await expect(page.getByText('unknown callout "[!combat]"', { exact: false })).toBeVisible();
  await expect(
    page.getByText("Quelltext kürzen oder klarer strukturieren und erneut generieren."),
  ).toBeVisible();
  // Three calls: the outline, then the scene part's initial call plus its
  // correction turn. The failure block still reports „Versuche", because it
  // reads the run's usage out of the error body (issue #18).
  await expect(page.getByText(/~[\d.]+ Tokens · 3 Versuche/)).toBeVisible();

  // The raw reply is one click away — that is what makes a 422 debuggable.
  await page.getByText("Unverarbeitete Antwort anzeigen").click();
  await expect(page.locator("pre")).toContainText("night-watch-quay");

  // Nothing was written, and the form is usable again.
  expect(await api.exists(DRAFT_PATH)).toBe(false);
  expect(await api.exists(SCENE_PATH)).toBe(false);
  await expect(page.getByRole("button", { name: "Entwürfe generieren" })).toBeEnabled();
});

// --- the review state lives on the job (issue #97) ---------------------------

test("review state survives navigation and reload; parts are accepted one by one", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  // (1) Edit the draft, leave the page, come back: the text is there. This is
  // the loss the ticket is about — it used to live in component state only.
  const card = page.locator("div").filter({ hasText: DRAFT_PATH }).last();
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  const textarea = page.getByRole("textbox", { name: `Markdown von ${SCENE_TITLE}` });
  const edited = (await textarea.inputValue()).replace(
    "Die Flut zieht sich",
    "Die Flut zieht sich im Regen",
  );
  await textarea.fill(edited);
  // Blur flushes the debounce — the DM does not have to wait for a timer.
  await textarea.blur();
  await expect(page.getByText("Gespeichert")).toBeVisible();

  await page.goto("/beispiel");
  await page.goto("/beispiel/generate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen");
  await expect(page.getByText("Die Flut zieht sich im Regen")).toBeVisible();

  // (2) A decision about a suggested entry survives a RELOAD (a second tab
  // sees the same, for the same reason: it is a row).
  const stubRow = (targetPath: string) =>
    page
      .locator("div")
      .filter({ hasText: targetPath })
      .filter({ has: page.getByRole("button", { name: "Ablehnen" }) })
      .last();
  await stubRow(`npcs/${NPC_STUB_ID}`).getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByRole("button", { name: "Angenommen" })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Angenommen" })).toHaveCount(1);

  // (3) „Diesen übernehmen" writes exactly that scene; the rest stays.
  expect(await api.exists(SCENE_PATH)).toBe(false);
  await page
    .locator("div")
    .filter({ hasText: DRAFT_PATH })
    .last()
    .getByRole("button", { name: "Diesen übernehmen" })
    .click();
  await expect(page.getByText("1 von 3 übernommen", { exact: false })).toBeVisible();
  expect(await api.exists(SCENE_PATH)).toBe(true);
  // The written scene is not editable here any more and links to the entry.
  const written = page.locator("div").filter({ hasText: SCENE_TITLE }).last();
  await expect(written.getByRole("button", { name: "Bearbeiten" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: SCENE_PATH })).toBeVisible();
  // The edit really is what was written.
  expect(await api.raw(SCENE_PATH)).toContain("Die Flut zieht sich im Regen");
  // Writing the scene creates EMPTY rows for the ids it references (#70), so
  // „exists" cannot answer whether a stub landed — its CONTENT can.
  expect(await api.raw(`locations/${LOCATION_STUB_ID}`)).not.toContain(LOCATION_STUB_NAME);
  // The undecided location stub is still open — a bulk accept would skip it,
  // so it is decided explicitly here.
  await stubRow(`locations/${LOCATION_STUB_ID}`)
    .getByRole("button", { name: "Annehmen" })
    .click();

  // (4) „Rest übernehmen" writes what is left — and the job is gone.
  await page.getByRole("button", { name: /^Rest übernehmen/ }).click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  expect(await api.raw(`npcs/${NPC_STUB_ID}`)).toContain(NPC_STUB_NAME);
  expect(await api.raw(`locations/${LOCATION_STUB_ID}`)).toContain(LOCATION_STUB_NAME);
  expect((await api.fetch("beispiel/generate/job")).status).toBe(404);
});

test("„Verwerfen\" drops only the open rest — what was accepted stays", async ({ page, api }) => {
  await page.goto("/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  await page
    .locator("div")
    .filter({ hasText: DRAFT_PATH })
    .last()
    .getByRole("button", { name: "Diesen übernehmen" })
    .click();
  await expect(page.getByRole("link", { name: SCENE_PATH })).toBeVisible();

  await page.getByRole("button", { name: "Rest verwerfen" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Szenen generieren");
  // The accepted scene is an entry now; the suggested entries never landed —
  // their ids exist only as the empty rows the scene's references leave (#70).
  expect(await api.exists(SCENE_PATH)).toBe(true);
  expect(await api.raw(`npcs/${NPC_STUB_ID}`)).not.toContain(NPC_STUB_NAME);
  expect((await api.fetch("beispiel/generate/job")).status).toBe(404);
});
