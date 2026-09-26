// Critical path 8: the mobile start surface and the idea capture at 390px;
// see CLAUDE.md.
//
// Mobile is search, reading view and ideas (UI-BRIEF) — exactly that, checked
// at 390×844 (iPhone size), including what the server stored.

import type { SessionSeed } from "@grimoire/shared/session";

import { expect, test } from "../support/test";
import { getIdeas } from "../support/idea";

/** A session that started YESTERDAY and was never ended. */
const OPEN_SESSION: SessionSeed = (() => {
  const d = new Date(Date.now() - 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const id = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { id, started: `${id}T22:30:00`, body: "", pauses: [], log: [] };
})();

test.use({ viewport: { width: 390, height: 844 } });

const IDEA = "Nachtmarkt im Hafen als Aufhänger #thread";

test("mobile start surface: search, idea capture, lookup lists", async ({ page, api }) => {
  await page.goto("/campaigns/beispiel");

  // The desktop topbar is desktop chrome — below md the surface carries its
  // own wordmark instead.
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("main").getByText("Grimoire", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Kampagne: Der Leuchtturm von Salzhafen"),
  ).toBeVisible();
  // The desktop chapter overview is not rendered here.
  await expect(page.getByText("Eventualszenen")).toBeHidden();

  // Lookup rows with their counts from the tree.
  const lookup = page.getByRole("navigation", { name: "Nachschlagen" });
  await expect(lookup.getByRole("link", { name: /Szenen/ })).toContainText("2 Szenen");
  await expect(lookup.getByRole("link", { name: /NPCs/ })).toContainText("2 NPCs");
  // The npc row leads to the npc list on its own route (decisions/resources).
  await expect(lookup.getByRole("link", { name: /NPCs/ })).toHaveAttribute(
    "href",
    "/campaigns/beispiel/npcs",
  );
  // Two locations: each one a scene names exists on its own, because a
  // reference creates nothing (decisions/constraints).
  await expect(lookup.getByRole("link", { name: /Orte/ })).toContainText("2 Orte");

  // --- idea capture --------------------------------------------------------
  const capture = page.getByLabel("Ideen");
  await capture.fill(IDEA);
  await page.getByRole("button", { name: "Einwerfen" }).click();

  await expect(page.getByText("Eingeworfen.")).toBeVisible();
  await expect(capture).toHaveValue("");
  // The idea is an IDEA of its own, flat, with its own guard, at the end: the
  // idea that was already there survives unchanged, and nothing is ticked off.
  await expect.poll(() => getIdeas(api)).toEqual([
    {
      id: "dorfschmied",
      text: "Idee: Der Dorfschmied repariert auffällig oft Schmugglerwerkzeug #thread",
      done: false,
      rev: 1,
    },
    { id: expect.any(String), text: IDEA, done: false, rev: 1 },
  ]);

  // --- search and reading view ---------------------------------------------
  await page.getByRole("button", { name: "Szenen, NPCs, Orte suchen …" }).click();
  const search = page.getByRole("combobox");
  await expect(search).toBeVisible();
  await search.fill("fenn");
  await page.getByRole("option").filter({ hasText: "Fenn" }).first().click();

  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs\/fenn$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fenn");
  // The mobile read view has its own way back to the start surface.
  const back = page.getByRole("link", { name: "Kapitel" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByLabel("Ideen")).toBeVisible();
});

// A running session must be visible on EVERY route, mobile included — where
// the topbar is not the chrome, the indicator is its own row.
test.describe("with a session open since yesterday", () => {
  test.use({ seed: { sessions: [OPEN_SESSION] } });

  test("mobile: a running session shows its own live row with the way back", async ({
    page,
  }) => {
    // The session is the server's answer, not something the client derives
    // from today's date — it comes out of the seeded session row.
    await page.goto("/campaigns/beispiel");
    // The same chip the desktop topbar carries — in link mode, in the mobile
    // row: one tap back into the session.
    const row = page.getByRole("link", { name: /Session läuft/ });
    await expect(row).toBeVisible();
    // The runtime is computed from the SERVER's reading of `started`, so it is
    // a real elapsed time (well over an hour by now), not 0:00:00.
    await expect(row).toContainText(/\d+:\d{2}:\d{2}/);
    await row.click();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  });
});

test("mobile: the reference scene's reading view stays readable", async ({ page }) => {
  // Reached the way a phone reaches it: the lookup row of the start surface,
  // then the scene list — onto the scene's own route (decisions/resources).
  await page.goto("/campaigns/beispiel");
  await page.getByRole("link", { name: /^Szenen/ }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/scenes$/);
  await page.getByRole("link", { name: /Ankunft am Leuchtturm/ }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/scenes\/lighthouse-arrival$/);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ankunft am Leuchtturm");
  await expect(page.locator("[data-callout='readaloud']")).toBeVisible();
  // The NPC cards stack below the body instead of sitting in a sticky aside.
  await expect(page.getByRole("link", { name: /Hafenmeisterin Jorna/ }).first()).toBeVisible();

  // Nothing may scroll the page sideways at 390px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
