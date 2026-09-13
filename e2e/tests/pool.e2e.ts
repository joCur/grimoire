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

import type { Page } from "@playwright/test";

import { expect, test, todaySessionId } from "../support/test";

/**
 * How far the topbar's content sticks out of the row, in pixels (0 = it fits).
 *
 * Measured as "right edge of the rightmost child vs. the row's CONTENT edge",
 * not as `header.scrollWidth - header.clientWidth` (issue #69 CI finding):
 * an overflowing flex item first eats the row's 24px right padding, and
 * `scrollWidth` does not grow for that at all — the old metric reported a
 * clean row while the session chip was already 10px past the padding and,
 * further out, past the viewport. The page's own horizontal scroll is
 * reported alongside, since that is the other half of "does not overflow".
 */
async function topbarOverflow(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const doc = document.documentElement;
    const pageOverflow = doc.scrollWidth - doc.clientWidth;
    // Below md the topbar is hidden on campaign routes (the mobile start
    // surface is the chrome there): no box, nothing to overflow.
    if (header === null || header.getBoundingClientRect().width === 0) {
      return { row: 0, page: pageOverflow };
    }
    const style = getComputedStyle(header);
    const contentRight =
      header.getBoundingClientRect().right - parseFloat(style.paddingRight);
    const rightmost = Math.max(
      ...[...header.children].map((el) => el.getBoundingClientRect().right),
    );
    return { row: Math.max(0, Math.round(rightmost - contentRight)), page: pageOverflow };
  });
}

/**
 * Stands in for WIDER GLYPHS than the machine running the test happens to
 * have. Linux CI renders every label ~2px wider than macOS does, which is how
 * the row came to overflow on CI only (issue #69) — twice. `letter-spacing`
 * on the row reproduces that class of difference locally and scales it, so
 * the guard below asserts that the row survives 1px of it: far more than the
 * ~0.6px equivalent of the observed CI delta, at every width.
 */
async function widenGlyphs(page: Page, spacing: string) {
  await page.addStyleTag({
    content: `header, header * { letter-spacing: ${spacing} !important; }`,
  });
}

/**
 * The widths the row is checked at. 1000/1024/1040 bracket the lg breakpoint
 * (the nav trio appears), 1280 the xl one (the trio, the full search chip and
 * the chip's reserved width all switch on at once — the tightest width there
 * is), 768 the corner where the search chip is already at its floor.
 */
const TOPBAR_WIDTHS = [640, 768, 900, 1000, 1024, 1040, 1100, 1280, 1300, 1536];

/** A location file for the `hafen` group directory of the fixture campaign. */
const HAFEN_LOCATION = `---
id: hafen
name: Hafenviertel von Salzhafen
chapter: 01-salzhafen
---

## Beim ersten Betreten

Möwen, Salz und Teer; an der Kaimauer liegen drei Kutter.
`;

/** Today's session, started at 19:30 and never ended. */
const RUNNING_SESSION = (() => {
  const id = todaySessionId();
  return {
    path: `sessions/${id}`,
    content: `---\nid: ${id}\nstarted: ${id}T19:30\nscenes_played: []\n---\n\n## Log\n`,
  };
})();

test('"/" redirects into the campaign and the pool shows chapter and scenes', async ({
  page,
}) => {
  await page.goto("/");

  // The redirect target comes from the server (lastSession per campaign).
  await expect(page).toHaveURL(/\/beispiel$/);

  // Campaign header from _campaign (issue #17).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );
  await expect(page.getByText("1 Kapitel · 2 Szenen")).toBeVisible();
  await expect(
    page.getByText("Eine Küstenkampagne um einen erloschenen Leuchtturm", {
      exact: false,
    }),
  ).toBeVisible();

  // The chapter accordion: title, "aktiv" pill, scene count, goal line.
  const chapter = page.getByRole("button", {
    name: /Kapitel 1: Der Leuchtturm von Salzhafen/,
  });
  await expect(chapter).toBeVisible();
  await expect(chapter).toContainText("aktiv");
  await expect(chapter).toContainText("2 Szenen");
  // Open by default (status: active) — the goal comes from _chapter.
  await expect(
    page.getByText(
      "Ziel: Herausfinden, warum das Leuchtfeuer seit drei Nächten erloschen ist.",
    ),
  ).toBeVisible();

  // Planned scene in its location group, with the status control's label.
  // The fixture has NO `locations/hafen` — group directories are a loose
  // convention, so the header shows the raw slug (issue #34, fallback).
  await expect(page.getByText("hafen", { exact: true })).toBeVisible();
  const planned = page.getByRole("link", { name: /Ankunft am Leuchtturm/ });
  await expect(planned).toBeVisible();
  await expect(planned).toContainText(
    "Leuchtturm von Salzhafen · #social #travel",
  );
  await expect(
    page.getByRole("button", { name: "Status ändern, aktuell bereit" }).first(),
  ).toBeVisible();

  // Contingencies live in their own group.
  await expect(page.getByText("Falls es schiefgeht")).toBeVisible();
  const contingency = page.getByRole("link", {
    name: /Von den Schmugglern erwischt/,
  });
  await expect(contingency).toBeVisible();
  await expect(contingency).toContainText(
    "Wenn: Charaktere werden beim Auskundschaften der Bucht entdeckt",
  );

  // Opening a row is the pool's job — the reading view takes over from here.
  await planned.click();
  await expect(page).toHaveURL(
    /\/beispiel\/file\/01-salzhafen\/hafen\/lighthouse-arrival$/,
  );
});

test.describe("with a location for the group directory", () => {
  test.use({ seed: { files: { "locations/hafen": HAFEN_LOCATION } } });

  test("a group header shows the location NAME once the location file exists", async ({
    page,
  }) => {
    // Same group directory as above, but now with a location file behind it —
    // this is the pair the display-name rule of issue #34 is about (seeded into
    // the tree this test's database is imported from).
    await page.goto("/beispiel");
    await expect(
      page.getByText("Hafenviertel von Salzhafen", { exact: true }),
    ).toBeVisible();
    // The slug itself is no longer on screen anywhere.
    await expect(page.getByText("hafen", { exact: true })).toHaveCount(0);
  });
});

test("the topbar trio navigates without anything in the left block moving", async ({
  page,
}) => {
  const CAMPAIGN_LABEL = "Kampagne: Der Leuchtturm von Salzhafen";
  const nav = page
    .getByRole("banner")
    .getByRole("navigation", { name: "Kapitel, NPCs und Orte" });
  // The campaign context: the switcher trigger, prefix included.
  const label = page
    .getByRole("banner")
    .getByRole("button", { name: /^Kampagne: / });
  /** aria-current marks the one of the three that IS the current view. */
  const current = nav.locator("[aria-current='page']");

  /**
   * The whole left block of the topbar, as text and as geometry. EVERY
   * campaign-scoped view must agree on every bit of it except which entry is
   * marked: the chrome is global and stable, the trio is a persistent section
   * nav, and no view brings a breadcrumb of its own any more (PO rework of
   * PR #35). So nothing appears, disappears or shifts while navigating.
   */
  const leftBlock = async () => ({
    campaign: await label.textContent(),
    nav: await nav.textContent(),
    switcherBox: await label.boundingBox(),
    linkBoxes: await Promise.all(
      ["Kapitel", "NPCs", "Orte"].map((name) =>
        nav.getByRole("link", { name }).boundingBox(),
      ),
    ),
  });

  /** The campaign name belongs to the switcher — and to nothing else up there. */
  const assertChromeIsStable = async (
    onPool: Awaited<ReturnType<typeof leftBlock>>,
  ) => {
    expect(await leftBlock()).toEqual(onPool);
    await expect(
      page.getByRole("banner").getByText(/Der Leuchtturm von Salzhafen/),
    ).toHaveCount(1);
  };

  await page.goto("/beispiel");
  await expect(label).toHaveAccessibleName(CAMPAIGN_LABEL);
  await expect(nav.getByRole("link")).toHaveText(["Kapitel", "NPCs", "Orte"]);
  // The pool marks its own entry.
  await expect(current).toHaveText("Kapitel");
  const onPool = await leftBlock();
  await expect(
    page.getByRole("banner").getByText(/Der Leuchtturm von Salzhafen/),
  ).toHaveCount(1);

  // The pool's own "NPCs · Orte" footer line (issue #26) is gone — the topbar
  // is the only place that navigation lives now (issue #34).
  await expect(
    page.getByRole("main").getByRole("link", { name: "NPCs" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("main").getByRole("link", { name: "Orte" }),
  ).toHaveCount(0);

  await nav.getByRole("link", { name: "Orte" }).click();
  await expect(page).toHaveURL(/\/beispiel\/list\/locations$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Orte");
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: /Der Leuchtturm von Salzhafen/ }),
  ).toBeVisible();
  await expect(current).toHaveText("Orte");
  await assertChromeIsStable(onPool);
  // No list-title crumb behind the switcher — "Orte" appears in the banner
  // exactly once, in the nav.
  await expect(
    page.getByRole("banner").getByText("Orte", { exact: true }),
  ).toHaveCount(1);

  await nav.getByRole("link", { name: "NPCs" }).click();
  await expect(page).toHaveURL(/\/beispiel\/list\/npcs$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("NPCs");
  await expect(current).toHaveText("NPCs");
  await assertChromeIsStable(onPool);

  // --- file views: same chrome, section marking follows the entity ----------
  // A scene belongs to Kapitel; its hierarchy lives in the page's context
  // line, not in the topbar.
  await page.goto("/beispiel/file/01-salzhafen/hafen/lighthouse-arrival");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ankunft am Leuchtturm",
  );
  await expect(current).toHaveText("Kapitel");
  await assertChromeIsStable(onPool);

  // An NPC belongs to NPCs — whichever chapter happens to mention it. The old
  // breadcrumb claimed a chapter path here, which was plain misleading for an
  // NPC opened from the NPC list.
  await page.goto("/beispiel/file/npcs/fenn");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fenn");
  await expect(current).toHaveText("NPCs");
  await assertChromeIsStable(onPool);
  // Its context line points at the list it came from.
  await expect(
    page
      .getByRole("navigation", { name: "Kontext" })
      .getByRole("link", { name: "NPCs" }),
  ).toBeVisible();

  // Views that belong to no section mark nothing at all.
  await page.goto("/beispiel/generate");
  await expect(current).toHaveCount(0);
  await assertChromeIsStable(onPool);
  await page.goto("/beispiel/review");
  await expect(current).toHaveCount(0);
  await assertChromeIsStable(onPool);

  // "Kapitel" is the way back to the pool — the reason the trio exists.
  await nav.getByRole("link", { name: "Kapitel" }).click();
  await expect(page).toHaveURL(/\/beispiel$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );
  await expect(current).toHaveText("Kapitel");
  await assertChromeIsStable(onPool);

  // The switcher still switches, from a list as well.
  await nav.getByRole("link", { name: "Orte" }).click();
  await label.click();
  await page
    .getByRole("menuitem", { name: /Der Leuchtturm von Salzhafen/ })
    .click();
  await expect(page).toHaveURL(/\/beispiel$/);
});

/**
 * The gear is part of the global chrome, so it must not undress the bar it
 * sits on (PO feedback on PR #83). `/settings` used to count as a campaign-LESS
 * route, which left the topbar with the wordmark alone: switcher, nav trio,
 * search and session chip all vanished the moment the DM pressed the gear —
 * exactly the "nothing appears or disappears between views" rule the chrome
 * exists for (components/Topbar.tsx). So this is the stability check of the
 * trio test above, run across the one route that is not campaign-scoped: the
 * left block and the session chip have to come out BYTE-EQUAL, and the only
 * difference is the gear marking itself as the current view.
 */
test.describe("with a session running since 19:30, pressing the gear", () => {
  test.use({
    seed: { files: { [RUNNING_SESSION.path]: RUNNING_SESSION.content } },
  });

  test("keeps the whole chrome where it was", async ({ page }) => {
    const banner = page.getByRole("banner");
    const nav = banner.getByRole("navigation", {
      name: "Kapitel, NPCs und Orte",
    });
    const label = banner.getByRole("button", { name: /^Kampagne: / });
    const gear = banner.getByRole("link", { name: "Einstellungen" });
    const chip = banner.locator("[data-session-chip]");

    /**
     * Everything the chrome is made of: the switcher's label and box, the
     * trio's labels, boxes and marking, the search chip, and the session
     * chip's STATE and box. The chip's elapsed readout is deliberately not
     * compared — it ticks; its state and geometry must not. The section
     * MARKING is not in here either: it is the one thing that is allowed to
     * differ between views, and `/settings` belongs to no section (the gear
     * marks itself instead).
     */
    const chrome = async () => ({
      campaign: await label.textContent(),
      switcherBox: await label.boundingBox(),
      navLabels: await nav.getByRole("link").allTextContents(),
      navBoxes: await Promise.all(
        ["Kapitel", "NPCs", "Orte"].map((name) =>
          nav.getByRole("link", { name }).boundingBox(),
        ),
      ),
      searchBox: await banner
        .getByRole("button", { name: /Suche/ })
        .boundingBox(),
      session: await chip.getAttribute("data-session-chip"),
      sessionBox: await chip.boundingBox(),
      gearBox: await gear.boundingBox(),
    });

    await page.goto("/beispiel/list/npcs");
    await expect(label).toHaveAccessibleName(
      "Kampagne: Der Leuchtturm von Salzhafen",
    );
    await expect(chip).toHaveAttribute("data-session-chip", "running");
    await expect(nav.locator("[aria-current='page']")).toHaveText("NPCs");
    // On a list route the gear is just an entry, not the current view.
    await expect(gear).not.toHaveAttribute("aria-current", "page");
    const before = await chrome();

    await gear.click();
    await expect(page).toHaveURL(/\/settings\?from=beispiel$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Einstellungen",
    );

    // Nothing moved, nothing vanished, nothing appeared.
    expect(await chrome()).toEqual(before);
    // The one thing that DID change: the gear is the current view now, and
    // the trio marks nothing — `/settings` is no section of the campaign.
    await expect(gear).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current='page']")).toHaveCount(0);
    // The campaign name is still up there exactly once — in the switcher.
    await expect(banner.getByText(/Der Leuchtturm von Salzhafen/)).toHaveCount(
      1,
    );
    // And the chip is still the running session's, so the live clock the
    // version poll keeps fresh is reachable from here as well.
    await chip.click();
    await expect(page).toHaveURL(/\/beispiel\/live$/);
  });
});

/**
 * Issue #50: the topbar must not overflow at ANY width from 390px up. The
 * medium widths were the broken ones — switcher, live pill, timer, Pause,
 * verwerfen, beenden, search and Generator in one 56px row simply ran over.
 * With the session consolidated into ONE chip (PO feedback on issue #40) the
 * row fits; this test is the guard that keeps it fitting.
 */
test.describe("with a session running since 19:30", () => {
  test.use({
    seed: { files: { [RUNNING_SESSION.path]: RUNNING_SESSION.content } },
  });

  test("the topbar does not overflow at medium widths while a session runs", async ({
    page,
  }) => {
    for (const width of TOPBAR_WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/beispiel");
      await expect(
        page.getByRole("link", { name: /Session läuft/ }),
      ).toBeVisible();
      // The gear (issue #69) is on the row at every width the topbar IS the
      // chrome at — icon-only on purpose, so it cannot grow the row. Below md
      // the whole topbar is hidden (the mobile start surface replaces it), so
      // there is nothing to be visible there.
      if (width >= 768) {
        await expect(
          page.getByRole("link", { name: "Einstellungen" }),
        ).toBeVisible();
      }
      expect(await topbarOverflow(page), `pool at ${width}px`).toEqual({
        row: 0,
        page: 0,
      });
      await widenGlyphs(page, "1px");
      expect(
        await topbarOverflow(page),
        `pool at ${width}px with wider glyphs`,
      ).toEqual({ row: 0, page: 0 });

      // …and the live route, whose chip is the menu trigger — from md up,
      // where the topbar IS the chrome; below that the mobile row's link chip
      // is the one on screen.
      await page.goto("/beispiel/live");
      await expect(
        width >= 768
          ? page.getByRole("button", { name: /Session läuft/ })
          : page.getByRole("link", { name: /Session läuft/ }),
      ).toBeVisible();
      expect(await topbarOverflow(page), `live at ${width}px`).toEqual({
        row: 0,
        page: 0,
      });
      await widenGlyphs(page, "1px");
      expect(
        await topbarOverflow(page),
        `live at ${width}px with wider glyphs`,
      ).toEqual({ row: 0, page: 0 });
    }
  });
});

/**
 * The FULLEST row there is — and the one the guard above never saw: with NO
 * session running the chip carries the long "Session starten" label instead
 * of the clock, and the example campaign's last session leaves the
 * "Nachbereitung · N offen" link on the row next to generator and gear
 * (issue #69 CI finding: at 768 and at 1024 that row overflowed by 41 and
 * 10px in plain macOS rendering, invisible to the old scrollWidth metric).
 */
test("the topbar does not overflow at medium widths with no session running", async ({
  page,
}) => {
  for (const width of TOPBAR_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/beispiel");
    if (width >= 768) {
      await expect(
        page.getByRole("button", { name: "Session starten" }),
      ).toBeVisible();
      // The review link is part of THIS row on purpose — it is the widest
      // optional element, and the reason the row ran over.
      await expect(
        page.getByRole("link", { name: /Nachbereitung/ }),
      ).toBeVisible();
    }
    expect(await topbarOverflow(page), `pool at ${width}px`).toEqual({
      row: 0,
      page: 0,
    });
    await widenGlyphs(page, "1px");
    expect(
      await topbarOverflow(page),
      `pool at ${width}px with wider glyphs`,
    ).toEqual({ row: 0, page: 0 });
  }
});

test("editing the campaign metadata updates header, switcher and the file", async ({
  page,
  api,
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

  await dialog
    .getByLabel("Name", { exact: true })
    .fill("Salzhafen, zweite Fassung");
  await dialog
    .getByLabel("Beschreibung")
    .fill("Jetzt mit mehr Schmuggel und weniger Möwen.");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Pool header, subtitle …
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Salzhafen, zweite Fassung",
  );
  await expect(
    page.getByText("Jetzt mit mehr Schmuggel und weniger Möwen."),
  ).toBeVisible();
  // … and the switcher label, which reads the campaign list.
  await expect(
    page.getByRole("button", { name: "Kampagne: Salzhafen, zweite Fassung" }),
  ).toBeVisible();

  // On disk: the properties changed, the body did not.
  const raw = await api.raw("_campaign");
  expect(raw).toContain("name: Salzhafen, zweite Fassung");
  expect(raw).toContain(
    "description: Jetzt mit mehr Schmuggel und weniger Möwen.",
  );
  expect(raw).toContain("Kampagnenweite Notizen:");
  expect(raw).not.toContain("Eine Küstenkampagne");
});

test.describe("imported without a _campaign", () => {
  test.use({ seed: { remove: ["_campaign"] } });

  test("a campaign imported without _campaign still names itself and is editable", async ({
    page,
    api,
  }) => {
    // Before the cutover this was the one gap PATCH /properties could not
    // close (no file, hence no rev) and the dialog offered to CREATE the
    // file. Since issue #57 the import gives every campaign directory a row,
    // whose name falls back to the id — so there is nothing to create, and the
    // ordinary patch path covers this case too.
    await page.goto("/beispiel");
    // Without metadata the header degrades to the directory name.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "beispiel",
    );
    const imported = await api.file("_campaign");
    expect(imported.properties).toEqual({ id: "beispiel", name: "beispiel" });
    expect(imported.body).toBe("");

    await page.getByRole("button", { name: "Bearbeiten" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Kampagne bearbeiten");
    await expect(dialog.getByLabel("Beschreibung")).toHaveValue("");

    await dialog.getByLabel("Name", { exact: true }).fill("Salzhafen von vorn");
    await dialog
      .getByLabel("Beschreibung")
      .fill("Frisch angelegt aus der App.");
    await dialog.getByRole("button", { name: "Speichern" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Salzhafen von vorn",
    );
    // The id stays the DIRECTORY name — the server sets it, never the client.
    const raw = await api.raw("_campaign");
    expect(raw).toContain("id: beispiel");
    expect(raw).toContain("name: Salzhafen von vorn");
    expect(raw).toContain("description: Frisch angelegt aus der App.");
  });
});

test("the campaign reading view carries the same edit action", async ({
  page,
  api,
}) => {
  await page.goto("/beispiel/file/_campaign");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );

  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Aus der Leseansicht");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Aus der Leseansicht",
  );
  await expect
    .poll(() => api.raw("_campaign"))
    .toContain("name: Aus der Leseansicht");
});
// The dialog's 409 path is the SAME write flow as the status control's
// (lib/campaign-meta.ts mirrors lib/scene-status.ts: conflict -> inline
// "Inzwischen geändert — neu laden" + refetch, nothing written). Critical
// path 7 covers that mechanism against the real server; the dialog's own
// branch is unit-tested in app/src/lib/campaign-meta.test.ts. Reproducing it
// here would need the same "beat the 5s version poll" loop — and a retry that
// closes the dialog on success, which makes the loop unrepeatable.
