// Kritischer Pfad 6: Generator-Zyklus gegen das Stub-LLM — Job → Review →
// Übernehmen → draft im Pool, dazu der NPC-Modus und ein Fehlerpfad.
//
// Nichts daran ist gemockt außer dem Modell selbst: die App startet einen
// echten Hintergrund-Job, der Server ruft über den echten
// OpenAICompatProvider ein echtes HTTP-Endpoint (e2e/fixtures/stub-llm.ts) und
// validiert die Antwort mechanisch wie in Produktion.

import {
  LOCATION_STUB_ID,
  LOCATION_STUB_NAME,
  NPC_DEFAULT_NAME,
  NPC_ROLE,
  NPC_STUB_ID,
  NPC_STUB_NAME,
  SCENE_SLUG,
  SCENE_TITLE,
  TRIGGER,
} from "../fixtures/replies";
import { expect, test } from "../support/test";

const SOURCE = `The party watches the quay at low tide. Two lanterns move along the
mole while Fenn's crew shifts a cargo before dawn.`;

const NPC_SOURCE = `Brakk Ironhand, an ageing fisherman who knows every sandbank
of the north bay. He has seen strangers carrying crates at night and keeps
quiet out of fear.`;

test("Szenen-Lauf: Job, Review, Übernehmen — Draft liegt auf der Platte und im Pool", async ({
  page,
  files,
}) => {
  await page.goto("/beispiel/generate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Szenen generieren");

  // The active chapter is preselected, and the context hint names what travels.
  await expect(
    page.getByRole("button", { name: "Kapitel 1: Der Leuchtturm von Salzhafen" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("2 NPCs · 1 Ort · Glossar")).toBeVisible();

  await page.getByLabel("Quelltext (EN)").fill(SOURCE);
  await page.getByRole("button", { name: "Entwürfe generieren" }).click();

  // The review of the finished job (the working state may flash by).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review", {
    timeout: 30_000,
  });
  await expect(page.getByText("1 Szene · 2 Stubs · noch nichts geschrieben")).toBeVisible();
  // Token spend of the run (the stub reports usage like a real endpoint).
  await expect(page.getByText(/~[\d.]+ Tokens · 1 Versuch/)).toBeVisible();
  // The model's warning is shown, not swallowed.
  await expect(page.getByText("Der Frachtbrief ist erfunden", { exact: false })).toBeVisible();

  // The draft card: title, target path, status pill, rendered body.
  const card = page.locator("div").filter({ hasText: `01-salzhafen/${SCENE_SLUG}.md` }).last();
  await expect(page.getByRole("heading", { level: 2, name: SCENE_TITLE })).toBeVisible();
  await expect(card).toContainText("draft");
  await expect(card.locator("[data-callout='readaloud']")).toContainText("Die Flut zieht sich");
  await expect(card.locator("[data-callout='loot']")).toContainText("Beute");
  await expect(card.locator("details[data-if-section]")).toHaveCount(2);

  // Nothing is on disk before "Übernehmen".
  expect(await files.exists(`01-salzhafen/${SCENE_SLUG}.md`)).toBe(false);

  // Stubs are decided one by one. An undecided row is the innermost div that
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
  await expect(page.getByText("Stubs — einzeln entscheiden")).toBeVisible();
  await acceptStub(`npcs/${NPC_STUB_ID}.md`, NPC_STUB_NAME);
  await acceptStub(`locations/${LOCATION_STUB_ID}.md`, LOCATION_STUB_NAME);
  await expect(page.getByRole("button", { name: "Angenommen" })).toHaveCount(2);

  await page.getByRole("button", { name: /^Übernehmen \(1 Szene · 2 Stubs\)$/ }).click();

  // Done state lists exactly what was written.
  await expect(page.getByText("Geschrieben — alles als draft")).toBeVisible();
  await expect(page.getByText(`01-salzhafen/${SCENE_SLUG}.md`)).toBeVisible();

  // On disk: the draft plus both stubs, and a location stub without a status.
  const scene = await files.read(`01-salzhafen/${SCENE_SLUG}.md`);
  expect(scene).toContain("status: draft");
  expect(scene).toContain(`title: ${SCENE_TITLE}`);
  expect(scene).toContain("> [!loot]");
  const npcFile = await files.read(`npcs/${NPC_STUB_ID}.md`);
  expect(npcFile).toContain("status: alive");
  const locationFile = await files.read(`locations/${LOCATION_STUB_ID}.md`);
  expect(locationFile).not.toContain("status:");

  // Back in the pool the draft shows up with the German status label.
  await page.getByRole("button", { name: "Zum Pool" }).click();
  await expect(page).toHaveURL(/\/beispiel$/);
  const row = page.getByRole("link", { name: new RegExp(SCENE_TITLE) });
  await expect(row).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Status ändern, aktuell Entwurf" }),
  ).toBeVisible();
  await expect(page.getByText("1 Kapitel · 3 Szenen")).toBeVisible();
});

test("NPC-Lauf: vorgegebene id, Review, Übernehmen", async ({ page, files }) => {
  await page.goto("/beispiel/generate");
  await page.getByRole("button", { name: "NPC", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("NPC generieren");

  await page.getByLabel("Quelltext", { exact: true }).fill(NPC_SOURCE);
  await page.getByLabel("id (optional)").fill("brakk");
  await expect(page.getByText("wird angelegt als: npcs/brakk.md")).toBeVisible();

  await page.getByRole("button", { name: "NPC generieren", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review", {
    timeout: 30_000,
  });
  await expect(page.getByText("1 NPC · noch nichts geschrieben")).toBeVisible();
  const card = page.locator("div").filter({ hasText: "npcs/brakk.md" }).last();
  await expect(page.getByRole("heading", { level: 2, name: NPC_DEFAULT_NAME })).toBeVisible();
  await expect(card).toContainText("lebendig");
  await expect(card).toContainText(NPC_ROLE);
  // Quoted quickstats survive as strings — the plus is still there.
  await expect(card).toContainText("insight +1");
  await expect(card.locator("[data-callout='secret']")).toContainText("Hat gesehen");

  expect(await files.exists("npcs/brakk.md")).toBe(false);
  await page.getByRole("button", { name: "Übernehmen", exact: true }).click();

  await expect(page.getByText("Geschrieben — NPC-Datei angelegt")).toBeVisible();
  const npc = await files.read("npcs/brakk.md");
  expect(npc).toContain("id: brakk");
  expect(npc).toContain("status: alive");
  expect(npc).toContain('insight: "+1"');

  // "NPC ansehen" opens the file that now exists.
  await page.getByRole("button", { name: "NPC ansehen" }).click();
  await expect(page).toHaveURL(/\/beispiel\/file\/npcs\/brakk\.md$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NPC_DEFAULT_NAME);
});

test("Fehlerpfad: ungültige Modellantwort zeigt den 422-Block mit Rohantwort", async ({
  page,
  files,
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
  // Two attempts: the first call plus the correction turn.
  await expect(page.getByText(/~[\d.]+ Tokens · 2 Versuche/)).toBeVisible();

  // The raw reply is one click away — that is what makes a 422 debuggable.
  await page.getByText("Rohantwort anzeigen").click();
  await expect(page.locator("pre")).toContainText("night-watch-quay");

  // Nothing was written, and the form is usable again.
  expect(await files.exists(`01-salzhafen/${SCENE_SLUG}.md`)).toBe(false);
  await expect(page.getByRole("button", { name: "Entwürfe generieren" })).toBeEnabled();
});
