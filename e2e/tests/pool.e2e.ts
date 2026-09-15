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

import { THREE_SCENES, TRIGGER } from "../fixtures/replies";
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

/**
 * A scene that names NO location — it belongs under the pool's neutral
 * „Ohne Ort" section (issue #100). The example campaign has none, so the
 * test that needs one seeds it.
 */
const SCENE_WITHOUT_LOCATION = `---
id: ohne-ort-szene
title: Irgendwo unterwegs
type: planned
chapter: 01-salzhafen
npcs: []
handouts: []
tags: [travel]
status: draft
---

## Flow

Die Gruppe ist auf der Straße, der Ort steht noch nicht fest.
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

  // The chapter accordion: title, "Aktiv" pill, scene count, goal line.
  const chapter = page.getByRole("button", {
    name: /Kapitel 1: Der Leuchtturm von Salzhafen/,
  });
  await expect(chapter).toBeVisible();
  // The chapter is a HEADING inside that trigger (issue #100 review): the
  // outline used to jump from the pool's h1 straight to the group h3s.
  await expect(
    chapter.getByRole("heading", { level: 2, name: "Kapitel 1: Der Leuchtturm von Salzhafen" }),
  ).toBeVisible();
  await expect(chapter).toContainText("Aktiv");
  await expect(chapter).toContainText("2 Szenen");
  // Open by default (status: active) — the goal comes from _chapter.
  await expect(
    page.getByText(
      "Ziel: Herausfinden, warum das Leuchtfeuer seit drei Nächten erloschen ist.",
    ),
  ).toBeVisible();

  // Planned scene in its location group, with the status control's label.
  // The group IS the scene's `location` since issue #100, so the header is
  // the location's NAME — `hafen`, the group DIRECTORY of the import format,
  // is not a grouping and appears nowhere.
  await expect(
    page.getByRole("heading", { level: 3, name: "Der Leuchtturm von Salzhafen" }),
  ).toBeVisible();
  await expect(page.getByText("hafen", { exact: true })).toHaveCount(0);
  const planned = page.getByRole("link", { name: /Ankunft am Leuchtturm/ });
  await expect(planned).toBeVisible();
  await expect(planned).toContainText(
    "Leuchtturm von Salzhafen · #social #travel",
  );
  await expect(
    page.getByRole("button", { name: "Status ändern, aktuell Bereit" }).first(),
  ).toBeVisible();

  // Contingencies live in their own group — a section of the chapter, so the
  // same heading level as a location group.
  await expect(page.getByRole("heading", { level: 3, name: "Eventualszenen" })).toBeVisible();
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
    /\/beispiel\/file\/01-salzhafen\/leuchtturm\/lighthouse-arrival$/,
  );
});

test.describe("a scene without a location", () => {
  test.use({
    seed: { files: { "01-salzhafen/ohne-ort": SCENE_WITHOUT_LOCATION } },
  });

  test('scenes that name no location get the neutral „Ohne Ort" section', async ({ page }) => {
    await page.goto("/beispiel");
    // A section, not a location with a blank name — and it comes LAST, after
    // every real location of the chapter. („Eventualszenen" is a section of
    // the chapter too and follows the location groups.)
    const headings = page.getByRole("heading", { level: 3 });
    await expect(headings).toHaveText([
      "Der Leuchtturm von Salzhafen",
      "Ohne Ort",
      "Eventualszenen",
    ]);
    const scene = page.getByRole("link", { name: /Irgendwo unterwegs/ });
    await expect(scene).toBeVisible();
    // …and the scene sits at chapter level, address included.
    await expect(scene).toHaveAttribute("href", "/beispiel/file/01-salzhafen/ohne-ort-szene");
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

  // The pool carries a „Nachschlagen" line again (issue #53, PO feedback on
  // PR #87) — it is where the two campaign-content pages are reached from on
  // the desktop. What matters HERE is that they did not move into the TOPBAR:
  // the trio above is still exactly Kapitel/NPCs/Orte, which is what the rest
  // of this test measures.
  await expect(
    page.getByRole("navigation", { name: "Nachschlagen" }).getByRole("link"),
  ).toHaveText(["NPCs", "Orte", "Glossar", "Kampagnenwissen"]);

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
  await page.goto("/beispiel/file/01-salzhafen/leuchtturm/lighthouse-arrival");
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

/**
 * The generator chip's fullest state (issue #102): a pipelined run that is
 * still going AND has parts the DM already accepted — so the chip carries its
 * pulsing dot and the „N von M übernommen" progress at the same time. That
 * pair was never on the row before this ticket (a run was either running or
 * reviewable, never both), so the guard above never saw it.
 */
test("the topbar does not overflow while a pipelined run fills up", async ({
  page,
  api,
}) => {
  // A run with three scenes whose LAST reply is held: two parts land, the
  // third keeps the run `running` for as long as this test needs it.
  const started = await api.send<{ jobId: string }>("POST", "beispiel/generate", {
    chapter: "01-salzhafen",
    sourceText: [
      "The party watches the quay at low tide.",
      TRIGGER.threeScenes,
      TRIGGER.slowPart,
    ].join("\n\n"),
  });
  interface JobShape {
    rev: number;
    status: string;
    pipeline?: { parts: Array<{ status: string }> };
  }
  const job = async (): Promise<JobShape> =>
    (await api.fetch("beispiel/generate/job").then((r) => r.json())) as JobShape;
  const deadline = Date.now() + 30_000;
  for (;;) {
    const current = await job();
    if ((current.pipeline?.parts ?? []).filter((part) => part.status === "done").length >= 2) break;
    if (Date.now() > deadline) throw new Error("no part of the run ever finished");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Accepting one part while the run is still running is what fills
  // `review.written` — and it is the endpoint half of AK2.
  const current = await job();
  expect(current.status).toBe("running");
  await api.send("POST", `beispiel/generate/job/${started.jobId}/accept`, {
    rev: current.rev,
    paths: [`01-salzhafen/${THREE_SCENES[0].id}`],
  });

  for (const width of TOPBAR_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/beispiel");
    // Below md the topbar is hidden (the mobile start surface is the chrome
    // there), so the chip is only on the row from 768 up.
    if (width >= 768) {
      const chip = page.getByRole("link", { name: /Generator/ });
      await expect(chip).toBeVisible();
      // The number is on the chip exactly ONCE, whatever the width does with
      // it (issue #102 review): above 2xl it is spelled out, below it stands
      // in the accessible name only — never both, which read as „1 von 3
      // übernommen / 1 von 3 übernommen".
      const text = await chip.innerText();
      expect(
        text.match(/übernommen/g)?.length ?? 0,
        `chip text at ${width}px: ${JSON.stringify(text)}`,
      ).toBe(1);
      // And it counts against the PARTS OF THE RUN, not against the parts
      // that happen to have answered already: one of three, next to „2 von 3
      // Szenen fertig" on the generator page.
      expect(text).toContain("1 von 3 übernommen");
    }
    expect(await topbarOverflow(page), `pool at ${width}px`).toEqual({ row: 0, page: 0 });
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

  // Stored: the properties changed, the text did not.
  const campaign = await api.file("_campaign");
  expect(campaign.properties.name).toBe("Salzhafen, zweite Fassung");
  expect(campaign.properties.description).toBe("Jetzt mit mehr Schmuggel und weniger Möwen.");
  expect(campaign.body).toContain("Kampagnenweite Notizen:");
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
    const campaign = await api.properties("_campaign");
    expect(campaign.id).toBe("beispiel");
    expect(campaign.name).toBe("Salzhafen von vorn");
    expect(campaign.description).toBe("Frisch angelegt aus der App.");
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
  await expect.poll(() => api.properties("_campaign")).toHaveProperty("name", "Aus der Leseansicht");
});
// The dialog's 409 path is the SAME write flow as the status control's
// (lib/campaign-meta.ts mirrors lib/scene-status.ts: conflict -> inline
// "Inzwischen geändert — neu laden" + refetch, nothing written). Critical
// path 7 covers that mechanism against the real server; the dialog's own
// branch is unit-tested in app/src/lib/campaign-meta.test.ts. Reproducing it
// here would need the same "beat the 5s version poll" loop — and a retry that
// closes the dialog on success, which makes the loop unrepeatable.

test("the pool header is ONE row: the actions right beside the title, never under it", async ({
  page,
}) => {
  // Issue #56 put „Kapitel anlegen" next to „Bearbeiten" inside a wrapping
  // row, and on a campaign with a normal-length name the pair dropped onto a
  // second line, right-aligned under the title (PO finding on PR #87). The
  // actions share the title's line again — checked at the widths a desktop
  // pool is actually read at, and by geometry rather than by class names.
  for (const width of [1024, 1280, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/beispiel");
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveText("Der Leuchtturm von Salzhafen");
    const counter = page.getByText(/\d+ Kapitel · \d+ Szenen/);
    const create = page.getByRole("button", { name: "Kapitel anlegen" });
    const edit = page.getByRole("button", { name: "Bearbeiten" });
    const description = page.getByText("Eine Küstenkampagne um einen erloschenen", {
      exact: false,
    });

    const [titleBox, counterBox, createBox, editBox, descriptionBox] = await Promise.all(
      [title, counter, create, edit, description].map(
        async (locator) => (await locator.boundingBox())!,
      ),
    );

    // SAME LINE as the title: the boxes overlap vertically. („Same y" cannot
    // be literal — the heading is 28px and the quiet actions are 26px on its
    // baseline; a wrapped row puts them a whole row apart instead.)
    for (const box of [createBox!, editBox!]) {
      expect(box.y).toBeLessThan(titleBox!.y + titleBox!.height);
      expect(box.y + box.height).toBeGreaterThan(titleBox!.y);
      // …and hard right, past everything on the left.
      expect(box.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
    }
    expect(editBox!.x).toBeGreaterThan(createBox!.x);

    // The counter is LEFT, flush with the title (on its line when the name
    // leaves room, directly under it when it does not — never right-aligned
    // and never below the description).
    expect(counterBox!.x).toBe(titleBox!.x);
    expect(counterBox!.y).toBeLessThan(descriptionBox!.y);

    // Description, then the „Nachschlagen" line (issue #53) — in that order.
    const lookupBox = (await page
      .getByRole("navigation", { name: "Nachschlagen" })
      .boundingBox())!;
    expect(descriptionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
    expect(lookupBox.y).toBeGreaterThan(descriptionBox!.y);
  }
});
