// Critical path 1: auto entry — the pool loads the campaign; see CLAUDE.md.
//
// "/" has no page of its own (issue #14): it redirects into the campaign the
// server reports, and the pool is the first thing the DM sees — campaign
// header, the active chapter with its goal line, the location group and the
// contingency block.
//
// Issue #34 lives on this path as well: the group header resolves its slug
// against the locations, the topbar carries the NPCs/Orte navigation (the
// pool's own footer line is gone), and the campaign's name/description are
// editable from the header.

import { expect, test } from "../support/test";

/** A location file for the `hafen` group directory of the fixture campaign. */
const HAFEN_LOCATION = `---
id: hafen
name: Hafenviertel von Salzhafen
chapter: 01-salzhafen
---

## Beim ersten Betreten

Möwen, Salz und Teer; an der Kaimauer liegen drei Kutter.
`;

test("\"/\" redirects into the campaign and the pool shows chapter and scenes", async ({
  page,
}) => {
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
  // The fixture has NO `locations/hafen.md` — group directories are a loose
  // convention, so the header shows the raw slug (issue #34, fallback).
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

test("a group header shows the location NAME once the location file exists", async ({
  page,
  files,
}) => {
  // Same group directory as above, but now with a location file behind it —
  // this is the pair the display-name rule of issue #34 is about.
  await files.write("locations/hafen.md", HAFEN_LOCATION);

  await page.goto("/beispiel");
  await expect(page.getByText("Hafenviertel von Salzhafen", { exact: true })).toBeVisible();
  // The slug itself is no longer on screen anywhere.
  await expect(page.getByText("hafen", { exact: true })).toHaveCount(0);
});

test("the topbar links reach the lists without the campaign label jumping", async ({ page }) => {
  await page.goto("/beispiel");

  const nav = page.getByRole("banner").getByRole("navigation", { name: "NPCs und Orte" });
  await expect(nav.getByRole("link", { name: "NPCs" })).toBeVisible();

  // The pool's own "NPCs · Orte" footer line (issue #26) is gone — the topbar
  // is the only place that navigation lives now (issue #34).
  await expect(page.getByRole("main").getByRole("link", { name: "NPCs" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link", { name: "Orte" })).toHaveCount(0);

  // The campaign context of the pool: the switcher, prefix included.
  const label = page.getByRole("banner").getByRole("button", { name: /^Kampagne: / });
  await expect(label).toHaveAccessibleName("Kampagne: Der Leuchtturm von Salzhafen");
  const boxOnPool = await label.boundingBox();

  await nav.getByRole("link", { name: "Orte" }).click();
  await expect(page).toHaveURL(/\/beispiel\/list\/locations$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Orte");
  await expect(
    page.getByRole("main").getByRole("link", { name: /Der Leuchtturm von Salzhafen/ }),
  ).toBeVisible();

  // Same element, same prefix, same place — the list view must not swap the
  // switcher for a bare name (PO feedback on PR #35). The list title rides
  // behind it as a crumb.
  await expect(label).toHaveAccessibleName("Kampagne: Der Leuchtturm von Salzhafen");
  const boxOnList = await label.boundingBox();
  expect(boxOnList?.x).toBe(boxOnPool?.x);
  expect(boxOnList?.y).toBe(boxOnPool?.y);
  expect(boxOnList?.width).toBe(boxOnPool?.width);
  await expect(page.getByRole("banner").getByText("Orte", { exact: true })).toHaveCount(2);

  // The links stay reachable from the list view itself.
  await page.getByRole("banner").getByRole("link", { name: "NPCs" }).click();
  await expect(page).toHaveURL(/\/beispiel\/list\/npcs$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("NPCs");
  await expect(label).toHaveAccessibleName("Kampagne: Der Leuchtturm von Salzhafen");
  expect((await label.boundingBox())?.x).toBe(boxOnPool?.x);

  // The switcher still switches here: picking the current campaign is also
  // the way back to the pool.
  await label.click();
  await page.getByRole("menuitem", { name: /Der Leuchtturm von Salzhafen/ }).click();
  await expect(page).toHaveURL(/\/beispiel$/);
});

test("editing the campaign metadata updates header, switcher and the file", async ({
  page,
  files,
}) => {
  await page.goto("/beispiel");

  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Kampagne bearbeiten");
  // Prefilled from the values currently on screen.
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Der Leuchtturm von Salzhafen",
  );
  await expect(dialog.getByLabel("Beschreibung")).toHaveValue(
    /Eine Küstenkampagne um einen erloschenen Leuchtturm/,
  );

  await dialog.getByLabel("Name", { exact: true }).fill("Salzhafen, zweite Fassung");
  await dialog.getByLabel("Beschreibung").fill("Jetzt mit mehr Schmuggel und weniger Möwen.");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Pool header, subtitle …
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Salzhafen, zweite Fassung");
  await expect(page.getByText("Jetzt mit mehr Schmuggel und weniger Möwen.")).toBeVisible();
  // … and the switcher label, which reads the campaign list.
  await expect(
    page.getByRole("button", { name: "Kampagne: Salzhafen, zweite Fassung" }),
  ).toBeVisible();

  // On disk: the frontmatter changed, the body did not.
  const raw = await files.read("_campaign.md");
  expect(raw).toContain("name: Salzhafen, zweite Fassung");
  expect(raw).toContain("description: Jetzt mit mehr Schmuggel und weniger Möwen.");
  expect(raw).toContain("Kampagnenweite Notizen:");
  expect(raw).not.toContain("Eine Küstenkampagne");
});

test("the metadata dialog creates _campaign.md when the campaign has none", async ({
  page,
  files,
}) => {
  // The one gap PATCH /frontmatter cannot close: no file, hence no mtime.
  await files.remove("_campaign.md");

  await page.goto("/beispiel");
  // Without the file the header degrades to the directory name.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("beispiel");

  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("noch keine _campaign.md");
  // Nothing to prefill — the id is only the placeholder, never a proposal.
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("");

  await dialog.getByLabel("Name", { exact: true }).fill("Salzhafen von vorn");
  await dialog.getByLabel("Beschreibung").fill("Frisch angelegt aus der App.");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Salzhafen von vorn");
  // The id is the DIRECTORY name — the server sets it, never the client.
  const raw = await files.read("_campaign.md");
  expect(raw).toContain("id: beispiel");
  expect(raw).toContain("name: Salzhafen von vorn");
  expect(raw).toContain("description: Frisch angelegt aus der App.");
});

test("the campaign reading view carries the same edit action", async ({ page, files }) => {
  await page.goto("/beispiel/file/_campaign.md");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );

  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Aus der Leseansicht");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Aus der Leseansicht");
  await expect.poll(() => files.read("_campaign.md")).toContain("name: Aus der Leseansicht");
});
// The dialog's 409 path is the SAME write flow as the status control's
// (lib/campaign-meta.ts mirrors lib/scene-status.ts: conflict -> inline
// "Datei extern geändert — neu laden" + refetch, nothing written). Critical
// path 7 covers that mechanism against the real server; the dialog's own
// branch is unit-tested in app/src/lib/campaign-meta.test.ts. Reproducing it
// here would need the same "beat the 5s version poll" loop — and a retry that
// closes the dialog on success, which makes the loop unrepeatable.
