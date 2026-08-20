// Kritischer Pfad 1: Auto-Einstieg "/" → Pool lädt die Kampagne.
//
// "/" has no page of its own (issue #14): it redirects into the campaign the
// server reports, and the pool is the first thing the DM sees — campaign
// header, the active chapter with its goal line, the location group and the
// contingency block.

import { expect, test } from "../support/test";

test("„/“ leitet in die Kampagne und der Pool zeigt Kapitel und Szenen", async ({ page }) => {
  await page.goto("/");

  // The redirect target comes from the server (lastSession per campaign).
  await expect(page).toHaveURL(/\/beispiel$/);

  // Campaign header from _campaign.md (issue #17).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );
  await expect(page.getByText("1 Kapitel · 2 Szenen")).toBeVisible();
  await expect(
    page.getByText("Eine Küstenkampagne um einen erloschenen Leuchtturm", { exact: false }),
  ).toBeVisible();

  // The chapter accordion: title, "aktiv" pill, scene count, goal line.
  const chapter = page.getByRole("button", {
    name: /Kapitel 1: Der Leuchtturm von Salzhafen/,
  });
  await expect(chapter).toBeVisible();
  await expect(chapter).toContainText("aktiv");
  await expect(chapter).toContainText("2 Szenen");
  // Open by default (status: active) — the goal comes from _chapter.md.
  await expect(
    page.getByText("Ziel: Herausfinden, warum das Leuchtfeuer seit drei Nächten erloschen ist."),
  ).toBeVisible();

  // Planned scene in its location group, with the status control's label.
  await expect(page.getByText("hafen", { exact: true })).toBeVisible();
  const planned = page.getByRole("link", { name: /Ankunft am Leuchtturm/ });
  await expect(planned).toBeVisible();
  await expect(planned).toContainText("Leuchtturm von Salzhafen · #social #travel");
  await expect(
    page.getByRole("button", { name: "Status ändern, aktuell bereit" }).first(),
  ).toBeVisible();

  // Contingencies live in their own group.
  await expect(page.getByText("Falls es schiefgeht")).toBeVisible();
  const contingency = page.getByRole("link", { name: /Von den Schmugglern erwischt/ });
  await expect(contingency).toBeVisible();
  await expect(contingency).toContainText(
    "Wenn: Charaktere werden beim Auskundschaften der Bucht entdeckt",
  );

  // Opening a row is the pool's job — the reading view takes over from here.
  await planned.click();
  await expect(page).toHaveURL(/\/beispiel\/file\/01-salzhafen\/hafen\/ankunft-leuchtturm\.md$/);
});
