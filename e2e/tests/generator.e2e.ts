// Critical path 6: the generator cycle against the stub LLM; see CLAUDE.md.
//
// Job → review → apply → draft in the chapter overview, plus the NPC mode and the failure
// path.
//
// A proposed scene is the scene without its guard (ADR #31): the review names
// it by its resource segment and id, `scenes/<id>`, and once written it is
// the scene at `…/scenes/<id>`.
//
// Nothing about it is mocked except the model itself: the app starts a real
// background job, the server calls a real HTTP endpoint
// (e2e/fixtures/stub-llm.ts) through the real OpenAICompatProvider and
// validates the reply mechanically exactly as in production.

import type { Locator, Page } from "@playwright/test";

import {
  ASCII_QUOTE_LINE,
  CHAPTER_DESCRIPTION,
  LOCATION_STUB_ATMOSPHERE,
  LOCATION_STUB_ID,
  LOCATION_STUB_NAME,
  NPC_DEFAULT_ID,
  NPC_DEFAULT_NAME,
  NPC_MOTIVATION,
  NPC_ROLE,
  NPC_STUB_ID,
  NPC_STUB_MOTIVATION,
  NPC_STUB_NAME,
  SCENE_ID,
  SCENE_TITLE,
  TRIGGER,
  UNKNOWN_REF_ID,
} from "../fixtures/replies";
import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { getChapter } from "../support/chapter";
import { getGeneratorJob, readGeneratorJob } from "../support/generator-job";
import { getLocation, locationExists } from "../support/location";
import { getNpc, npcExists } from "../support/npc";
import { getScene, sceneExists } from "../support/scene";

/** How the review names the proposed scene: its resource segment and id. */
const SCENE_LABEL = `scenes/${SCENE_ID}`;

const SOURCE = `The party watches the quay at low tide. Two lanterns move along the
mole while Fenn's crew shifts a cargo before dawn.`;

const NPC_SOURCE = `Brakk Ironhand, an ageing fisherman who knows every sandbank
of the north bay. He has seen strangers carrying crates at night and keeps
quiet out of fear.`;

/** A title no reply fixture spells, so only a DM edit can put it on screen. */
const EDITED_TITLE = "Nachtwache am Kai, im Regen";

/** One stored change of a proposed scene: the fields the DM set. */
type SceneEdit = Record<string, unknown>;

/**
 * The raw text surface of an open draft editor. „Bearbeiten" lands on the block
 * cards (the default surface), so the textarea costs one more click on the mode
 * toggle of the text region.
 */
async function markdownTextarea(card: Locator): Promise<Locator> {
  const text = card.getByRole("region", { name: "Text" });
  await text
    .getByRole("group", { name: "Editiermodus" })
    .getByRole("button", { name: "Markdown" })
    .click();
  return text.getByRole("textbox", { name: `Text von ${SCENE_LABEL}` });
}

test("scene run: job, review, apply — the draft is stored and in the chapter overview", async ({
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
  // Two locations: each location a scene names has an entry of its own,
  // because a reference creates nothing (ADR #19).
  await expect(page.getByText("2 NPCs · 2 Orte")).toBeVisible();
  // The knowledge and the glossary halves are LINKS to their own pages —
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
  await expect(page.getByText("1 Szene · 2 vorgeschlagene NPCs und Orte · noch nichts geschrieben")).toBeVisible();
  // What the run cost: it is summed over every CALL of the
  // pipeline — the outline plus the one scene plus the npc and the location.
  // Not one correction among them: the scene and the location name
  // `[[grella]]`, an npc only this run proposes, and a reference to a
  // proposal is valid.
  await expect(page.getByText(/~[\d.]+ Tokens · 4 Aufrufe/)).toBeVisible();
  // The model's warning is shown, not swallowed.
  await expect(page.getByText("Der Frachtbrief ist erfunden", { exact: false })).toBeVisible();

  // The scene's card: title, label, status pill, rendered body.
  const card = page.locator("div").filter({ hasText: SCENE_LABEL }).last();
  await expect(page.getByRole("heading", { level: 2, name: SCENE_TITLE })).toBeVisible();
  // The status chip shows the LABEL, not the raw property value.
  await expect(card.getByText("Entwurf", { exact: true })).toBeVisible();
  await expect(card.locator("[data-callout='readaloud']")).toContainText("Die Flut zieht sich");
  await expect(card.locator("[data-callout='loot']")).toContainText("Beute");
  await expect(card.locator("details[data-if-section]")).toHaveCount(2);
  // The draft's prose uses `[[slug]]` and the review resolves it —
  // `[[fenn]]` becomes the NPC's current name as a link, while `[[grella]]`
  // (only proposed by this run, nothing stored yet) stays visible as source
  // text.
  await expect(card.getByRole("link", { name: "NPC: Fenn" }).first()).toHaveText("Fenn");
  await expect(card).toContainText("[[grella]]");

  // Nothing is stored before the accept.
  expect(await sceneExists(api, SCENE_ID)).toBe(false);

  // Proposed npcs and locations are decided one by one. An undecided row is
  // the innermost div that carries its label AND its own "Ablehnen" button.
  const acceptProposal = async (targetPath: string, name: string) => {
    const row = page
      .locator("div")
      .filter({ hasText: targetPath })
      .filter({ has: page.getByRole("button", { name: "Ablehnen" }) })
      .last();
    await expect(row).toContainText(name);
    await row.getByRole("button", { name: "Annehmen" }).click();
  };
  await expect(page.getByText("Vorgeschlagene NPCs und Orte — einzeln entscheiden")).toBeVisible();
  // The run's proposed scenes, npcs and locations are each their own typed
  // list (ADR #31): the scene, the npc and the location themselves, no kind,
  // no path, no properties map.
  const run = (await getGeneratorJob(api)).result!;
  expect(run.scenes).toEqual([
    expect.objectContaining({
      id: SCENE_ID,
      title: SCENE_TITLE,
      chapter: "01-salzhafen",
      location: LOCATION_STUB_ID,
      status: "draft",
    }),
  ]);
  expect(run.npcs).toEqual([
    expect.objectContaining({ id: NPC_STUB_ID, name: NPC_STUB_NAME, status: "alive" }),
  ]);
  expect(run.locations).toEqual([
    expect.objectContaining({ id: LOCATION_STUB_ID, name: LOCATION_STUB_NAME }),
  ]);
  for (const proposal of [...run.scenes, ...run.npcs, ...run.locations]) {
    for (const key of ["kind", "path", "properties", "rev"]) {
      expect(Object.keys(proposal)).not.toContain(key);
    }
    // A proposal is the npc or location without its guard: an optional field
    // the model answered with `null` is absent, never `null`, and `warnings`
    // travel apart.
    expect(Object.values(proposal)).not.toContain(null);
  }
  expect(Object.keys(run.npcs[0]!).sort()).toEqual([
    "body",
    "id",
    "motivation",
    "name",
    "status",
  ]);
  expect(Object.keys(run.locations[0]!).sort()).toEqual([
    "atmosphere",
    "body",
    "id",
    "name",
  ]);
  await acceptProposal(`npcs/${NPC_STUB_ID}`, NPC_STUB_NAME);
  await acceptProposal(`locations/${LOCATION_STUB_ID}`, LOCATION_STUB_NAME);
  await expect(page.getByRole("button", { name: "Angenommen" })).toHaveCount(2);

  await page.getByRole("button", { name: /^Übernehmen \(1 Szene · 2 vorgeschlagene NPCs und Orte\)$/ }).click();

  // Done state lists exactly what was written, each by its resource segment
  // and id.
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  const writtenList = page.getByRole("listitem");
  await expect(writtenList.getByText(SCENE_LABEL, { exact: true })).toBeVisible();
  await expect(writtenList.getByText(`npcs/${NPC_STUB_ID}`, { exact: true })).toBeVisible();
  await expect(
    writtenList.getByText(`locations/${LOCATION_STUB_ID}`, { exact: true }),
  ).toBeVisible();

  // Stored: the draft plus the npc and the location, the location without a
  // status.
  const scene = await getScene(api, SCENE_ID);
  expect(scene.status).toBe("draft");
  expect(scene.title).toBe(SCENE_TITLE);
  expect(scene.chapter).toBe("01-salzhafen");
  expect(scene.body).toContain("> [!loot]");
  const writtenNpc = await getNpc(api, NPC_STUB_ID);
  expect(writtenNpc.status).toBe("alive");
  for (const key of ["kind", "path", "properties"]) {
    expect(Object.keys(writtenNpc)).not.toContain(key);
  }
  const writtenLocation = await getLocation(api, LOCATION_STUB_ID);
  expect(Object.keys(writtenLocation)).not.toContain("status");
  // The prose fields the model proposed rode along with the npc and the location.
  expect(writtenNpc.motivation).toBe(NPC_STUB_MOTIVATION);
  expect(writtenLocation.atmosphere).toBe(LOCATION_STUB_ATMOSPHERE);
  // The co-proposed npc's reference arrived as written, and now resolves.
  expect(writtenLocation.body).toContain(`[[${NPC_STUB_ID}]]`);

  // Back in the chapter overview the draft shows up with the German status label.
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
 * The run's lifetime is the JOB's, not the START REQUEST's: with a fast model
 * the job is `done` before its own 202 arrives, so the first poll that
 * answers already carries the finished run while the POST is still in
 * flight. That state has to BE the review, without a reload.
 *
 * The 202 is therefore held here — the REAL response of the real server,
 * fetched by the real route and handed on late (nothing is mocked, see
 * README: the stub LLM stays the only stand-in). Holding it is the only way
 * to pin the claim that the job decides and not the request: with a response
 * that comes back in 30ms the test would pass either way.
 */
test("the review appears as soon as the job is done — even with the start request still in flight", async ({
  page,
}) => {
  let released = false;
  // Only the start is held; the polls of the same list go through untouched.
  const start = page.route("**/api/campaigns/*/generator-jobs", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
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
 * The scene body carries typographic opening quotation marks closed with an
 * ASCII `"`. Such a quote would end the `content` string if the model wrote
 * the JSON wrapper by hand, costing an otherwise correct scene a correction
 * turn or a failed validation.
 *
 * The body is a string of a schema-forced object, so the ESCAPING is the
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
  // One scene, nothing else proposed — and, the point of the case, exactly TWO
  // calls: the outline and the one scene. A correction turn would be a third.
  await expect(
    page.getByText("1 Szene · 0 vorgeschlagene NPCs und Orte · noch nichts geschrieben"),
  ).toBeVisible();
  await expect(page.getByText(/~[\d.]+ Tokens · 2 Aufrufe/)).toBeVisible();
  // Nothing failed, so no error block and no retry action.
  await expect(page.getByRole("button", { name: "Erneut versuchen" })).toHaveCount(0);

  // The read-aloud carries the mixed quotation marks, rendered as written.
  const card = page.locator("div").filter({ hasText: SCENE_LABEL }).last();
  await expect(card.locator("[data-callout='readaloud']")).toContainText(ASCII_QUOTE_LINE);

  await page
    .getByRole("button", { name: /^Übernehmen \(1 Szene · 0 vorgeschlagene NPCs und Orte\)$/ })
    .click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  // …and they are stored byte for byte: the server corrects no typography.
  const stored = (await getScene(api, SCENE_ID)).body;
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
  // The motivation is a field of the proposed npc, shown like on the NPC
  // card — its `[[fenn]]` as the current name.
  await expect(card).toContainText("Will: Dass die Boote wieder sicher rausfahren können");
  await expect(card).toContainText("traut Fenn nicht");

  // „Bearbeiten" offers it beside the text, where the npc's editor does —
  // and an edit there is one of the npc's changes the accept writes.
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  const text = card.getByRole("region", { name: "Text" });
  const motivation = text.getByRole("textbox", { name: "Will", exact: true });
  await expect(motivation).toHaveValue(NPC_MOTIVATION);
  await expect(
    card.getByRole("region", { name: "Eigenschaften" }).getByRole("textbox", { name: "Will" }),
  ).toHaveCount(0);
  const edited = `${NPC_MOTIVATION} Und er will seinen Bruder zurück.`;
  await motivation.fill(edited);
  await motivation.blur();
  await expect(page.getByText("Gespeichert")).toBeVisible();

  // The run's npc is the npc itself (ADR #31) — no properties map, no `null`
  // — and the DM's change travels as an npc edit by id, the one field that
  // was touched; a scene edit is something else.
  const job = await getGeneratorJob(api);
  expect(job.npcResult!.npc).toMatchObject({ id: "brakk", name: NPC_DEFAULT_NAME, status: "alive" });
  for (const key of ["kind", "path", "properties", "rev"]) {
    expect(Object.keys(job.npcResult!.npc)).not.toContain(key);
  }
  expect(Object.values(job.npcResult!.npc)).not.toContain(null);
  expect(job.npcResult!.npc.motivation).toBe(NPC_MOTIVATION);
  expect(Object.keys(job.npcEdits)).toEqual(["brakk"]);
  expect(job.npcEdits.brakk).toMatchObject({ motivation: edited });
  expect(job.sceneEdits).toEqual({});

  expect(await npcExists(api, "brakk")).toBe(false);
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();

  await expect(page.getByText("Geschrieben — NPC angelegt")).toBeVisible();
  await expect(page.getByRole("listitem").getByText("npcs/brakk", { exact: true })).toBeVisible();
  const npc = await getNpc(api, "brakk");
  expect(npc.id).toBe("brakk");
  expect(npc.status).toBe("alive");
  // Quoted quickstats stay STRINGS — a relative value is not read as a number.
  expect(npc.quickstats).toMatchObject({ insight: "+1" });
  // The edited motivation, as a field — the text carries no `## Will`.
  expect(npc.motivation).toBe(edited);
  expect(npc.body).not.toContain("## Will");

  // "NPC ansehen" opens the npc that now exists, on its own route.
  await page.getByRole("button", { name: "NPC ansehen" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/brakk$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_DEFAULT_NAME);
});

test("npc run: an unknown [[id]] costs one correction turn, the corrected draft is accepted", async ({
  page,
  api,
}) => {
  // The stub's first reply names `[[der-fremde]]`, an id nobody has; the
  // server sends it back as a correction turn and the second reply is the
  // good one. The DM only ever sees the corrected draft.
  await page.goto("/campaigns/beispiel/generate");
  await page.getByRole("button", { name: "NPC", exact: true }).click();
  await page.getByLabel("Quelltext", { exact: true }).fill(`${NPC_SOURCE}\n\n${TRIGGER.unknownRef}`);
  await page.getByRole("button", { name: "NPC generieren", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vorschlag prüfen", {
    timeout: 30_000,
  });
  // Two calls: the reply with the dangling reference and its correction.
  await expect(page.getByText(/~[\d.]+ Tokens · 2 Versuche/)).toBeVisible();
  const card = page.locator("div").filter({ hasText: `npcs/${NPC_DEFAULT_ID}` }).last();
  await expect(card).not.toContainText(UNKNOWN_REF_ID);
  // The relation to an npc the campaign has stayed, as a link.
  await expect(card).toContainText("kennt ihn vom Kai");
  await expect(card.getByRole("link", { name: "NPC: Fenn" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await expect(page.getByText("Geschrieben — NPC angelegt")).toBeVisible();
  const { body } = await getNpc(api, NPC_DEFAULT_ID);
  expect(body).toContain("- [[fenn]]: kennt ihn vom Kai");
  expect(body).not.toContain(UNKNOWN_REF_ID);
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
  // The reply is read by the scene's own schema, which holds a new scene to
  // `draft` — its sentence names the field.
  await expect(
    page.getByText('"status": Ungültige Eingabe: erwartet "draft"', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Quelltext kürzen oder klarer strukturieren und erneut generieren."),
  ).toBeVisible();
  // Three calls: the outline, then the scene part's initial call plus its
  // correction turn. The failure block still reports the attempt count,
  // because it reads the run's usage out of the error body.
  await expect(page.getByText(/~[\d.]+ Tokens · 3 Versuche/)).toBeVisible();

  // The raw reply is one click away — that is what makes a 422 debuggable.
  await page.getByText("Unverarbeitete Antwort anzeigen").click();
  await expect(page.locator("pre")).toContainText("night-watch-quay");

  // Nothing was written, and the form is usable again.
  expect(await sceneExists(api, SCENE_ID)).toBe(false);
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

  // (1) Edit a field and the text of the proposed scene, leave the page, come
  // back: they are there. This is the loss being guarded against: component
  // state alone would not survive. The test touches one field and one line and
  // then reads the job back.
  const card = page.locator("div").filter({ hasText: SCENE_LABEL }).last();
  await card.getByRole("button", { name: "Bearbeiten" }).click();

  const title = card.getByRole("region", { name: "Eigenschaften" }).getByLabel("Titel");
  await expect(title).toHaveValue(SCENE_TITLE);
  await title.fill(EDITED_TITLE);
  await title.blur();

  const textarea = await markdownTextarea(card);
  const edited = (await textarea.inputValue()).replace(
    "Die Flut zieht sich",
    "Die Flut zieht sich im Regen",
  );
  await textarea.fill(edited);
  // Blur flushes the debounce — the DM does not have to wait for a timer.
  await textarea.blur();
  await expect(page.getByText("Gespeichert")).toBeVisible();

  // The job row carries the scene's change under its id, field by field.
  const stored = await getGeneratorJob(api);
  expect(stored.sceneEdits[SCENE_ID]).toMatchObject({ title: EDITED_TITLE });
  expect(stored.sceneEdits[SCENE_ID]!.body).toContain("Die Flut zieht sich im Regen");

  await page.goto("/campaigns/beispiel");
  await page.goto("/campaigns/beispiel/generate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen");
  await expect(page.getByText("Die Flut zieht sich im Regen")).toBeVisible();
  // The edited title is what the card is headed with now — the review reads
  // the edit, not the model's fields.
  await expect(page.getByRole("heading", { level: 2, name: EDITED_TITLE })).toBeVisible();

  // (2) A decision about a proposed npc survives a RELOAD (a second tab sees
  // the same, for the same reason: it is a row).
  const proposalRow = (targetPath: string) =>
    page
      .locator("div")
      .filter({ hasText: targetPath })
      .filter({ has: page.getByRole("button", { name: "Ablehnen" }) })
      .last();
  await proposalRow(`npcs/${NPC_STUB_ID}`).getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByRole("button", { name: "Angenommen" })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Angenommen" })).toHaveCount(1);

  // (3) The proposed location, decided as well: the scene NAMES both of
  // them, and a scene cannot be written while a reference names nothing
  // (ADR #19) — accepting is that decision, the write comes below.
  await proposalRow(`locations/${LOCATION_STUB_ID}`).getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByRole("button", { name: "Angenommen" })).toHaveCount(2);
  // Accepted is a decision, not a write.
  expect(await npcExists(api, NPC_STUB_ID)).toBe(false);
  const decided = await getGeneratorJob(api);
  expect(decided.review.npcs).toEqual({ [NPC_STUB_ID]: "accepted" });

  // (4) Accepting the scene writes the scene AND the accepted npc and
  // location it references — one batch, so nothing is half-written.
  expect(await sceneExists(api, SCENE_ID)).toBe(false);
  await page
    .locator("div")
    .filter({ hasText: SCENE_LABEL })
    .last()
    .getByRole("button", { name: "Diesen übernehmen" })
    .click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
  // Both edits really are what was written — the accept takes the changed
  // fields and the model's value everywhere else.
  const written = await getScene(api, SCENE_ID);
  expect(written.body).toContain("Die Flut zieht sich im Regen");
  expect(written.title).toBe(EDITED_TITLE);
  expect(written.status).toBe("draft");
  expect(written.location).toBe(LOCATION_STUB_ID);
  // Both carry their NAME, so they were written as proposed.
  expect((await getNpc(api, NPC_STUB_ID)).name).toBe(NPC_STUB_NAME);
  expect((await getLocation(api, LOCATION_STUB_ID)).name).toBe(LOCATION_STUB_NAME);
  // Nothing is left open, so the job is gone.
  expect(await readGeneratorJob(api)).toBeNull();
});

// An edit sets the fields it names and leaves every other one the model's.
// The two directions are one claim seen from two sides: a field edit leaves
// the text alone, and a text edit leaves every other field alone.
//
// A test apiece, because each needs a run of its own: both write the same
// scene at the end, and a second accept onto an existing id is a 409.

test("a field edit keeps the body the run produced", async ({ page, api }) => {
  const card = await runAndOpenDraftEditor(page);
  const bodyOfRun = await generatedSceneBody(api);

  const title = card.getByRole("region", { name: "Eigenschaften" }).getByLabel("Titel");
  await title.fill(EDITED_TITLE);
  await title.blur();
  await expect(page.getByText("Gespeichert")).toBeVisible();

  // The form's fields are stored — the text is not among them.
  const edit = await storedSceneEdit(api);
  expect(Object.keys(edit)).not.toContain("body");
  expect(edit).toMatchObject({ title: EDITED_TITLE });

  await acceptWholeRun(page);
  const scene = await getScene(api, SCENE_ID);
  expect(scene.title).toBe(EDITED_TITLE);
  // Byte for byte the body of the run: nothing round-tripped it.
  expect(scene.body).toBe(bodyOfRun);
});

test("a body-only edit keeps the fields the run produced", async ({ page, api }) => {
  const OWN_LINE = "Eine Zeile, die nur der DM schrieb.";
  const card = await runAndOpenDraftEditor(page);
  const fieldsOfRun = await generatedSceneFields(api);

  const textarea = await markdownTextarea(card);
  await textarea.fill(`${await textarea.inputValue()}\n${OWN_LINE}\n`);
  await textarea.blur();
  await expect(page.getByText("Gespeichert")).toBeVisible();

  const edit = await storedSceneEdit(api);
  expect(Object.keys(edit)).toEqual(["body"]);
  expect(edit.body).toContain(OWN_LINE);

  await acceptWholeRun(page);
  const { body, rev: _rev, ...fields } = await getScene(api, SCENE_ID);
  expect(body).toContain(OWN_LINE);
  // Every other field is the run's, title included — the edit named the body.
  expect(fields).toEqual(fieldsOfRun);
});

/** Start the standard run and open „Bearbeiten" on its scene draft. */
async function runAndOpenDraftEditor(page: Page): Promise<Locator> {
  await page.goto("/campaigns/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  const card = page.locator("div").filter({ hasText: SCENE_LABEL }).last();
  await card.getByRole("button", { name: "Bearbeiten" }).click();
  return card;
}

/** The proposed scene as the RUN produced it — the job's result, not the edits. */
async function generatedScene(api: Api): Promise<Record<string, unknown> & { body: string }> {
  const job = await getGeneratorJob(api);
  return job.result!.scenes.find((scene) => scene.id === SCENE_ID)!;
}

async function generatedSceneBody(api: Api): Promise<string> {
  return (await generatedScene(api)).body;
}

/** Every field of the proposed scene but its text. */
async function generatedSceneFields(api: Api): Promise<Record<string, unknown>> {
  const { body: _body, ...fields } = await generatedScene(api);
  return fields;
}

/** The stored change of the proposed scene. */
async function storedSceneEdit(api: Api): Promise<SceneEdit> {
  const job = await getGeneratorJob(api);
  return job.sceneEdits[SCENE_ID]!;
}

/**
 * Accept the whole run: the proposed npc and location, then the bulk accept.
 * The scene NAMES them, and a scene cannot be written while a reference names
 * nothing (ADR #19), so they have to be decided first.
 */
async function acceptWholeRun(page: Page): Promise<void> {
  for (const targetPath of [`npcs/${NPC_STUB_ID}`, `locations/${LOCATION_STUB_ID}`]) {
    await page
      .locator("div")
      .filter({ hasText: targetPath })
      .filter({ has: page.getByRole("button", { name: "Ablehnen" }) })
      .last()
      .getByRole("button", { name: "Annehmen" })
      .click();
  }
  await page.getByRole("button", { name: /^Übernehmen \(/ }).click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();
}

test("„Verwerfen\" drops only the open rest — what was accepted stays", async ({ page, api }) => {
  await page.goto("/campaigns/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  // The proposed npc is accepted and written — it references nothing new, so
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
  // Once written, the row links to the npc's own route (ADR #31).
  await expect(page.getByRole("link", { name: `npcs/${NPC_STUB_ID}` })).toHaveAttribute(
    "href",
    `/campaigns/beispiel/npcs/${NPC_STUB_ID}`,
  );
  const partial = await getGeneratorJob(api);
  expect(partial.review.writtenNpcs).toEqual([NPC_STUB_ID]);

  await page.getByRole("button", { name: "Rest verwerfen" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Szenen generieren");
  // The accepted npc is stored now; the scene and the location never landed.
  expect((await getNpc(api, NPC_STUB_ID)).name).toBe(NPC_STUB_NAME);
  expect(await sceneExists(api, SCENE_ID)).toBe(false);
  expect(await locationExists(api, LOCATION_STUB_ID)).toBe(false);
  expect(await readGeneratorJob(api)).toBeNull();
});

// Critical path 6: start a run into a new chapter → leave the page → come
// back → accept. The chapter has to be in the overview WITH its title.
//
// The chapter and its title come from the JOB, not from the app's own state:
// the review state is persistent, so the accept regularly happens after a
// navigation or a reload, when that state is gone — and scenes written under
// a chapter that does not exist are something the overview cannot list.
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
  // …and the line under it names the chapter by its resource segment and id.
  await expect(page.getByText(`wird angelegt als: chapters/${CHAPTER_ID}`)).toBeVisible();
  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  // The outline of a new-chapter run describes the chapter, and the review
  // shows it — read-only, rendered, above the drafts.
  const description = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Beschreibung des Kapitels" }) });
  await expect(description).toContainText("Nachts verschwinden Ladungen aus dem Hafen");
  await expect(description).toContainText("Die Gruppe soll herausfinden, wer die Schmuggler deckt");
  await expect(description.getByRole("textbox")).toHaveCount(0);

  // …and away. The review state is a row, so it is still there when we come
  // back — but this browser has forgotten the title it typed.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/campaigns/beispiel/generate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });

  await page.getByRole("button", { name: /^Übernehmen \(/ }).click();
  // The accept writes the scene, the chapter it hangs in and the npc and the
  // location the scene NAMES — a scene cannot be written while a
  // reference names nothing (ADR #19), so they come along. Nothing is left
  // open afterwards, so the review is done.
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();

  // The point: the chapter exists, with the title the RUN was started with —
  // not the id, and not nothing — and the outline's description as its text,
  // verbatim and without a heading.
  const chapter = await getChapter(api, CHAPTER_ID);
  expect(chapter.title).toBe(CHAPTER_TITLE);
  expect(chapter.body).toBe(`${CHAPTER_DESCRIPTION}\n`);
  // …and the scene really hangs in it.
  expect((await getScene(api, SCENE_ID)).chapter).toBe(CHAPTER_ID);

  // The overview lists the chapter with that title, and the scene inside it.
  await page.getByRole("link", { name: "Kapitel", exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("heading", { level: 2, name: CHAPTER_TITLE })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(CHAPTER_TITLE) }).click();
  await expect(page.getByRole("link", { name: new RegExp(SCENE_TITLE) })).toBeVisible();
  await expect(page.getByText("2 Kapitel · 3 Szenen")).toBeVisible();
  // …and its text is what the overview shows under the chapter's title.
  await expect(
    page.getByText("Nachts verschwinden Ladungen aus dem Hafen", { exact: false }),
  ).toBeVisible();
});

// A run into an EXISTING chapter never reaches that chapter's text: the
// outline call is not told the chapter is new, and a description the model
// sends anyway is dropped by the server — the review shows none, and the
// accept leaves the text exactly as the DM wrote it.
test("a run into an existing chapter leaves the chapter's text alone", async ({ page, api }) => {
  const before = await getChapter(api, "01-salzhafen");
  await page.goto("/campaigns/beispiel/generate");
  await page.getByLabel("Quelltext (EN)").fill(`${SOURCE} ${TRIGGER.describeAnyway}`);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entwürfe prüfen", {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Beschreibung des Kapitels" })).toHaveCount(0);
  await expect(page.getByText("Nachts verschwinden Ladungen", { exact: false })).toHaveCount(0);

  // Accept the whole run: the proposed npc and location, then everything open.
  const acceptEntry = page.getByRole("button", { name: "Annehmen" });
  await expect(acceptEntry).toHaveCount(2);
  await acceptEntry.first().click();
  await expect(acceptEntry).toHaveCount(1);
  await acceptEntry.first().click();
  await expect(acceptEntry).toHaveCount(0);
  await page.getByRole("button", { name: /^Übernehmen \(/ }).click();
  await expect(page.getByText("Geschrieben — alles als Entwurf")).toBeVisible();

  expect((await getScene(api, SCENE_ID)).chapter).toBe("01-salzhafen");
  expect((await getChapter(api, "01-salzhafen")).body).toBe(before.body);
});
