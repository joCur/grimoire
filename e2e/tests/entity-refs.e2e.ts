// Entity references in body text — `[[slug]]`.
//
// Touches three critical paths (CLAUDE.md):
//
//   2 "Szene lesen"      the reference renders as the CURRENT display name,
//                        an unknown slug stays plain text
//   3 "⌘K-Suche"         the scene is findable under that display name,
//                        although its body only holds the slug
//   6 (generator)        covered in generator.e2e.ts: the stub's draft ships
//                        `[[…]]` and the review renders it
//
// Plus the live behaviour: a click opens the DRAWER, it does not navigate —
// the whole point of resolving at render time is that the DM never leaves the
// running session for a name.
//
// The scene is SEEDED as an extra entry: it references an npc, a location
// and a slug nothing owns.

import { readFileSync } from "node:fs";
import path from "node:path";

import { E2E_FIXTURES_DIR } from "../support/paths";
import { expect, test, type SeedEntry } from "../support/test";

/** The scene with the `[[…]]` references, as an entry. */
const SCENE: SeedEntry = JSON.parse(
  readFileSync(path.join(E2E_FIXTURES_DIR, "entity-refs-scene.json"), "utf8"),
) as SeedEntry;

/** Its address: chapter, location and the scene's id. */
const SCENE_PATH = "01-salzhafen/leuchtturm/entity-refs";

const SCENE_URL = "/campaigns/beispiel/entries/01-salzhafen/leuchtturm/entity-refs";
const SCENE_TITLE = "Referenzen am Kai";
const JORNA = "Hafenmeisterin Jorna";

test.use({ seed: { entries: { "scene-entity-refs": SCENE } } });

test("reading view: references render as the current name, unknown ones stay text", async ({
  page,
}) => {
  await page.goto(SCENE_URL);

  // Resolved: the NPC's CURRENT name, as a link into the entity view.
  // The fixture mentions Jorna twice (prose and read-aloud) — the first one
  // is the paragraph.
  const ref = page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first();
  await expect(ref).toHaveText(JORNA);
  await expect(ref).toHaveAttribute("href", "/campaigns/beispiel/entries/npcs/jorna");

  // The suffix stays outside the reference — "Jornas Boot" reads as German.
  await expect(page.locator(".md-body")).toContainText(`${JORNA}s Boot`);

  // The location resolves too (kind: location).
  await expect(
    page.getByRole("link", { name: "Ort: Der Leuchtturm von Salzhafen" }).first(),
  ).toBeVisible();

  // Degradation: nothing owns `niemand`, so the source stays visible — no
  // error, no warning colour, and it becomes a link the moment it exists.
  await expect(page.locator(".md-body")).toContainText("[[niemand]]");
  await expect(page.getByRole("link", { name: /niemand/ })).toHaveCount(0);

  // The reference is a real link and opens the entity.
  await ref.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/entries\/npcs\/jorna$/);
  await expect(page.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
});

test("code stays code, and an `## If:` summary toggles instead of navigating", async ({
  page,
}) => {
  await page.goto(SCENE_URL);

  // `` `[[jorna]]` `` is the SYNTAX, quoted: it renders literally and never
  // becomes a link — the same skip the search index applies.
  await expect(
    page.locator(".md-body code").filter({ hasText: "[[jorna]]" }).first(),
  ).toBeVisible();

  // A branch SUMMARY resolves to the name, but as plain text: the row is the
  // toggle, so a click folds the branch instead of leaving the page.
  const details = page.locator("details[data-if-section]").first();
  const summary = details.locator("summary");
  await expect(summary).toContainText(`${JORNA} gewarnt wurde`);
  await expect(summary.getByRole("link")).toHaveCount(0);
  await expect(summary.getByRole("button")).toHaveCount(0);

  await expect(details).toHaveAttribute("open", "");
  await summary.click();
  await expect(details).not.toHaveAttribute("open", "");
  await expect(page).toHaveURL(new RegExp(`${SCENE_URL}$`));
});

test("live view: a reference opens the drawer instead of leaving the session", async ({
  page,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);

  await page.getByRole("button", { name: SCENE_TITLE }).click();
  await expect(page.getByRole("heading", { level: 1, name: SCENE_TITLE })).toBeVisible();

  // In the live view the reference is a BUTTON, not a link.
  await page.getByRole("button", { name: `NPC: ${JORNA}`, exact: true }).first().click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Eintrag öffnen" })).toBeVisible();
  // Still in the live view, still on the same scene.
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
});

test("a changed display name reaches the prose without touching the body", async ({
  page,
  api,
}) => {
  const NEW_NAME = "Hafenmeisterin Jorna Salzhand";
  await page.goto(SCENE_URL);
  await expect(
    page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first(),
  ).toBeVisible();

  // The NAME changes, the body does not.
  await api.patchProperties("npcs/jorna", { name: NEW_NAME });
  const stored = await api.entry(SCENE_PATH);
  expect(stored.body).toContain("[[jorna]]");
  expect(stored.body).not.toContain(NEW_NAME);

  // The version poll refetches the tree; the prose follows by itself.
  await expect(
    page.getByRole("link", { name: `NPC: ${NEW_NAME}`, exact: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }),
  ).toHaveCount(0);

  // Critical path 3: the scene is findable under the NEW name, although its
  // body only ever held the slug (the server expands references when it
  // indexes — server/src/store/refs.ts).
  const found = await api.get<{ results: { id: string; kind: string }[] }>(
    `campaigns/beispiel/search?q=${encodeURIComponent("Salzhand")}`,
  );
  expect(found.results.map((r) => `${r.kind}:${r.id}`)).toContain("scene:entity-refs");
});
