// Critical path 1: auto entry — the chapter overview loads the campaign; see CLAUDE.md.
//
// "/" has no page of its own: it redirects into the campaign the
// server reports, and the chapter overview is the first thing the DM sees — campaign
// header, the active chapter with its goal line, the location group and the
// contingency block.
//
// The campaign chrome lives on this path as well: the group header resolves its slug
// against the locations, the topbar carries the NPCs/Orte navigation (the
// chapter overview's own footer line is gone), and the campaign's name/description are
// editable from the header.

import type { Page } from "@playwright/test";

import { THREE_SCENES, TRIGGER } from "../fixtures/replies";
import { expect, test, todaySessionId, type SeedEntry } from "../support/test";

/**
 * How far the topbar's content sticks out of the row, in pixels (0 = it fits).
 *
 * Measured as "right edge of the rightmost child vs. the row's CONTENT edge",
 * not as `header.scrollWidth - header.clientWidth`:
 * an overflowing flex item first eats the row's 24px right padding, and
 * `scrollWidth` does not grow for that at all — that metric reports a
 * clean row while the session chip is already 10px past the padding and,
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
 * have. Linux CI renders every label ~2px wider than macOS does, which is
 * enough to overflow the row on CI alone. `letter-spacing`
 * on the row reproduces that class of difference locally and scales it, so
 * the guard below asserts that the row survives 1px of it: far more than the
 * ~0.6px equivalent of that delta, at every width.
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
 * A scene that names NO location — it belongs under the chapter overview's
 * neutral no-location section. The example campaign has none, so the
 * test that needs one seeds it.
 */
const SCENE_WITHOUT_LOCATION: SeedEntry = {
  kind: "scene",
  properties: {
    id: "ohne-ort-szene",
    title: "Irgendwo unterwegs",
    type: "planned",
    chapter: "01-salzhafen",
    npcs: [],
    handouts: [],
    tags: ["travel"],
    status: "draft",
  },
  body: "\n## Flow\n\nDie Gruppe ist auf der Straße, der Ort steht noch nicht fest.\n",
};

/** Today's session, started at 19:30 and never ended. */
const RUNNING_SESSION: SeedEntry = {
  kind: "session",
  properties: { id: todaySessionId(), started: `${todaySessionId()}T19:30`, scenes_played: [] },
  log: [],
  body: "",
};

/**
 * A campaign entry with nothing but its id — the stem REPLACES the example
 * campaign's own entry, so the header has no name to show.
 */
const NAMELESS_CAMPAIGN: SeedEntry = {
  kind: "campaign",
  properties: { id: "beispiel" },
  body: "",
};

test('"/" redirects into the campaign and the chapter overview shows chapter and scenes', async ({
  page,
}) => {
  await page.goto("/");

  // The redirect target comes from the server (lastSession per campaign).
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);

  // Campaign header from the campaign entry.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );
  await expect(page.getByText("1 Kapitel · 2 Szenen")).toBeVisible();
  await expect(
    page.getByText("Eine Küstenkampagne um einen erloschenen Leuchtturm", {
      exact: false,
    }),
  ).toBeVisible();

  // The chapter accordion: title, scene count, goal line — and the status
  // control BESIDE the trigger (a menu trigger cannot sit inside the
  // accordion button).
  const chapter = page.getByRole("button", {
    name: /Kapitel 1: Der Leuchtturm von Salzhafen/,
  });
  await expect(chapter).toBeVisible();
  // The chapter is a HEADING inside that trigger, so the outline does not
  // jump from the chapter overview's h1 straight to the group h3s.
  await expect(
    chapter.getByRole("heading", { level: 2, name: "Kapitel 1: Der Leuchtturm von Salzhafen" }),
  ).toBeVisible();
  await expect(chapter).toContainText("2 Szenen");
  // The status is the localized label, and it is the control.
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Aktiv" })).toContainText(
    "Aktiv",
  );
  // Open by default (status: active) — the goal comes from the chapter entry.
  await expect(
    page.getByText(
      "Ziel: Herausfinden, warum das Leuchtfeuer seit drei Nächten erloschen ist.",
    ),
  ).toBeVisible();

  // Planned scene in its location group, with the status control's label.
  // The group IS the scene's `location`, so the header is the location's
  // NAME; a bare slug like `hafen` is no grouping and appears nowhere.
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

  // Opening a row is the chapter overview's job — the reading view takes over from here.
  await planned.click();
  await expect(page).toHaveURL(
    /\/campaigns\/beispiel\/entries\/01-salzhafen\/leuchtturm\/lighthouse-arrival$/,
  );
});

test.describe("a scene without a location", () => {
  test.use({
    seed: { entries: { "scene-ohne-ort": SCENE_WITHOUT_LOCATION } },
  });

  test('scenes that name no location get the neutral „Ohne Ort" section', async ({ page }) => {
    await page.goto("/campaigns/beispiel");
    // A section, not a location with a blank name — and it comes LAST, after
    // every real location of the chapter. (The contingency-scenes section
    // belongs to the chapter too and follows the location groups.)
    const headings = page.getByRole("heading", { level: 3 });
    await expect(headings).toHaveText([
      "Der Leuchtturm von Salzhafen",
      "Ohne Ort",
      "Eventualszenen",
    ]);
    const scene = page.getByRole("link", { name: /Irgendwo unterwegs/ });
    await expect(scene).toBeVisible();
    // …and the scene sits at chapter level, address included.
    await expect(scene).toHaveAttribute("href", "/campaigns/beispiel/entries/01-salzhafen/ohne-ort-szene");
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
   * nav, and no view brings a breadcrumb of its own. So nothing appears,
   * disappears or shifts while navigating.
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
    onChapterOverview: Awaited<ReturnType<typeof leftBlock>>,
  ) => {
    expect(await leftBlock()).toEqual(onChapterOverview);
    await expect(
      page.getByRole("banner").getByText(/Der Leuchtturm von Salzhafen/),
    ).toHaveCount(1);
  };

  await page.goto("/campaigns/beispiel");
  await expect(label).toHaveAccessibleName(CAMPAIGN_LABEL);
  await expect(nav.getByRole("link")).toHaveText(["Kapitel", "NPCs", "Orte"]);
  // The chapter overview marks its own entry.
  await expect(current).toHaveText("Kapitel");
  const onChapterOverview = await leftBlock();
  await expect(
    page.getByRole("banner").getByText(/Der Leuchtturm von Salzhafen/),
  ).toHaveCount(1);

  // The chapter overview carries a lookup line — it is where the two
  // campaign-content pages are reached from on
  // the desktop. What matters HERE is that they are not in the TOPBAR:
  // the trio above is still exactly chapters/NPCs/locations, which is what the
  // rest of this test measures.
  await expect(
    page.getByRole("navigation", { name: "Nachschlagen" }).getByRole("link"),
  ).toHaveText(["NPCs", "Orte", "Glossar", "Kampagnenwissen"]);

  await nav.getByRole("link", { name: "Orte" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/list\/locations$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Orte");
  // Both example Orte sit in the same chapter and each row names that chapter
  // under the Ort, so the name is anchored: the row STARTS with the Ort's own
  // name, where the other one only mentions it as its chapter.
  await expect(
    page.getByRole("main").getByRole("link", { name: /^Der Leuchtturm von Salzhafen/ }),
  ).toBeVisible();
  await expect(current).toHaveText("Orte");
  await assertChromeIsStable(onChapterOverview);
  // No list-title crumb behind the switcher — "Orte" appears in the banner
  // exactly once, in the nav.
  await expect(
    page.getByRole("banner").getByText("Orte", { exact: true }),
  ).toHaveCount(1);

  await nav.getByRole("link", { name: "NPCs" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/list\/npcs$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("NPCs");
  await expect(current).toHaveText("NPCs");
  await assertChromeIsStable(onChapterOverview);

  // --- entry views: same chrome, section marking follows the entity ---------
  // A scene belongs to the chapters section; its hierarchy lives in the page's
  // context line, not in the topbar.
  await page.goto("/campaigns/beispiel/entries/01-salzhafen/leuchtturm/lighthouse-arrival");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ankunft am Leuchtturm",
  );
  await expect(current).toHaveText("Kapitel");
  await assertChromeIsStable(onChapterOverview);

  // An NPC belongs to NPCs — whichever chapter happens to mention it. A
  // breadcrumb claiming a chapter path here would be plain misleading for an
  // NPC opened from the NPC list.
  await page.goto("/campaigns/beispiel/entries/npcs/fenn");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fenn");
  await expect(current).toHaveText("NPCs");
  await assertChromeIsStable(onChapterOverview);
  // Its context line points at the list it came from.
  await expect(
    page
      .getByRole("navigation", { name: "Kontext" })
      .getByRole("link", { name: "NPCs" }),
  ).toBeVisible();

  // Views that belong to no section mark nothing at all.
  await page.goto("/campaigns/beispiel/generate");
  await expect(current).toHaveCount(0);
  await assertChromeIsStable(onChapterOverview);
  await page.goto("/campaigns/beispiel/review");
  await expect(current).toHaveCount(0);
  await assertChromeIsStable(onChapterOverview);

  // The chapters link is the way back to the chapter overview — the reason the
  // trio exists.
  await nav.getByRole("link", { name: "Kapitel" }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Der Leuchtturm von Salzhafen",
  );
  await expect(current).toHaveText("Kapitel");
  await assertChromeIsStable(onChapterOverview);

  // The switcher still switches, from a list as well.
  await nav.getByRole("link", { name: "Orte" }).click();
  await label.click();
  await page
    .getByRole("menuitem", { name: /Der Leuchtturm von Salzhafen/ })
    .click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
});

/**
 * The gear is part of the global chrome, so it must not undress the bar it
 * sits on. Counting `/settings` as a campaign-LESS route would leave the
 * topbar with the wordmark alone: switcher, nav trio, search and session chip
 * gone the moment the DM presses the gear — against the "nothing appears or
 * disappears between views" rule the chrome
 * exists for (components/Topbar.tsx). So this is the stability check of the
 * trio test above, run across the one route that is not campaign-scoped: the
 * left block and the session chip have to come out BYTE-EQUAL, and the only
 * difference is the gear marking itself as the current view.
 */
test.describe("with a session running since 19:30, pressing the gear", () => {
  test.use({
    seed: { entries: { "session-running": RUNNING_SESSION } },
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

    await page.goto("/campaigns/beispiel/list/npcs");
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
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  });
});

/**
 * The topbar must not overflow at ANY width from 390px up. The medium widths
 * are the tight ones — switcher, live pill, timer, Pause, verwerfen, beenden,
 * search and Generator in one 56px row would run over. With the session
 * consolidated into ONE chip the row fits; this test is the guard that keeps
 * it fitting.
 */
test.describe("with a session running since 19:30", () => {
  test.use({
    seed: { entries: { "session-running": RUNNING_SESSION } },
  });

  test("the topbar does not overflow at medium widths while a session runs", async ({
    page,
  }) => {
    for (const width of TOPBAR_WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/campaigns/beispiel");
      await expect(
        page.getByRole("link", { name: /Session läuft/ }),
      ).toBeVisible();
      // The gear is on the row at every width the topbar IS the
      // chrome at — icon-only on purpose, so it cannot grow the row. Below md
      // the whole topbar is hidden (the mobile start surface replaces it), so
      // there is nothing to be visible there.
      if (width >= 768) {
        await expect(
          page.getByRole("link", { name: "Einstellungen" }),
        ).toBeVisible();
      }
      expect(await topbarOverflow(page), `chapter overview at ${width}px`).toEqual({
        row: 0,
        page: 0,
      });
      await widenGlyphs(page, "1px");
      expect(
        await topbarOverflow(page),
        `chapter overview at ${width}px with wider glyphs`,
      ).toEqual({ row: 0, page: 0 });

      // …and the live route, whose chip is the menu trigger — from md up,
      // where the topbar IS the chrome; below that the mobile row's link chip
      // is the one on screen.
      await page.goto("/campaigns/beispiel/live");
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
 * "Nachbereitung · N offen" link on the row next to generator and gear. At
 * 768 and at 1024 that row is tightest: a regression there overflows by 41
 * and 10px in plain macOS rendering, invisible to a `scrollWidth` metric.
 */
test("the topbar does not overflow at medium widths with no session running", async ({
  page,
}) => {
  for (const width of TOPBAR_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/campaigns/beispiel");
    if (width >= 768) {
      await expect(
        page.getByRole("button", { name: "Session starten" }),
      ).toBeVisible();
      // The review link is part of THIS row on purpose — it is the widest
      // optional element, and the one that runs the row over.
      await expect(
        page.getByRole("link", { name: /Nachbereitung/ }),
      ).toBeVisible();
    }
    expect(await topbarOverflow(page), `chapter overview at ${width}px`).toEqual({
      row: 0,
      page: 0,
    });
    await widenGlyphs(page, "1px");
    expect(
      await topbarOverflow(page),
      `chapter overview at ${width}px with wider glyphs`,
    ).toEqual({ row: 0, page: 0 });
  }
});

/**
 * The generator chip's fullest state: a pipelined run that is
 * still going AND has parts the DM already accepted — so the chip carries its
 * pulsing dot and the accepted-of-total progress at the same time. Only a
 * pipelined run puts that pair on the row — otherwise a run is either running
 * or reviewable, never both — so the guard above never sees it.
 */
test("the topbar does not overflow while a pipelined run fills up", async ({
  page,
  api,
}) => {
  // A run with three scenes whose LAST reply is held: two parts land, the
  // third keeps the run `running` for as long as this test needs it.
  const started = await api.send<{ jobId: string }>("POST", "campaigns/beispiel/generate", {
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
    (await api.fetch("campaigns/beispiel/generate/job").then((r) => r.json())) as JobShape;
  const deadline = Date.now() + 30_000;
  for (;;) {
    const current = await job();
    if ((current.pipeline?.parts ?? []).filter((part) => part.status === "done").length >= 2) break;
    if (Date.now() > deadline) throw new Error("no part of the run ever finished");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Accepting one part while the run is still running is what fills
  // `review.written` — the endpoint half of accepting during a run.
  const current = await job();
  expect(current.status).toBe("running");
  await api.send("POST", `campaigns/beispiel/generate/job/${started.jobId}/accept`, {
    rev: current.rev,
    paths: [`01-salzhafen/${THREE_SCENES[0].id}`],
  });

  for (const width of TOPBAR_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/campaigns/beispiel");
    // Below md the topbar is hidden (the mobile start surface is the chrome
    // there), so the chip is only on the row from 768 up.
    if (width >= 768) {
      const chip = page.getByRole("link", { name: /Generator/ });
      await expect(chip).toBeVisible();
      // The number is on the chip exactly ONCE, whatever the width does with
      // it: above 2xl it is spelled out, below it stands
      // in the accessible name only — never both, which would read as the
      // same progress phrase printed twice.
      const text = await chip.innerText();
      expect(
        text.match(/übernommen/g)?.length ?? 0,
        `chip text at ${width}px: ${JSON.stringify(text)}`,
      ).toBe(1);
      // And it counts against the PARTS OF THE RUN, not against the parts
      // that happen to have answered already: one of three, next to the
      // finished-scenes count on the generator page.
      expect(text).toContain("1 von 3 übernommen");
    }
    expect(await topbarOverflow(page), `chapter overview at ${width}px`).toEqual({ row: 0, page: 0 });
    await widenGlyphs(page, "1px");
    expect(
      await topbarOverflow(page),
      `chapter overview at ${width}px with wider glyphs`,
    ).toEqual({ row: 0, page: 0 });
  }
});

test("editing the campaign metadata updates header, switcher and the file", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");

  // `exact`: a per-chapter edit action stands on the same page, and a
  // role name matches as a substring.
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
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
  // Chapter overview header, subtitle …
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
  const campaign = await api.file("campaign");
  expect(campaign.properties.name).toBe("Salzhafen, zweite Fassung");
  expect(campaign.properties.description).toBe("Jetzt mit mehr Schmuggel und weniger Möwen.");
  expect(campaign.body).toContain("Kampagnenweite Notizen:");
});

test.describe("a campaign without a name", () => {
  test.use({ seed: { entries: { campaign: NAMELESS_CAMPAIGN } } });

  test("a campaign without a name still names itself and is editable", async ({
    page,
    api,
  }) => {
    // The campaign is a row like any other, and its name falls back to its
    // id — so there is nothing to create and the ordinary patch path covers
    // this case too.
    await page.goto("/campaigns/beispiel");
    // Without a name the header degrades to the id.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "beispiel",
    );
    const nameless = await api.file("campaign");
    expect(nameless.properties).toEqual({ id: "beispiel", name: "beispiel" });
    expect(nameless.body).toBe("");

    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
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
    // The id does not move — the server sets it, never the client.
    const campaign = await api.properties("campaign");
    expect(campaign.id).toBe("beispiel");
    expect(campaign.name).toBe("Salzhafen von vorn");
    expect(campaign.description).toBe("Frisch angelegt aus der App.");
  });
});

test("the campaign reading view carries the same edit action", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel/entries/campaign");
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
  await expect.poll(() => api.properties("campaign")).toHaveProperty("name", "Aus der Leseansicht");
});
// The dialog's 409 path is the SAME write flow as the status control's
// (lib/campaign-meta.ts mirrors lib/scene-status.ts: conflict -> the inline
// stale-revision notice + refetch, nothing written). Critical
// path 7 covers that mechanism against the real server; the dialog's own
// branch is unit-tested in app/src/lib/campaign-meta.test.ts. Reproducing it
// here would need the same "beat the 5s version poll" loop — and a retry that
// closes the dialog on success, which makes the loop unrepeatable.

test("the chapter overview header is ONE row: the actions right beside the title, never under it", async ({
  page,
}) => {
  // The create-chapter and edit actions must not sit in a wrapping row: on a
  // campaign with a normal-length name the pair would drop onto a second
  // line, right-aligned under the title. The actions share the title's
  // line — checked at the widths a desktop chapter overview is actually read at, and by
  // geometry rather than by class names.
  for (const width of [1024, 1280, 1536]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/campaigns/beispiel");
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveText("Der Leuchtturm von Salzhafen");
    const counter = page.getByText(/\d+ Kapitel · \d+ Szenen/);
    const create = page.getByRole("button", { name: "Kapitel anlegen" });
    const edit = page.getByRole("button", { name: "Bearbeiten", exact: true });
    const description = page.getByText("Eine Küstenkampagne um einen erloschenen", {
      exact: false,
    });

    const [titleBox, counterBox, createBox, editBox, descriptionBox] = await Promise.all(
      [title, counter, create, edit, description].map(
        async (locator) => (await locator.boundingBox())!,
      ),
    );

    // SAME LINE as the title: the boxes overlap vertically. ("Same y" cannot
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

    // Description, then the lookup line — in that order.
    const lookupBox = (await page
      .getByRole("navigation", { name: "Nachschlagen" })
      .boundingBox())!;
    expect(descriptionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
    expect(lookupBox.y).toBeGreaterThan(descriptionBox!.y);
  }
});

// Critical path 1: a chapter is editable where it is read.
//
// Creating a chapter is not the only moment its title and goal can be
// said: a chapter created without a goal gets one here, and a chapter a
// generator run created under its slug is renamed here — otherwise the
// overview would list a heading nobody can correct. Both halves go through the
// documented endpoints with their rev guard: the title is a PROPERTY (the
// shared properties dialog), the goal is the TEXT.
test("a chapter's title and goal are editable from the chapter overview", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  // The active chapter is open by default, so its actions are on screen.
  const properties = page.getByRole("button", { name: "Kapitel-Eigenschaften" });
  await expect(properties).toBeVisible();

  // --- the title, through the shared properties dialog ---
  await properties.click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Kapitel: Eigenschaften");
  // The form marks a required field in its label, so the accessible name is
  // that whole string.
  const title = dialog.getByRole("textbox", { name: "Titel · nötig" });
  await expect(title).toHaveValue("Kapitel 1: Der Leuchtturm von Salzhafen");
  await title.fill("Kapitel 1: Salzhafen");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The overview heading follows — it reads the tree, which the save
  // invalidated.
  await expect(page.getByRole("heading", { level: 2, name: "Kapitel 1: Salzhafen" })).toBeVisible();

  // --- the goal, through the edit dialog ---
  await page.getByRole("button", { name: "Kapitel bearbeiten" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Kapitel bearbeiten: Kapitel 1: Salzhafen");
  const body = dialog.getByRole("textbox", { name: "Text" });
  await expect(body).toHaveValue(/Ziel des Kapitels/);
  await body.fill("## Ziel des Kapitels\n\nDen Leuchtturm wieder anzünden.");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The overview's goal line reads that section.
  await expect(page.getByText("Ziel: Den Leuchtturm wieder anzünden.")).toBeVisible();
  const stored = await api.file("01-salzhafen");
  expect(stored.properties.title).toBe("Kapitel 1: Salzhafen");
  expect(stored.body).toContain("Den Leuchtturm wieder anzünden.");
});

test("the chapter edit dialog shows the 409 instead of overwriting a second writer", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: "Kapitel bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  const body = dialog.getByRole("textbox", { name: "Text" });
  await expect(body).toHaveValue(/Ziel des Kapitels/);

  // A SECOND WRITER while the dialog stands (there is no "external edit" any
  // more — e2e/README.md): the API writes with a fresh token.
  await api.writeBody("01-salzhafen", "## Ziel des Kapitels\n\nVon der API.\n");

  await body.fill("## Ziel des Kapitels\n\nAus dem Dialog.");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  // Nothing was written, the dialog says so, and the typed text is still
  // there.
  await expect(dialog.getByText("Inzwischen geändert", { exact: false })).toBeVisible();
  await expect(body).toHaveValue("## Ziel des Kapitels\n\nAus dem Dialog.");
  expect((await api.file("01-salzhafen")).body).toContain("Von der API.");

  // The next attempt carries the rev the re-read brought and goes through.
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Ziel: Aus dem Dialog.")).toBeVisible();
});

// The chapter status control (critical path 1). The overview decides which
// chapter the session is in, and the status DISPLAY is that control.
//
// The active value is the interesting one: ONE server call for ONE decision about TWO
// chapters, so there is never a moment with two active chapters. The other two
// are an ordinary properties patch.
test("the chapter status control shows the German labels and swaps the active chapter", async ({
  page,
  api,
}) => {
  // A second chapter to move the flag TO — the example campaign has one.
  const created = await api.send<{ path: string }>("POST", "campaigns/beispiel/chapters", {
    title: "Kapitel 2: Die Bucht",
  });
  const secondPath = created.path;

  await page.goto("/campaigns/beispiel");

  // The active chapter's control names its current value for a screen reader…
  const activeMenu = page.getByRole("button", { name: "Status ändern, aktuell Aktiv" });
  await expect(activeMenu).toBeVisible();
  // …and the label is the localized one, not the wire value.
  await expect(activeMenu).toContainText("Aktiv");
  await expect(activeMenu).not.toContainText("active");

  // The three options, in lifecycle order and in German.
  await activeMenu.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Geplant", "Aktiv", "Abgeschlossen"]);
  await page.keyboard.press("Escape");

  // --- the swap, from the OTHER chapter's control ---
  // From here on every swap call is counted: ONE decision about two chapters
  // is ONE request. A second one bounces the flag straight back to the
  // chapter the DM had just left — the control reads active on both rows for
  // a moment, and re-asserting it for the previously active chapter is a swap
  // of its own.
  const swaps: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/active")) {
      swaps.push(request.url().replace(/^.*\/api\//, ""));
    }
  });

  const second = page.getByRole("button", { name: /Kapitel 2: Die Bucht/ });
  await expect(second).toBeVisible();
  await page.getByRole("button", { name: "Status ändern, aktuell Geplant" }).click();
  await page.getByRole("menuitemradio", { name: "Aktiv" }).click();

  // The flag moved in BOTH directions, in one call.
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Aktiv" })).toHaveCount(1);
  await expect.poll(async () => (await api.file("01-salzhafen")).properties.status).toBe("planned");
  expect((await api.file(secondPath)).properties.status).toBe("active");

  // Exactly ONE call, and it named the chapter the DM picked — no second one
  // from the row that lost the flag.
  expect(swaps).toEqual([`campaigns/beispiel/chapters/${secondPath}/active`]);

  // …and it stays that way with the invalidation and a version poll behind
  // it: the tree shows the second chapter active and the first planned two
  // seconds later, still one call.
  await page.waitForTimeout(2_000);
  expect(swaps).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Aktiv" })).toHaveCount(1);
  await expect(second).toBeVisible();
  // Per CHAPTER row (the control beside its h2) — the scene rows in the open
  // accordion carry controls of their own.
  const rows = await page
    .locator('xpath=//h2/ancestor::div[1]//button[starts-with(@aria-label,"Status ändern")]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(rows).toEqual(["Status ändern, aktuell Geplant", "Status ändern, aktuell Aktiv"]);
  expect((await api.file("01-salzhafen")).properties.status).toBe("planned");
  expect((await api.file(secondPath)).properties.status).toBe("active");
});

// The control is a RADIO group, so the checked option is the state — selecting
// it is nothing to write. Selecting active on the chapter that already holds
// the flag would call the swap endpoint anyway, which is how a stray select on
// the row that was active (its control still reads active until the
// invalidation lands) could take the flag back.
test("re-selecting the value a chapter already has writes nothing", async ({ page, api }) => {
  await api.send("POST", "campaigns/beispiel/chapters", { title: "Kapitel 2: Die Bucht" });

  const writes: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      (request.method() === "POST" || request.method() === "PATCH") &&
      (url.includes("/active") || url.includes("/properties"))
    ) {
      writes.push(`${request.method()} ${url.replace(/^.*\/api\//, "")}`);
    }
  });

  await page.goto("/campaigns/beispiel");
  const activeMenu = page.getByRole("button", { name: "Status ändern, aktuell Aktiv" });
  await activeMenu.click();
  await page.getByRole("menuitemradio", { name: "Aktiv" }).click();
  await page.waitForTimeout(1_000);

  expect(writes).toEqual([]);
  await expect(activeMenu).toBeVisible();
  expect((await api.file("01-salzhafen")).properties.status).toBe("active");
});

// The completed value is the other branch: a rev-guarded properties patch on the
// chapter entry, which must NOT touch the active chapter.
test("picking Abgeschlossen patches that chapter and leaves the active one alone", async ({
  page,
  api,
}) => {
  const created = await api.send<{ path: string }>("POST", "campaigns/beispiel/chapters", {
    title: "Kapitel 2: Die Bucht",
  });

  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: "Status ändern, aktuell Geplant" }).click();
  await page.getByRole("menuitemradio", { name: "Abgeschlossen" }).click();

  await expect(
    page.getByRole("button", { name: "Status ändern, aktuell Abgeschlossen" }),
  ).toBeVisible();
  await expect.poll(async () => (await api.file(created.path)).properties.status).toBe("done");
  // The evening's chapter is untouched.
  expect((await api.file("01-salzhafen")).properties.status).toBe("active");
});

// The dialog is a FORM over the same value, and a form sends its DIFF: a
// status field the DM never touched must not be written, no matter what the
// cache behind the dialog happened to hold when it opened. That is the other
// half of the bounce-back: the app's copy of a chapter entry goes stale the
// moment another writer moves the flag (up to one version poll), and an
// untouched active value in the form would put it back — from a dialog that was
// only opened to fix a title.
test("an untouched status field is not written, not even a stale Aktiv", async ({ page, api }) => {
  const patches: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH") patches.push(request.postData() ?? "");
  });

  await page.goto("/campaigns/beispiel");
  // The active chapter is open by default: its entry is in the app's cache
  // now, with `status: active`.
  const properties = page.getByRole("button", { name: "Kapitel-Eigenschaften" });
  await expect(properties).toBeVisible();

  // Another writer moves the flag. The app does not know yet — the version
  // poll is what tells it, and the dialog opens before that.
  const created = await api.send<{ path: string }>("POST", "campaigns/beispiel/chapters", {
    title: "Kapitel 2: Die Bucht",
    id: "02",
  });
  await api.send("POST", "campaigns/beispiel/chapters/02/active");
  expect((await api.file("01-salzhafen")).properties.status).toBe("planned");

  await properties.click();
  const dialog = page.getByRole("dialog");
  // The scenario, spelled out: the form opened on the STALE value.
  await expect(dialog.getByLabel("Status")).toHaveValue("active");

  // Only the title is touched.
  await dialog.getByLabel("Titel").fill("Kapitel 1: Salzhafen");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  // The other writer moved the chapter entry, so the frozen rev is stale:
  // the first attempt is the 409 of ADR #4, nothing written. The typed title
  // stays and the next attempt writes on top of what is stored — with the
  // status STILL untouched, which is the point of this test.
  await expect(dialog).toContainText("Inzwischen geändert");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The title is written, the status is not even mentioned — and the chapter
  // the other writer activated keeps the flag.
  const stored = await api.file("01-salzhafen");
  expect(stored.properties.title).toBe("Kapitel 1: Salzhafen");
  expect(stored.properties.status).toBe("planned");
  expect((await api.file(created.path)).properties.status).toBe("active");
  // Both attempts sent the title and nothing else — the status field never
  // appears on the wire, so no stale active value can ride along.
  expect(patches).toHaveLength(2);
  for (const body of patches) {
    expect(body).toContain("Kapitel 1: Salzhafen");
    expect(body).not.toContain("status");
  }
});

// The chapter properties dialog is the second door onto the same value — and
// it must not be a way past the one-active rule.
test("the properties dialog offers the enum and its Aktiv swaps too", async ({ page, api }) => {
  const created = await api.send<{ path: string }>("POST", "campaigns/beispiel/chapters", {
    title: "Kapitel 2: Die Bucht",
  });

  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: /Kapitel 2: Die Bucht/ }).click();
  // Two chapters are open now, so the actions are named per chapter — the
  // second one belongs to the second chapter.
  await page.getByRole("button", { name: "Kapitel-Eigenschaften" }).nth(1).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Kapitel: Eigenschaften");

  // A select over the enum, not a free text field.
  const status = dialog.getByLabel("Status");
  await expect(status).toBeVisible();
  await status.selectOption({ label: "Aktiv" });
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The swap happened server-side: exactly one active chapter, and it is this
  // one.
  await expect.poll(async () => (await api.file(created.path)).properties.status).toBe("active");
  await expect.poll(async () => (await api.file("01-salzhafen")).properties.status).toBe("planned");
  await expect(page.getByRole("button", { name: "Status ändern, aktuell Aktiv" })).toHaveCount(1);
});
