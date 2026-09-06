// Entity references in body text (issue #68) — `[[slug]]`.
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
// The scene is SEEDED (examples/ is a format contract and stays untouched):
// it references an npc, a location and a slug nothing owns.

import { readFileSync } from "node:fs";
import path from "node:path";

import { FIXTURES_DIR } from "../support/paths";
import { expect, test } from "../support/test";

const SCENE = {
  path: "01-salzhafen/hafen/entity-refs.md",
  content: readFileSync(path.join(FIXTURES_DIR, "entity-refs-scene.md"), "utf8"),
};

const SCENE_URL = "/beispiel/file/01-salzhafen/hafen/entity-refs.md";
const SCENE_TITLE = "Referenzen am Kai";
const JORNA = "Hafenmeisterin Jorna";

test.use({ seed: { files: { [SCENE.path]: SCENE.content } } });

test("reading view: references render as the current name, unknown ones stay text", async ({
  page,
}) => {
  await page.goto(SCENE_URL);

  // Resolved: the NPC's CURRENT name, as a link into the entity view.
  // The fixture mentions Jorna twice (prose and read-aloud) — the first one
  // is the paragraph.
  const ref = page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first();
  await expect(ref).toHaveText(JORNA);
  await expect(ref).toHaveAttribute("href", "/beispiel/file/npcs/jorna.md");

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
  await expect(page).toHaveURL(/\/beispiel\/file\/npcs\/jorna\.md$/);
  await expect(page.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
});

test("live view: a reference opens the drawer instead of leaving the session", async ({
  page,
}) => {
  await page.goto("/beispiel");
  await page.getByRole("button", { name: "Session starten" }).click();
  await expect(page).toHaveURL(/\/beispiel\/live$/);

  await page.getByRole("button", { name: SCENE_TITLE }).click();
  await expect(page.getByRole("heading", { level: 1, name: SCENE_TITLE })).toBeVisible();

  // In the live view the reference is a BUTTON, not a link.
  await page.getByRole("button", { name: `NPC: ${JORNA}`, exact: true }).first().click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { level: 1, name: JORNA })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Eintrag öffnen" })).toBeVisible();
  // Still in the live view, still on the same scene.
  await expect(page).toHaveURL(/\/beispiel\/live$/);
});

test("a renamed display name reaches the prose without touching the body", async ({
  page,
  api,
}) => {
  const NEW_NAME = "Hafenmeisterin Jorna Salzhand";
  await page.goto(SCENE_URL);
  await expect(
    page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first(),
  ).toBeVisible();

  // The NAME changes, the body does not.
  await api.patchFrontmatter("npcs/jorna.md", { name: NEW_NAME });
  const stored = await api.file(SCENE.path);
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
    `beispiel/search?q=${encodeURIComponent("Salzhand")}`,
  );
  expect(found.results.map((r) => `${r.kind}:${r.id}`)).toContain("scene:entity-refs");
});

test("an id rename drags the body reference along", async ({ page, api }) => {
  // The preview counts the prose mention as a reference site.
  const usage = await api.get<{ groups: { ref: string; count: number }[] }>(
    "beispiel/usage?kind=npc&id=jorna",
  );
  expect(usage.groups.find((g) => g.ref === "bodyRefs")?.count).toBeGreaterThanOrEqual(1);

  await api.send("POST", "beispiel/rename", { kind: "npc", oldId: "jorna", newId: "jorna-b" });

  const stored = await api.file(SCENE.path);
  expect(stored.body).toContain("[[jorna-b]]");
  expect(stored.body).not.toContain("[[jorna]]");

  // …and the reference is still alive on the page, under the same name.
  await page.goto(SCENE_URL);
  const ref = page.getByRole("link", { name: `NPC: ${JORNA}`, exact: true }).first();
  await expect(ref).toHaveAttribute("href", "/beispiel/file/npcs/jorna-b.md");
});
