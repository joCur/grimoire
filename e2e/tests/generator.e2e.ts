// Critical path 6: the generator cycle against the stub LLM; see CLAUDE.md.
//
// Job → review → apply → draft in the pool, plus the NPC mode and the failure
// path.
//
// One thing the cutover changed here: the draft is REVIEWED under
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
 * from the run's chapter and the property id.
 */
const DRAFT_PATH = `01-salzhafen/${SCENE_ID}`;
/**
 * …and where it LIVES once accepted: the group segment is the draft's
 * `location`, which the reply fixture sets to the `bucht` entry it proposes
 * in the same run.
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
  await page.goto("/campaigns/beispiel/generate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Szenen generieren");

  // The active chapter is preselected, and the context hint names what travels.
  await expect(
    page.getByRole("button", { name: "Kapitel 1: Der Leuchtturm von Salzhafen" }),
  ).toHaveAttribute("aria-pressed", "true");
  // The knowledge count is part of that line; the example
  // campaign has none, so it says so. The knowledge path itself is
  // campaign-knowledge.e2e.ts.
  // Two locations: each Ort a scene names has an entry of its own, because a
  // reference creates nothing (ADR #19).
  await expect(page.getByText("2 NPCs · 2 Orte")).toBeVisible();
  // The knowledge and the glossary halves are LINKS to their own pages now —
  // this line is where the DM notices a rule is missing, so the fix is one
  // click from here.
  await expect(page.getByRole("link", { name: "kein Kampagnenwissen" })).toHaveAttribute(
    "href",
    "/campaigns/beispiel/knowledge",
  );
  await expect(page.getByRole("link", { name: "Glossar", exact: true })).toHaveAttribute(
    "href",
    "/campaigns/beispiel/glossary",
  );

  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  // The review of the finished job (the working state may flash by).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  await expect(page.getByText("1 Szene · 2 vorgeschlagene Einträge · noch nichts geschrieben")).toBeVisible();
  // What the run cost: it is summed over every CALL of the
  // pipeline — the outline plus the one scene plus the two entries.
  await expect(page.getByText(/~[\d.]+ Tokens · 4 Aufrufe/)).toBeVisible();
  // The model's warning is shown, not swallowed.
  await expect(page.getByText("Der Frachtbrief ist erfunden", { exact: false })).toBeVisible();

  // The draft card: title, target path, status pill, rendered body.
  const card = page.locator("div").filter({ hasText: DRAFT_PATH }).last();
  await expect(page.getByRole("heading", { level: 2, name: SCENE_TITLE })).toBeVisible();
  // The status chip shows the LABEL, not the raw property value.
  await expect(card.getByText("Entwurf", { exact: true })).toBeVisible();
  await expect(card.locator("[data-callout='readaloud']")).toContainText("Die Flut zieht sich");
  await expect(card.locator("[data-callout='loot']")).toContainText("Beute");
  await expect(card.locator("details[data-if-section]")).toHaveCount(2);
  // The draft's prose uses `[[slug]]` and the review resolves it —
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
  const scene = await api.file(SCENE_PATH);
  expect(scene.properties.status).toBe("draft");
  expect(scene.properties.title).toBe(SCENE_TITLE);
  expect(scene.body).toContain("> [!loot]");
  expect((await api.properties(`npcs/${NPC_STUB_ID}`)).status).toBe("alive");
  expect((await api.properties(`locations/${LOCATION_STUB_ID}`)).status).toBeUndefined();
  // The review's own address is a STALE address for the scene now, not a
  // dead one: it names the same id, so it resolves and reports where the
  // scene actually is (ADR #17).
  expect((await api.file(DRAFT_PATH)).path).toBe(SCENE_PATH);

  // Back in the pool the draft shows up with the German status label.
  await page.getByRole("button", { name: "Zu den Kapiteln" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  const row = page.getByRole("link", { name: new RegExp(SCENE_TITLE) });
  await expect(row).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Status ändern, aktuell Entwurf" }),
  ).toBeVisible();
  await expect(page.getByText("1 Kapitel · 3 Szenen")).toBeVisible();
});

/**
 * The stall the PO hit on 15.09.: „Entwürfe generieren" was
 * clicked, the run finished on the server — and the page stayed on „Entwürfe
 * werden generiert …" until it was reloaded.
 *
 * The cause was the view taking the START REQUEST's lifetime for the run's:
 * with a fast model the job is `done` before its own 202 arrives, so the
 * first poll that answers already carries the finished run while the POST is
 * still in flight. That state has to BE the review.
 *
 * The 202 is therefore held here — the REAL response of the real server,
 * fetched by the real route and handed on late (nothing is mocked, see
 * README: the stub LLM stays the only stand-in). Holding it is the only way
 * to pin the claim „the job decides, not the request": with a response that
 * comes back in 30ms the test would pass either way.
 */
test("the review appears as soon as the job is done — even with the start request still in flight", async ({
  page,
}) => {
  let released = false;
  const start = page.route("**/api/campaigns/*/generate", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    released = true;
    await route.fulfill({ status: response.status(), body, contentType: "application/json" });
  });
  await start;

  await page.goto("/campaigns/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  // The honest state right after the click: no job of this run is readable yet.
  await expect(page.getByText("Entwürfe werden generiert", { exact: false })).toBeVisible();

  // …and the first poll that answers carries the finished run, so THIS is the
  // review — no reload, and long before the 202 of the same run.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 6_000,
  });
  expect(released).toBe(false);
  await expect(page.getByRole("heading", { level: 2, name: SCENE_TITLE })).toBeVisible();

  // Let the held response go, so nothing is left hanging when the test ends —
  // and the arrival of the 202 must not throw the review away again.
  await expect(async () => expect(released).toBe(true)).toPass({ timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen");
});

/**
 * The scene body carries German
 * quotation marks closed with an ASCII `"`. When the model hand-wrote the
 * JSON wrapper, that quote ended the `content` string and an otherwise
 * correct scene cost the run a correction turn — and often a „Formprüfung
 * nicht bestanden".
 *
 * The body is a string of a schema-forced object now, so the ESCAPING is the
 * transport's: the run reaches the review in one call per part and the
 * characters arrive byte for byte, through a real HTTP endpoint and the real
 * provider.
 */
test("a scene with ASCII closing quotes is accepted without a correction turn", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel/generate");
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
  const stored = await api.body(`01-salzhafen/${SCENE_ID}`);
  expect(stored).toContain(ASCII_QUOTE_LINE);
});

test("npc run: pinned id, review, apply", async ({ page, api }) => {
  await page.goto("/campaigns/beispiel/generate");
  await page.getByRole("button", { name: "NPC", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("NPC generieren");

  await page.getByLabel("Quelltext", { exact: true }).fill(NPC_SOURCE);
  await page.getByLabel("Kennung (optional)").fill("brakk");
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
  const npc = await api.properties("npcs/brakk");
  expect(npc.id).toBe("brakk");
  expect(npc.status).toBe("alive");
  // Quoted quickstats stay STRINGS — a „+1" is not read as the number 1.
  expect(npc.quickstats).toMatchObject({ insight: "+1" });

  // "NPC ansehen" opens the file that now exists.
  await page.getByRole("button", { name: "NPC ansehen" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/entries\/npcs\/brakk$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_DEFAULT_NAME);
});

test("failure path: an invalid model reply shows the 422 block with the raw reply", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel/generate");
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
  // reads the run's usage out of the error body.
  await expect(page.getByText(/~[\d.]+ Tokens · 3 Versuche/)).toBeVisible();

  // The raw reply is one click away — that is what makes a 422 debuggable.
  await page.getByText("Unverarbeitete Antwort anzeigen").click();
  await expect(page.locator("pre")).toContainText("night-watch-quay");

  // Nothing was written, and the form is usable again.
  expect(await api.exists(DRAFT_PATH)).toBe(false);
  expect(await api.exists(SCENE_PATH)).toBe(false);
  await expect(page.getByRole("button", { name: "Entwürfe generieren" })).toBeEnabled();
});

// --- the review state lives on the job ---------------------------------------

test("review state survives navigation and reload; parts are accepted one by one", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  // (1) Edit the draft, leave the page, come back: the text is there. This is
  // the loss being guarded against: component state alone would not survive.
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

  await page.goto("/campaigns/beispiel");
  await page.goto("/campaigns/beispiel/generate");
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

  // (3) The second suggested entry, decided as well: the scene NAMES both of
  // them, and a scene cannot be written while a reference names nothing
  // (ADR #19) — „Annehmen" is that decision, the write comes below.
  await stubRow(`locations/${LOCATION_STUB_ID}`).getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByRole("button", { name: "Angenommen" })).toHaveCount(2);
  // Accepted is a decision, not a write.
  expect(await api.exists(`npcs/${NPC_STUB_ID}`)).toBe(false);

  // (4) „Diesen übernehmen" on the scene writes the scene AND the two
  // accepted entries it references — one batch, so nothing is half-written.
  expect(await api.exists(SCENE_PATH)).toBe(false);
  await page
    .locator("div")
    .filter({ hasText: DRAFT_PATH })
    .last()
    .getByRole("button", { name: "Diesen übernehmen" })
    .click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  expect(await api.exists(SCENE_PATH)).toBe(true);
  // The edit really is what was written.
  expect(await api.body(SCENE_PATH)).toContain("Die Flut zieht sich im Regen");
  // Both entries carry their NAME, so they were written as proposed.
  expect((await api.properties(`npcs/${NPC_STUB_ID}`)).name).toBe(NPC_STUB_NAME);
  expect((await api.properties(`locations/${LOCATION_STUB_ID}`)).name).toBe(LOCATION_STUB_NAME);
  // Nothing is left open, so the job is gone.
  expect((await api.fetch("campaigns/beispiel/generate/job")).status).toBe(404);
});

test("„Verwerfen\" drops only the open rest — what was accepted stays", async ({ page, api }) => {
  await page.goto("/campaigns/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  // One suggested entry is accepted and written — it references nothing, so
  // it stands on its own — and the rest of the run is thrown away.
  const npcRow = page
    .locator("div")
    .filter({ hasText: `npcs/${NPC_STUB_ID}` })
    .filter({ has: page.getByRole("button", { name: "Ablehnen" }) })
    .last();
  await npcRow.getByRole("button", { name: "Annehmen" }).click();
  await page
    .locator("div")
    .filter({ hasText: `npcs/${NPC_STUB_ID}` })
    .filter({ has: page.getByRole("button", { name: "Diesen übernehmen" }) })
    .last()
    .getByRole("button", { name: "Diesen übernehmen" })
    .click();
  await expect(page.getByRole("link", { name: `npcs/${NPC_STUB_ID}` })).toBeVisible();

  await page.getByRole("button", { name: "Rest verwerfen" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Szenen generieren");
  // The accepted entry is an entry now; the scene and the other suggestion
  // never landed.
  expect((await api.properties(`npcs/${NPC_STUB_ID}`)).name).toBe(NPC_STUB_NAME);
  expect(await api.exists(SCENE_PATH)).toBe(false);
  expect(await api.exists(`locations/${LOCATION_STUB_ID}`)).toBe(false);
  expect((await api.fetch("campaigns/beispiel/generate/job")).status).toBe(404);
});

// Critical path 6: „Neues Kapitel" → leave the page → come back →
// „Übernehmen". The chapter has to be in the overview WITH its title.
//
// The chapter and its title come from the JOB, not from the app's own state:
// the review state is persistent, so the accept regularly happens after a
// navigation or a reload, when that state is gone — and scenes written under
// a chapter that has no entry of its own are something the overview cannot
// list.
//
// The navigation is the whole point of the test, so it is a REAL one: to the
// overview and back, which is what a DM does while the run is going.
test("new chapter: the run survives leaving the page and the chapter keeps its title", async ({
  page,
  api,
}) => {
  const CHAPTER_ID = "02-die-schmugglerbucht";
  const CHAPTER_TITLE = "Die Schmugglerbucht";

  await page.goto("/campaigns/beispiel/generate");
  await page.getByRole("button", { name: "Neues Kapitel" }).click();
  await page.getByLabel("Kapiteltitel").fill(CHAPTER_TITLE);
  // The id is derived from the title and is the field that decides where the
  // drafts land.
  await expect(page.getByLabel("Kapitel-Kennung")).toHaveValue(CHAPTER_ID);
  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  // …and away. The review state is a row, so it is still there when we come
  // back — but this browser has forgotten the title it typed.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/campaigns/beispiel/generate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  await page.getByRole("button", { name: /^Übernehmen \(/ }).click();
  // The accept writes the scene, the chapter it hangs in and the two
  // suggested entries the scene NAMES — a scene cannot be written while a
  // reference names nothing (ADR #19), so they come along. Nothing is left
  // open afterwards, so the review is done.
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();

  // The point: the chapter exists, with the title the RUN was started with —
  // not the id, and not nothing.
  expect((await api.file(CHAPTER_ID)).properties.title).toBe(CHAPTER_TITLE);
  // …and the scene really hangs in it.
  expect(
    (await api.file(`${CHAPTER_ID}/${LOCATION_STUB_ID}/${SCENE_ID}`)).properties.chapter,
  ).toBe(CHAPTER_ID);

  // The overview lists the chapter with that title, and the scene inside it.
  await page.getByRole("link", { name: "Kapitel", exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("heading", { level: 2, name: CHAPTER_TITLE })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(CHAPTER_TITLE) }).click();
  await expect(page.getByRole("link", { name: new RegExp(SCENE_TITLE) })).toBeVisible();
  await expect(page.getByText("2 Kapitel · 3 Szenen")).toBeVisible();
});
