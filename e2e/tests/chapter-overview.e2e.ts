// Critical path 1: auto entry — the chapter overview loads the campaign; see CLAUDE.md.
//
// "/" has no page of its own: it redirects into the campaign the
// server reports, and the chapter overview is the first thing the DM sees — campaign
// header with the campaign's text, the active chapter with its text, its
// scenes as ONE list in
// the order the DM arranged (decisions/scene-order) and the contingency block at the end.
//
// The order is the DM's, so it is also editable here: up/down per row, one
// write for the whole chapter, with a guard of its own. That guard is why a
// reorder never collides with an open editor — the two write different things
// (decisions/scene-order), and both halves of that promise are checked below.
//
// The campaign chrome lives on this path as well: a scene row resolves its
// location to the location's NAME, the topbar carries the npc and location
// navigation, and the campaign's name, description and text are editable from
// the header — the campaign's route IS the chapter overview (decisions/resources).

import type { Locator, Page } from "@playwright/test";

import type { CampaignSeed } from "@grimoire/shared/campaign";
import type { SceneProposal } from "@grimoire/shared/scene";
import type { SessionSeed } from "@grimoire/shared/session";
import type { MessageKey } from "../../app/src/i18n/messages";
import { THREE_SCENES, TRIGGER } from "../fixtures/replies";
import { expect, test } from "../support/test";
import type { Api } from "../support/api";
import { getCampaign, patchCampaign } from "../support/campaign";
import { chapterPath, getChapter, patchChapter } from "../support/chapter";
import { getGeneratorJob, patchGeneratorJob, startGeneratorJob } from "../support/generator-job";
import { getScene, patchScene } from "../support/scene";
import { todaySessionId } from "../support/session";
import { ui, uiExact } from "../support/ui";

// Seeded content of the example campaign (fixtures/beispiel) the overview
// shows — data the spec checks for, not UI text.

/** The campaign's name. */
const CAMPAIGN_NAME = "Der Leuchtturm von Salzhafen";
/** The opening of the campaign's description. */
const CAMPAIGN_DESCRIPTION = "Eine Küstenkampagne um einen erloschenen Leuchtturm";
/** The opening of the campaign's text. */
const CAMPAIGN_BODY = "Kampagnenweite Notizen: Ton ist bodenständige";
/** The title of the active chapter `01-salzhafen`. */
const CHAPTER_TITLE = "Kapitel 1: Der Leuchtturm von Salzhafen";
/** The whole text of that chapter. */
const CHAPTER_BODY = "Herausfinden, warum das Leuchtfeuer seit drei Nächten erloschen ist.";
/** The name of the location `leuchtturm`. */
const LIGHTHOUSE = "Der Leuchtturm von Salzhafen";
/** The planned scene `lighthouse-arrival`. */
const ARRIVAL = "Ankunft am Leuchtturm";
/** The contingency scene `smuggler-captured` and its trigger. */
const CAPTURED = "Von den Schmugglern erwischt";
const CAPTURED_TRIGGER = "Charaktere werden beim Auskundschaften der Bucht entdeckt";
/** The names of the npcs `fenn` and `jorna`. */
const FENN = "Fenn";
const JORNA = "Hafenmeisterin Jorna";

/** A catalog text as a regex fragment, special characters escaped. */
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A catalog text as a pattern whose parameters match anything. */
function uiPattern(key: MessageKey, params: Record<string, string>): RegExp {
  const placeholders = Object.fromEntries(
    Object.keys(params).map((name) => [name, `\u0000${name}\u0000`]),
  );
  let source = escapeRe(ui(key, placeholders));
  for (const [name, pattern] of Object.entries(params)) {
    source = source.replace(`\u0000${name}\u0000`, pattern);
  }
  return new RegExp(source);
}

/** The label of a chapter status in the UI. */
const chapterStatus = (status: "planned" | "active" | "done") =>
  ui(`properties.chapter.status.${status}`);

/** The accessible name of a chapter's status control showing that status. */
const chapterStatusName = (status: "planned" | "active" | "done") =>
  ui("status.change.aria", { current: chapterStatus(status) });

/** The accessible name of a scene's status control showing `ready`. */
const READY_STATUS_NAME = ui("status.change.aria", { current: ui("status.scene.ready") });

/** The dialog of a chapter's properties. */
const CHAPTER_PROPERTIES_TITLE = ui("properties.title", { kind: ui("kind.chapter") });

/** The label of a chapter's title field — the form marks it required. */
const CHAPTER_TITLE_LABEL = `${ui("properties.chapter.title.label")}${ui("properties.field.required")}`;

/** The topbar's section nav, in its order. */
const NAV_KEYS = ["topbar.nav.chapters", "topbar.nav.npcs", "topbar.nav.locations"] as const;

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

/** The session chip while a session runs — its name opens with the state, the clock follows. */
const RUNNING_CHIP = new RegExp(escapeRe(ui("session.state.running")));

/**
 * A scene that names NO location — its row simply has no location part
 * (decisions/scene-order). The example campaign has none, so the test that needs one
 * seeds it.
 */
const SCENE_WITHOUT_LOCATION: SceneProposal = {
  id: "no-location-scene",
  title: "Somewhere on the road",
  type: "planned",
  chapter: "01-salzhafen",
  npcs: [],
  handouts: [],
  tags: ["travel"],
  status: "draft",
  body: "\n## Flow\n\nThe party is on the road, the place is not settled yet.\n",
};

/** Today's session, started at 19:30 and never ended. */
const RUNNING_SESSION: SessionSeed = {
  id: todaySessionId(),
  started: `${todaySessionId()}T19:30:00`,
  body: "",
  pauses: [],
  log: [],
};

/**
 * The campaign without a name of its own — a name that equals the id. Its
 * id is the example campaign's, so it REPLACES that campaign, and the header
 * has no name to show.
 */
const NAMELESS_CAMPAIGN: CampaignSeed = {
  id: "beispiel",
  name: "beispiel",
  body: "",
  glossaryIntro: "",
};

test('"/" redirects into the campaign and the chapter overview shows chapter and scenes', async ({
  page,
  api,
}) => {
  await page.goto("/");

  // The redirect target comes from the server (lastSession per campaign).
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);

  // Campaign header from the campaign.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);
  // The counter counts what the tree holds: one chapter, two scenes.
  const tree = await api.get<{ chapters: { scenes: unknown[] }[] }>("campaigns/beispiel/tree");
  expect(tree.chapters.map((chapter) => chapter.scenes.length)).toEqual([2]);
  await expect(
    page.getByText(
      `${ui("chapterOverview.chapterCount", { count: 1 })} · ${ui("chapterOverview.sceneCount", { count: 2 })}`,
    ),
  ).toBeVisible();
  await expect(page.getByText(CAMPAIGN_DESCRIPTION, { exact: false })).toBeVisible();
  // …and under the one-line description the campaign's TEXT, rendered. It is
  // short, so it stands whole and there is nothing to open.
  await expect(page.getByText(CAMPAIGN_BODY, { exact: false })).toBeVisible();

  // The chapter accordion: title, scene count, its text — and the status
  // control BESIDE the trigger (a menu trigger cannot sit inside the
  // accordion button).
  const chapter = page.getByRole("button", { name: new RegExp(escapeRe(CHAPTER_TITLE)) });
  await expect(chapter).toBeVisible();
  // The chapter is a HEADING inside that trigger, so the outline does not
  // jump from the chapter overview's h1 straight to the contingency block.
  await expect(
    chapter.getByRole("heading", { level: 2, name: CHAPTER_TITLE }),
  ).toBeVisible();
  await expect(chapter).toContainText(ui("chapterOverview.sceneCount", { count: 2 }));
  // The status is the localized label, and it is the control.
  await expect(page.getByRole("button", { name: chapterStatusName("active") })).toContainText(
    chapterStatus("active"),
  );
  // Open by default (status: active) — the text is the chapter's, all of it
  // and nothing prefixed, so no show-more toggle either.
  await expect(page.getByText(CHAPTER_BODY, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: ui("common.showMore") })).toHaveCount(0);

  // The planned scene is a ROW of the chapter's one list — no location
  // heading over it (decisions/scene-order). The location stands in the row's meta
  // line, and it stands there with the NAME of its entry: the bare slug
  // `leuchtturm` is no location for the reader and appears nowhere.
  await expect(
    page.getByRole("heading", { level: 3, name: LIGHTHOUSE }),
  ).toHaveCount(0);
  await expect(page.getByText("leuchtturm", { exact: true })).toHaveCount(0);
  const planned = page.getByRole("link", { name: new RegExp(escapeRe(ARRIVAL)) });
  await expect(planned).toBeVisible();
  await expect(planned).toContainText(`${LIGHTHOUSE} · #social #travel`);
  await expect(page.getByRole("button", { name: READY_STATUS_NAME }).first()).toBeVisible();

  // Contingencies stay a block of their own at the end — the one heading the
  // list still has, because it names a section of the chapter.
  await expect(
    page.getByRole("heading", { level: 3, name: ui("scene.contingencies.heading") }),
  ).toBeVisible();
  const contingency = page.getByRole("link", { name: new RegExp(escapeRe(CAPTURED)) });
  await expect(contingency).toBeVisible();
  await expect(contingency).toContainText(
    ui("chapterOverview.scene.trigger", { trigger: CAPTURED_TRIGGER }),
  );

  // Opening a row is the chapter overview's job — the scene's own reading
  // view takes over from here (decisions/resources).
  await planned.click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/scenes\/lighthouse-arrival$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ARRIVAL);
});

test.describe("a scene without a location", () => {
  test.use({
    seed: { scenes: [SCENE_WITHOUT_LOCATION] },
  });

  test("a scene that names no location keeps its row, without a location part", async ({
    page,
  }) => {
    await page.goto("/campaigns/beispiel");
    // No section for it and none for the scenes that DO name a location: the
    // contingency block is the only heading the list has left.
    await expect(page.getByRole("heading", { level: 3 })).toHaveText([
      ui("scene.contingencies.heading"),
    ]);
    const scene = page.getByRole("link", { name: new RegExp(escapeRe(SCENE_WITHOUT_LOCATION.title)) });
    await expect(scene).toBeVisible();
    // The meta line is the tags alone — no placeholder, no dangling separator,
    // while the scene one row above still names its location.
    await expect(scene).toContainText("#travel");
    await expect(scene).not.toContainText("·");
    await expect(page.getByRole("link", { name: new RegExp(escapeRe(ARRIVAL)) })).toContainText(
      `${LIGHTHOUSE} · #social #travel`,
    );
    // …and it opens on its own route like every scene.
    await expect(scene).toHaveAttribute(
      "href",
      `/campaigns/beispiel/scenes/${SCENE_WITHOUT_LOCATION.id}`,
    );
  });
});

test("the topbar trio navigates without anything in the left block moving", async ({
  page,
}) => {
  const CAMPAIGN_LABEL = ui("campaign.switcher.current", { name: CAMPAIGN_NAME });
  const nav = page.getByRole("banner").getByRole("navigation", { name: ui("topbar.nav.aria") });
  // The campaign context: the switcher trigger, prefix included.
  const label = page
    .getByRole("banner")
    .getByRole("button", { name: uiPattern("campaign.switcher.current", { name: ".*" }) });
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
      NAV_KEYS.map((key) => nav.getByRole("link", { name: ui(key) }).boundingBox()),
    ),
  });

  /** The campaign name belongs to the switcher — and to nothing else up there. */
  const assertChromeIsStable = async (
    onChapterOverview: Awaited<ReturnType<typeof leftBlock>>,
  ) => {
    expect(await leftBlock()).toEqual(onChapterOverview);
    await expect(page.getByRole("banner").getByText(CAMPAIGN_NAME)).toHaveCount(1);
  };

  await page.goto("/campaigns/beispiel");
  await expect(label).toHaveAccessibleName(CAMPAIGN_LABEL);
  await expect(nav.getByRole("link")).toHaveText(NAV_KEYS.map((key) => ui(key)));
  // The chapter overview marks its own entry.
  await expect(current).toHaveText(ui("topbar.nav.chapters"));
  const onChapterOverview = await leftBlock();
  await expect(page.getByRole("banner").getByText(CAMPAIGN_NAME)).toHaveCount(1);

  // The chapter overview carries a lookup line — it is where the two
  // campaign-content pages are reached from on
  // the desktop. What matters HERE is that they are not in the TOPBAR:
  // the trio above is still exactly chapters/NPCs/locations, which is what the
  // rest of this test measures.
  await expect(
    page.getByRole("navigation", { name: ui("lookup.heading") }).getByRole("link"),
  ).toHaveText([
    ui("browse.title.npcs"),
    ui("browse.title.locations"),
    ui("glossary.title"),
    ui("knowledge.title"),
  ]);

  await nav.getByRole("link", { name: ui("topbar.nav.locations") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/locations$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("browse.title.locations"));
  // Both example locations sit in the same chapter and each row names that
  // chapter under the location, so the name is anchored: the row STARTS with
  // the location's own name, where the other one only mentions it as its
  // chapter.
  await expect(
    page.getByRole("main").getByRole("link", { name: new RegExp(`^${escapeRe(LIGHTHOUSE)}`) }),
  ).toBeVisible();
  await expect(current).toHaveText(ui("topbar.nav.locations"));
  await assertChromeIsStable(onChapterOverview);
  // No list-title crumb behind the switcher — the list's label appears in the
  // banner exactly once, in the nav.
  await expect(
    page.getByRole("banner").getByText(ui("topbar.nav.locations"), { exact: true }),
  ).toHaveCount(1);

  // The npc list is the npc's own route (decisions/resources).
  await nav.getByRole("link", { name: ui("topbar.nav.npcs") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel\/npcs$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("browse.title.npcs"));
  await expect(current).toHaveText(ui("topbar.nav.npcs"));
  await assertChromeIsStable(onChapterOverview);

  // --- entry views: same chrome, section marking follows the entity ---------
  // A scene belongs to the chapters section; its hierarchy lives in the page's
  // context line, not in the topbar.
  await page.goto("/campaigns/beispiel/scenes/lighthouse-arrival");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ARRIVAL);
  await expect(current).toHaveText(ui("topbar.nav.chapters"));
  await assertChromeIsStable(onChapterOverview);

  // An NPC belongs to NPCs — whichever chapter happens to mention it. A
  // breadcrumb claiming a chapter path here would be plain misleading for an
  // NPC opened from the NPC list.
  await page.goto("/campaigns/beispiel/npcs/fenn");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(FENN);
  await expect(current).toHaveText(ui("topbar.nav.npcs"));
  await assertChromeIsStable(onChapterOverview);
  // Its context line points at the list it came from.
  await expect(
    page
      .getByRole("navigation", { name: ui("context.aria") })
      .getByRole("link", { name: ui("browse.title.npcs") }),
  ).toHaveAttribute("href", "/campaigns/beispiel/npcs");

  // Views that belong to no section mark nothing at all.
  await page.goto("/campaigns/beispiel/generate");
  await expect(current).toHaveCount(0);
  await assertChromeIsStable(onChapterOverview);
  await page.goto("/campaigns/beispiel/review");
  await expect(current).toHaveCount(0);
  await assertChromeIsStable(onChapterOverview);

  // The chapters link is the way back to the chapter overview — the reason the
  // trio exists.
  await nav.getByRole("link", { name: ui("topbar.nav.chapters") }).click();
  await expect(page).toHaveURL(/\/campaigns\/beispiel$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CAMPAIGN_NAME);
  await expect(current).toHaveText(ui("topbar.nav.chapters"));
  await assertChromeIsStable(onChapterOverview);

  // The switcher still switches, from a list as well.
  await nav.getByRole("link", { name: ui("topbar.nav.locations") }).click();
  await label.click();
  await page.getByRole("menuitem", { name: new RegExp(escapeRe(CAMPAIGN_NAME)) }).click();
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
    seed: { sessions: [RUNNING_SESSION] },
  });

  test("keeps the whole chrome where it was", async ({ page }) => {
    const banner = page.getByRole("banner");
    const nav = banner.getByRole("navigation", { name: ui("topbar.nav.aria") });
    const label = banner.getByRole("button", {
      name: uiPattern("campaign.switcher.current", { name: ".*" }),
    });
    const gear = banner.getByRole("link", { name: ui("settings.title") });
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
        NAV_KEYS.map((key) => nav.getByRole("link", { name: ui(key) }).boundingBox()),
      ),
      searchBox: await banner
        .getByRole("button", { name: new RegExp(escapeRe(ui("topbar.search"))) })
        .boundingBox(),
      session: await chip.getAttribute("data-session-chip"),
      sessionBox: await chip.boundingBox(),
      gearBox: await gear.boundingBox(),
    });

    await page.goto("/campaigns/beispiel/npcs");
    await expect(label).toHaveAccessibleName(
      ui("campaign.switcher.current", { name: CAMPAIGN_NAME }),
    );
    await expect(chip).toHaveAttribute("data-session-chip", "running");
    await expect(nav.locator("[aria-current='page']")).toHaveText(ui("topbar.nav.npcs"));
    // On a list route the gear is just an entry, not the current view.
    await expect(gear).not.toHaveAttribute("aria-current", "page");
    const before = await chrome();

    await gear.click();
    await expect(page).toHaveURL(/\/settings\?from=beispiel$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("settings.title"));

    // Nothing moved, nothing vanished, nothing appeared.
    expect(await chrome()).toEqual(before);
    // The one thing that DID change: the gear is the current view now, and
    // the trio marks nothing — `/settings` is no section of the campaign.
    await expect(gear).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current='page']")).toHaveCount(0);
    // The campaign name is still up there exactly once — in the switcher.
    await expect(banner.getByText(CAMPAIGN_NAME)).toHaveCount(1);
    // And the chip is still the running session's, so the live clock the
    // version poll keeps fresh is reachable from here as well.
    await chip.click();
    await expect(page).toHaveURL(/\/campaigns\/beispiel\/live$/);
  });
});

/**
 * The topbar must not overflow at ANY width from 390px up. The medium widths
 * are the tight ones — switcher, live pill, timer, pause, discard, end,
 * search and generator in one 56px row would run over. With the session
 * consolidated into ONE chip the row fits; this test is the guard that keeps
 * it fitting.
 */
test.describe("with a session running since 19:30", () => {
  test.use({
    seed: { sessions: [RUNNING_SESSION] },
  });

  test("the topbar does not overflow at medium widths while a session runs", async ({
    page,
  }) => {
    for (const width of TOPBAR_WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/campaigns/beispiel");
      await expect(page.getByRole("link", { name: RUNNING_CHIP })).toBeVisible();
      // The gear is on the row at every width the topbar IS the
      // chrome at — icon-only on purpose, so it cannot grow the row. Below md
      // the whole topbar is hidden (the mobile start surface replaces it), so
      // there is nothing to be visible there.
      if (width >= 768) {
        await expect(page.getByRole("link", { name: ui("settings.title") })).toBeVisible();
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
          ? page.getByRole("button", { name: RUNNING_CHIP })
          : page.getByRole("link", { name: RUNNING_CHIP }),
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
 * session running the chip carries the long start label instead of the
 * clock, and the example campaign's last session leaves the review link with
 * its open count on the row next to generator and gear. At
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
      await expect(page.getByRole("button", { name: ui("session.start") })).toBeVisible();
      // The review link is part of THIS row on purpose — it is the widest
      // optional element, and the one that runs the row over.
      await expect(
        page.getByRole("link", { name: uiPattern("topbar.review.pending", { count: "\\d+" }) }),
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
  const started = await startGeneratorJob(api, {
    kind: "scene",
    chapter: "01-salzhafen",
    sourceText: [
      "The party watches the quay at low tide.",
      TRIGGER.threeScenes,
      TRIGGER.slowPart,
    ].join("\n\n"),
  });
  const job = () => getGeneratorJob(api);
  const deadline = Date.now() + 30_000;
  for (;;) {
    const current = await job();
    if ((current.pipeline?.parts ?? []).filter((part) => part.status === "done").length >= 2) break;
    if (Date.now() > deadline) throw new Error("no part of the run ever finished");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Accepting one part while the run is still running is what fills
  // `review.writtenScenes` — the endpoint half of accepting during a run.
  const current = await job();
  expect(current.status).toBe("running");
  await patchGeneratorJob(api, started.id, {
    rev: current.rev,
    review: { writtenScenes: [THREE_SCENES[0].id] },
  });

  // The chip counts against the PARTS OF THE RUN, not against the parts that
  // happen to have answered already: one of three, next to the
  // finished-scenes count on the generator page.
  const progress = ui("topbar.generator.progress", { written: 1, total: 3 });

  for (const width of TOPBAR_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/campaigns/beispiel");
    // Below md the topbar is hidden (the mobile start surface is the chrome
    // there), so the chip is only on the row from 768 up.
    if (width >= 768) {
      const chip = page.getByRole("link", { name: new RegExp(escapeRe(ui("topbar.generator"))) });
      await expect(chip).toBeVisible();
      // The chip stands before the job is read; its name carries the
      // progress once it is.
      await expect(chip).toHaveAccessibleName(new RegExp(escapeRe(progress)));
      // The number is on the chip exactly ONCE, whatever the width does with
      // it: above 2xl it is spelled out, below it stands
      // in the accessible name only — never both, which would read as the
      // same progress phrase printed twice.
      const text = await chip.innerText();
      expect(
        text.split(progress).length - 1,
        `chip text at ${width}px: ${JSON.stringify(text)}`,
      ).toBe(1);
    }
    expect(await topbarOverflow(page), `chapter overview at ${width}px`).toEqual({ row: 0, page: 0 });
    await widenGlyphs(page, "1px");
    expect(
      await topbarOverflow(page),
      `chapter overview at ${width}px with wider glyphs`,
    ).toEqual({ row: 0, page: 0 });
  }
});

test("the edit-campaign dialog writes name, description and text — header, switcher and the campaign follow", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");

  // `exact`: a per-chapter edit action stands on the same page, and a
  // role name matches as a substring.
  await page.getByRole("button", { name: uiExact("common.edit") }).click();
  const dialog = page.getByRole("dialog", { name: ui("campaignEdit.title") });
  await expect(dialog).toContainText(ui("campaignEdit.description"));
  // Prefilled from the campaign as it is stored.
  const stored = await getCampaign(api);
  await expect(dialog.getByLabel(ui("campaignEdit.field.name"), { exact: true })).toHaveValue(
    stored.name,
  );
  await expect(dialog.getByLabel(ui("campaignEdit.field.description"))).toHaveValue(
    stored.description ?? "",
  );
  const text = dialog.getByRole("textbox", { name: ui("campaignEdit.field.body") });
  await expect(text).toHaveValue(stored.body);

  // Nothing typed, nothing to save.
  const save = dialog.getByRole("button", { name: ui("common.save") });
  await expect(save).toBeDisabled();

  const name = "Salzhafen, second draft";
  const description = "Now with more smuggling and fewer gulls.";
  await dialog.getByLabel(ui("campaignEdit.field.name"), { exact: true }).fill(name);
  await dialog.getByLabel(ui("campaignEdit.field.description")).fill(description);
  await text.fill("## Tone\n\nDown to earth, salty, **without** high magic.");
  await save.click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Chapter overview header, subtitle and the text under it, rendered …
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByText(description)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Tone" })).toBeVisible();
  await expect(page.getByText(CAMPAIGN_BODY, { exact: false })).toHaveCount(0);
  // … and the switcher label, which reads the campaign list.
  await expect(
    page.getByRole("button", { name: ui("campaign.switcher.current", { name }) }),
  ).toBeVisible();

  // Stored, through the campaign's own resource.
  const campaign = await getCampaign(api);
  expect(campaign.name).toBe(name);
  expect(campaign.description).toBe(description);
  expect(campaign.body).toBe("## Tone\n\nDown to earth, salty, **without** high magic.\n");
});

test.describe("a campaign without a name", () => {
  test.use({ seed: { campaign: NAMELESS_CAMPAIGN } });

  test("a campaign without a name still names itself and is editable", async ({
    page,
    api,
  }) => {
    // The campaign is a row like any other, and its name falls back to its
    // id — so there is nothing to create and the ordinary patch path covers
    // this case too.
    await page.goto("/campaigns/beispiel");
    // Without a name the header degrades to the id.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("beispiel");
    const nameless = await getCampaign(api);
    expect(nameless).toEqual({
      id: "beispiel",
      name: "beispiel",
      body: "",
      glossaryIntro: "",
      rev: nameless.rev,
    });

    await page.getByRole("button", { name: uiExact("common.edit") }).click();
    const dialog = page.getByRole("dialog", { name: ui("campaignEdit.title") });
    await expect(dialog).toBeVisible();
    // The id is the placeholder, never a proposed name.
    const nameField = dialog.getByLabel(ui("campaignEdit.field.name"), { exact: true });
    await expect(nameField).toHaveValue("");
    await expect(nameField).toHaveAttribute("placeholder", "beispiel");
    await expect(dialog.getByLabel(ui("campaignEdit.field.description"))).toHaveValue("");

    await nameField.fill("Salzhafen from scratch");
    await dialog.getByLabel(ui("campaignEdit.field.description")).fill("Freshly created from the app.");
    await dialog.getByRole("button", { name: ui("common.save") }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Salzhafen from scratch");
    // The id does not move — the server sets it, never the client.
    const campaign = await getCampaign(api);
    expect(campaign.id).toBe("beispiel");
    expect(campaign.name).toBe("Salzhafen from scratch");
    expect(campaign.description).toBe("Freshly created from the app.");
    expect(campaign.body).toBe("");
  });
});

test("the edit-campaign dialog and a second writer: the conflict line, and the save-anyway action writes only the dialog's changes", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: uiExact("common.edit") }).click();
  const dialog = page.getByRole("dialog", { name: ui("campaignEdit.title") });
  const name = dialog.getByLabel(ui("campaignEdit.field.name"), { exact: true });
  await expect(name).toHaveValue(CAMPAIGN_NAME);
  await name.fill("Salzhafen in the fog");

  // The second writer changes the TEXT while the dialog stands.
  await patchCampaign(api, { body: "Written by the API.\n" });
  await dialog.getByRole("button", { name: ui("common.save") }).click();

  // Nothing written: the typed name stays, the conflict line asks.
  await expect(dialog.getByRole("alert")).toContainText(ui("editConflict.line"));
  await expect(name).toHaveValue("Salzhafen in the fog");
  expect((await getCampaign(api)).name).toBe(CAMPAIGN_NAME);

  // Forcing writes the one field the DM changed — the other writer's text
  // survives.
  await dialog.getByRole("button", { name: ui("editConflict.force") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Salzhafen in the fog");
  const stored = await getCampaign(api);
  expect(stored.name).toBe("Salzhafen in the fog");
  expect(stored.body).toBe("Written by the API.\n");
});

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
    await expect(title).toHaveText(CAMPAIGN_NAME);
    const counter = page.getByText(
      `${ui("chapterOverview.chapterCount", { count: 1 })} · ${ui("chapterOverview.sceneCount", { count: 2 })}`,
    );
    const create = page.getByRole("button", { name: ui("create.chapter.title") });
    const edit = page.getByRole("button", { name: uiExact("common.edit") });
    const description = page.getByText(CAMPAIGN_DESCRIPTION, { exact: false });

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
      .getByRole("navigation", { name: ui("lookup.heading") })
      .boundingBox())!;
    expect(descriptionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
    expect(lookupBox.y).toBeGreaterThan(descriptionBox!.y);
  }
});

// Critical path 1: the chapter overview shows the WHOLE text of a chapter and
// of the campaign — rendered like everywhere else, nothing picked out by a
// heading — on a few lines at first. The show-more toggle exists only where
// the text really is longer than that, and a link in the cut-off part that takes
// the keyboard focus opens the text, so the focus never sits on something
// hidden.

/** A text that is longer than four lines at any width, ending in a reference. */
const LONG_TEXT = [
  "## What it is about",
  "For three nights the beacon has not burned, and everyone in the harbour tells a different story about who put it out.",
  "> [!secret] The harbour master knows more than she says.",
  "The party is to find out who put out the fire before the next ship breaks on the cliffs.",
  "At the end [[jorna]] waits on the quay.",
].join("\n\n");

/** The heading of that text, and the opening of its first paragraph. */
const LONG_TEXT_HEADING = "What it is about";
const LONG_TEXT_OPENING = "For three nights the beacon has not burned";

/** The show-more and show-less toggles of a clamped text. */
const showMore = (page: Page) => page.getByRole("button", { name: ui("common.showMore") });
const showLess = (page: Page) => page.getByRole("button", { name: ui("common.showLess") });

/** The clamped box a toggle opens — named by the toggle's aria-controls. */
async function clampBox(page: Page, toggle: Locator) {
  const id = await toggle.getAttribute("aria-controls");
  expect(id).not.toBeNull();
  return page.locator(`[id="${id}"]`);
}

test("a long chapter text is clamped, opens and closes; a link in the cut-off part opens it", async ({
  page,
  api,
}) => {
  await patchChapter(api, "01-salzhafen", { body: `${LONG_TEXT}\n` });
  await page.goto("/campaigns/beispiel");

  // Rendered through the one renderer: the heading, the callout, the reference.
  await expect(page.getByRole("heading", { level: 2, name: LONG_TEXT_HEADING })).toBeVisible();
  const toggle = showMore(page);
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const box = await clampBox(page, toggle);
  await expect(box).toHaveAttribute("data-clamped", "");
  await expect(box).toContainText("The harbour master knows more");
  const clampedHeight = (await box.boundingBox())!.height;
  // Four lines of 14px at line height 1.6, plus the 4px focus-ring margin on
  // both sides — and not a pixel of the rest.
  expect(clampedHeight).toBeLessThanOrEqual(4 * 14 * 1.6 + 8 + 1);

  await toggle.click();
  const less = showLess(page);
  await expect(less).toHaveAttribute("aria-expanded", "true");
  await expect(box).not.toHaveAttribute("data-clamped", "");
  expect((await box.boundingBox())!.height).toBeGreaterThan(clampedHeight);
  // The reference at the very end is a live link to its entry.
  await expect(box.getByRole("link", { name: new RegExp(escapeRe(JORNA)) })).toBeVisible();

  await less.click();
  await expect(box).toHaveAttribute("data-clamped", "");
  await expect(showMore(page)).toBeFocused();

  // The keyboard reaches the reference in the hidden part — and the text opens.
  await box.getByRole("link", { name: new RegExp(escapeRe(JORNA)) }).focus();
  await expect(box).not.toHaveAttribute("data-clamped", "");
  await expect(showLess(page)).toBeVisible();
});

test("the campaign's text stands under its description, clamped the same way", async ({
  page,
  api,
}) => {
  await patchCampaign(api, { body: `${LONG_TEXT}\n` });
  // The chapter's own text is short, so the one toggle is the header's.
  await page.goto("/campaigns/beispiel");
  await expect(page.getByText(LONG_TEXT_OPENING, { exact: false })).toBeVisible();
  const toggle = showMore(page);
  await expect(toggle).toHaveCount(1);
  const box = await clampBox(page, toggle);
  await expect(box).toContainText(LONG_TEXT_OPENING);
  await expect(box).toHaveAttribute("data-clamped", "");
  await toggle.click();
  await expect(box).not.toHaveAttribute("data-clamped", "");

  // An empty campaign text shows nothing extra — the description stays.
  await patchCampaign(api, { body: "" });
  await page.reload();
  await expect(page.getByText(CAMPAIGN_DESCRIPTION, { exact: false })).toBeVisible();
  await expect(page.getByText(LONG_TEXT_OPENING, { exact: false })).toHaveCount(0);
  await expect(showMore(page)).toHaveCount(0);
});

// Critical path 1: a chapter is editable where it is read.
//
// Creating a chapter is not the only moment its title and text can be
// said: a chapter created without a description gets its text here, and a
// chapter a generator run created under its slug is renamed here — otherwise
// the overview would list a heading nobody can correct. Both go through the
// chapter's own resource with its rev guard: the title in the chapter's
// dialog, the text in the text dialog.
test("a chapter's title and text are editable from the chapter overview", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  // The active chapter is open by default, so its actions are on screen.
  const properties = page.getByRole("button", { name: ui("chapterOverview.chapter.properties") });
  await expect(properties).toBeVisible();

  // --- the title, through the chapter's dialog ---
  await properties.click();
  let dialog = page.getByRole("dialog", { name: CHAPTER_PROPERTIES_TITLE });
  // The form marks a required field in its label, so the accessible name is
  // that whole string.
  const title = dialog.getByRole("textbox", { name: CHAPTER_TITLE_LABEL });
  await expect(title).toHaveValue(CHAPTER_TITLE);
  await title.fill("Chapter 1: Salzhafen");
  await dialog.getByRole("button", { name: ui("common.save") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The overview heading follows — it reads the tree, which the save
  // invalidated.
  await expect(page.getByRole("heading", { level: 2, name: "Chapter 1: Salzhafen" })).toBeVisible();

  // --- the text, through the edit dialog ---
  await page.getByRole("button", { name: ui("chapterOverview.chapter.edit") }).click();
  dialog = page.getByRole("dialog", {
    name: ui("chapterBody.title", { title: "Chapter 1: Salzhafen" }),
  });
  await expect(dialog).toContainText(ui("chapterBody.description"));
  const body = dialog.getByRole("textbox", { name: ui("chapterBody.field.body") });
  await expect(body).toHaveValue(new RegExp(escapeRe(CHAPTER_BODY)));
  await body.fill("");
  await expect(body).toHaveAttribute("placeholder", ui("chapterBody.field.body.placeholder"));
  // A heading is text like any other now: it is shown, and so is what follows.
  await body.fill("## What it is about\n\nLight the lighthouse again.");
  await dialog.getByRole("button", { name: ui("common.save") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The overview shows the whole text, rendered.
  await expect(page.getByRole("heading", { level: 2, name: "What it is about" })).toBeVisible();
  await expect(page.getByText("Light the lighthouse again.", { exact: true })).toBeVisible();
  const stored = await getChapter(api, "01-salzhafen");
  expect(stored.title).toBe("Chapter 1: Salzhafen");
  expect(stored.body).toContain("Light the lighthouse again.");
});

test("the chapter edit dialog shows the 409 instead of overwriting a second writer", async ({
  page,
  api,
}) => {
  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: ui("chapterOverview.chapter.edit") }).click();
  const dialog = page.getByRole("dialog");
  const body = dialog.getByRole("textbox", { name: ui("chapterBody.field.body") });
  await expect(body).toHaveValue(new RegExp(escapeRe(CHAPTER_BODY)));

  // A SECOND WRITER while the dialog stands (there is no "external edit" any
  // more — e2e/README.md): the API writes with a fresh token.
  await patchChapter(api, "01-salzhafen", { body: "From the API.\n" });

  await body.fill("From the dialog.");
  await dialog.getByRole("button", { name: ui("common.save") }).click();

  // Nothing was written, the dialog says so, and the typed text is still
  // there.
  await expect(dialog.getByText(ui("editConflict.line"), { exact: false })).toBeVisible();
  await expect(body).toHaveValue("From the dialog.");
  expect((await getChapter(api, "01-salzhafen")).body).toContain("From the API.");

  // Forcing writes the same field on top of the row as it stands.
  await dialog.getByRole("button", { name: ui("editConflict.force") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("From the dialog.", { exact: true })).toBeVisible();
});

// The chapter status control (critical paths 1 and 7). The overview decides
// which chapter the session is in, and the status DISPLAY is that control.
//
// Every value is ONE write of the chapter it names — `PATCH …/chapters/<id>
// { rev, status }` —, `active` included: at most one chapter is active, so
// the server puts the one that held it back to `planned` in the same
// transaction. There is never a moment with two active chapters.

/** The chapter writes a page sends: PATCHes of a chapter's own resource. */
function chapterPatches(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (request.method() === "PATCH" && /\/api\/campaigns\/[^/]+\/chapters\/[^/]+$/.test(url)) {
      writes.push(`${url.replace(/^.*\/api\//, "")} ${request.postData() ?? ""}`);
    }
  });
  return writes;
}

/** The title of a second chapter the status tests create. */
const SECOND_CHAPTER = "Chapter 2: The Cove";

/** The ids of the campaign's active chapters, as the tree lists them. */
async function activeChapters(api: Api): Promise<string[]> {
  const tree = await api.get<{ chapters: { id: string; status?: string }[] }>(
    "campaigns/beispiel/tree",
  );
  return tree.chapters.filter((chapter) => chapter.status === "active").map((chapter) => chapter.id);
}

test("the chapter status control shows the localized labels and makes another chapter the active one", async ({
  page,
  api,
}) => {
  // A second chapter to move the status TO — the example campaign has one.
  const created = await api.send<{ id: string }>("POST", chapterPath(api), {
    title: SECOND_CHAPTER,
  });
  expect(created.id).toBe("chapter-2-the-cove");

  await page.goto("/campaigns/beispiel");

  // The active chapter's control names its current value for a screen reader…
  const activeMenu = page.getByRole("button", { name: chapterStatusName("active") });
  await expect(activeMenu).toBeVisible();
  // …and the label is the localized one, not the wire value.
  await expect(activeMenu).toContainText(chapterStatus("active"));
  await expect(activeMenu).not.toContainText("active");

  // The three options, in lifecycle order, localized.
  await activeMenu.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio")).toHaveText([
    chapterStatus("planned"),
    chapterStatus("active"),
    chapterStatus("done"),
  ]);
  await page.keyboard.press("Escape");

  // --- activating B, from B's own control ---
  const writes = chapterPatches(page);
  const second = page.getByRole("button", { name: new RegExp(escapeRe(SECOND_CHAPTER)) });
  await expect(second).toBeVisible();
  await page.getByRole("button", { name: chapterStatusName("planned") }).click();
  await page.getByRole("menuitemradio", { name: chapterStatus("active") }).click();

  // B is active, A went back to planned — in one write.
  await expect(page.getByRole("button", { name: chapterStatusName("active") })).toHaveCount(1);
  await expect.poll(async () => (await getChapter(api, "01-salzhafen")).status).toBe("planned");
  expect((await getChapter(api, created.id)).status).toBe("active");
  expect(await activeChapters(api)).toEqual([created.id]);

  // Exactly ONE write, and it named the chapter the DM picked, with its rev.
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatch(new RegExp(`^campaigns/beispiel/chapters/${created.id} `));
  expect(JSON.parse(writes[0]!.replace(/^\S+ /, ""))).toMatchObject({ status: "active" });
  expect(JSON.parse(writes[0]!.replace(/^\S+ /, ""))).toHaveProperty("rev");

  // …and it stays that way with the invalidation and a version poll behind
  // it: still one write, B active and A planned.
  await page.waitForTimeout(2_000);
  expect(writes).toHaveLength(1);
  await expect(page.getByRole("button", { name: chapterStatusName("active") })).toHaveCount(1);
  // Per CHAPTER row (the control beside its h2) — the scene rows in the open
  // accordion carry controls of their own.
  const prefix = ui("status.change.aria", { current: "" });
  const rows = await page
    .locator(`xpath=//h2/ancestor::div[1]//button[starts-with(@aria-label,"${prefix}")]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(rows).toEqual([chapterStatusName("planned"), chapterStatusName("active")]);
  expect(await activeChapters(api)).toEqual([created.id]);
});

test("a second writer: the chapter status pick reports the conflict inline, the next pick works", async ({
  page,
  api,
}) => {
  const created = await api.send<{ id: string }>("POST", chapterPath(api), {
    title: SECOND_CHAPTER,
  });
  await page.goto("/campaigns/beispiel");
  const trigger = page.getByRole("button", { name: chapterStatusName("planned") });
  const message = page.getByText(ui("write.stale"));

  // The control reads the chapter when its menu opens; a write between that
  // read and the pick makes the pick stale. The version poll (~5s) can heal
  // it in between — hence up to three attempts.
  let conflicted = false;
  for (let attempt = 1; attempt <= 3 && !conflicted; attempt++) {
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.waitForTimeout(300);
    await patchChapter(api, created.id, { body: `From a second writer (${attempt}).\n` });
    await page.getByRole("menuitemradio", { name: chapterStatus("done") }).click();
    conflicted = await message
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => true)
      .catch(() => false);
  }
  expect(conflicted, "the 409 conflict message never appeared").toBe(true);

  // Nothing was written: the other writer's text stands, the status too — and
  // the control has no conflict actions of its own.
  const stored = await getChapter(api, created.id);
  expect(stored.status).toBe("planned");
  expect(stored.body).toContain("From a second writer");
  await expect(page.getByRole("button", { name: ui("editConflict.force") })).toHaveCount(0);

  // The control re-read the chapter, so the SAME pick works now.
  await trigger.click();
  await page.getByRole("menuitemradio", { name: chapterStatus("done") }).click();
  await expect(
    page.getByRole("button", { name: chapterStatusName("done") }),
  ).toBeVisible();
  await expect.poll(async () => (await getChapter(api, created.id)).status).toBe("done");
  expect((await getChapter(api, "01-salzhafen")).status).toBe("active");
});

// The control is a RADIO group, so the checked option is the state —
// selecting it is nothing to write.
test("re-selecting the value a chapter already has writes nothing", async ({ page, api }) => {
  await api.send("POST", chapterPath(api), { title: SECOND_CHAPTER });
  const writes = chapterPatches(page);

  await page.goto("/campaigns/beispiel");
  const activeMenu = page.getByRole("button", { name: chapterStatusName("active") });
  await activeMenu.click();
  await page.getByRole("menuitemradio", { name: chapterStatus("active") }).click();
  await page.waitForTimeout(1_000);

  expect(writes).toEqual([]);
  await expect(activeMenu).toBeVisible();
  expect((await getChapter(api, "01-salzhafen")).status).toBe("active");
});

// A value other than `active` moves only the chapter it names.
test("picking done writes that chapter and leaves the active one alone", async ({
  page,
  api,
}) => {
  const created = await api.send<{ id: string }>("POST", chapterPath(api), {
    title: SECOND_CHAPTER,
  });

  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: chapterStatusName("planned") }).click();
  await page.getByRole("menuitemradio", { name: chapterStatus("done") }).click();

  await expect(
    page.getByRole("button", { name: chapterStatusName("done") }),
  ).toBeVisible();
  await expect.poll(async () => (await getChapter(api, created.id)).status).toBe("done");
  // The evening's chapter is untouched.
  expect((await getChapter(api, "01-salzhafen")).status).toBe("active");
});

// The dialog is a FORM over the same value, and a form sends what CHANGED: a
// status field the DM never touched must not be written, no matter what the
// cache behind the dialog happened to hold when it opened. The app's copy of
// a chapter goes stale the moment another writer activates a different one
// (up to one version poll), and an untouched active value in the form would
// put it back — from a dialog that was only opened to fix a title.
test("an untouched status field is not written, not even a stale active", async ({ page, api }) => {
  const patches: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH") patches.push(request.postData() ?? "");
  });

  await page.goto("/campaigns/beispiel");
  // The active chapter is open by default: it is in the app's cache now, with
  // `status: active`.
  const properties = page.getByRole("button", { name: ui("chapterOverview.chapter.properties") });
  await expect(properties).toBeVisible();

  // Another writer activates a second chapter. The app does not know yet —
  // the version poll is what tells it, and the dialog opens before that.
  const created = await api.send<{ id: string }>("POST", chapterPath(api), {
    title: SECOND_CHAPTER,
    id: "02",
  });
  await patchChapter(api, "02", { status: "active" });
  expect((await getChapter(api, "01-salzhafen")).status).toBe("planned");

  await properties.click();
  const dialog = page.getByRole("dialog");
  // The scenario, spelled out: the form opened on the STALE value.
  await expect(dialog.getByLabel(ui("properties.chapter.status.label"))).toHaveValue("active");

  // Only the title is touched.
  await dialog.getByLabel(ui("properties.chapter.title.label")).fill("Chapter 1: Salzhafen");
  await dialog.getByRole("button", { name: ui("common.save") }).click();
  // The other writer moved the chapter, so the frozen rev is stale: the first
  // attempt is the 409 of decisions/writes, nothing written. The typed title stays and
  // the next attempt writes on top of what is stored — with the status STILL
  // untouched, which is the point of this test.
  await expect(dialog).toContainText(ui("editConflict.line"));
  await dialog.getByRole("button", { name: ui("editConflict.force") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The title is written, the status is not even mentioned — and the chapter
  // the other writer activated keeps it.
  const stored = await getChapter(api, "01-salzhafen");
  expect(stored.title).toBe("Chapter 1: Salzhafen");
  expect(stored.status).toBe("planned");
  expect((await getChapter(api, created.id)).status).toBe("active");
  // Both attempts sent the title and nothing else — the status field never
  // appears on the wire, so no stale active value can ride along.
  expect(patches).toHaveLength(2);
  for (const body of patches) {
    expect(body).toContain("Chapter 1: Salzhafen");
    expect(body).not.toContain("status");
  }
});

// The chapter's dialog is the second door onto the same value — and it must
// not be a way past the one-active rule.
test("the chapter's dialog offers the enum and its active value makes the chapter the active one", async ({
  page,
  api,
}) => {
  const created = await api.send<{ id: string }>("POST", chapterPath(api), {
    title: SECOND_CHAPTER,
  });

  await page.goto("/campaigns/beispiel");
  await page.getByRole("button", { name: new RegExp(escapeRe(SECOND_CHAPTER)) }).click();
  // Two chapters are open now, so the actions are named per chapter — the
  // second one belongs to the second chapter.
  await page.getByRole("button", { name: ui("chapterOverview.chapter.properties") }).nth(1).click();
  const dialog = page.getByRole("dialog", { name: CHAPTER_PROPERTIES_TITLE });

  // A select over the enum, not a free text field.
  const status = dialog.getByLabel(ui("properties.chapter.status.label"));
  await expect(status).toBeVisible();
  await status.selectOption({ label: chapterStatus("active") });
  await dialog.getByRole("button", { name: ui("common.save") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The server kept the rule: exactly one active chapter, and it is this one.
  await expect.poll(async () => (await getChapter(api, created.id)).status).toBe("active");
  await expect.poll(async () => (await getChapter(api, "01-salzhafen")).status).toBe("planned");
  expect(await activeChapters(api)).toEqual([created.id]);
  await expect(page.getByRole("button", { name: chapterStatusName("active") })).toHaveCount(1);
});

// --- the scene order: one list, up/down, one guard of its own (decisions/scene-order) -----

/** The chapter of the example campaign — the one that holds an order. */
const CHAPTER = "01-salzhafen";
/** The write path of that order: the whole list, against its own guard. */
const ORDER_PATH = `campaigns/beispiel/chapters/${CHAPTER}/scene-order`;
/** The conflict line of the order — it reports and reloads, it does not force. */
const ORDER_CONFLICT = ui("chapterOverview.order.conflict");

/** The tree's answer about one chapter's order — the parts this spec reads. */
interface OrderTree {
  chapters: {
    id: string;
    /** The order's OWN guard token; the chapter's `rev` is a different one. */
    sceneOrderRev: number;
    scenes: { id: string; title: string }[];
  }[];
}

/** Scene id -> the title its row and its move controls carry. */
const TITLES: Record<string, string> = {
  "lighthouse-arrival": ARRIVAL,
  "order-keller": "The cellar under the tower",
  "order-steg": "At the jetty by night",
  "smuggler-captured": CAPTURED,
};

/** The move-down name of a row, split around its title. */
const [MOVE_DOWN_BEFORE, MOVE_DOWN_AFTER] = ui("chapterOverview.scene.moveDown.aria", {
  title: "\u0000",
}).split("\u0000") as [string, string];

/** One planned scene for the order fixtures, with a location so the row has a meta line. */
function plannedScene(id: string, location: string): SceneProposal {
  return {
    id,
    title: TITLES[id]!,
    type: "planned",
    chapter: CHAPTER,
    location,
    npcs: [],
    handouts: [],
    tags: [],
    status: "draft",
    body: `\n## Flow\n\n${TITLES[id]}.\n`,
  };
}

/**
 * Three planned scenes in the chapter — the example campaign brings one, and
 * an order needs something to arrange.
 *
 * The IDS set the seeded order: the seed run appends every scene to the end
 * of its chapter, in the order it reads `scenes/` — alphabetically by id. So
 * these two stand behind `lighthouse-arrival`, and the contingency
 * (`smuggler-captured`) behind them.
 */
const ORDER_SEED = {
  scenes: [plannedScene("order-keller", "leuchtturm"), plannedScene("order-steg", "bucht")],
};

/** The seeded order, by id — where every test of this block starts. */
const SEEDED_ORDER = ["lighthouse-arrival", "order-keller", "order-steg", "smuggler-captured"];

/** The chapter node of the tree: its scenes in order and the order's guard. */
async function orderNode(api: Api): Promise<OrderTree["chapters"][number]> {
  const tree = await api.get<OrderTree>("campaigns/beispiel/tree");
  const chapter = tree.chapters.find((c) => c.id === CHAPTER);
  if (chapter === undefined) throw new Error(`the tree has no chapter ${CHAPTER}`);
  return chapter;
}

/** The STORED order, by scene id — what a reload would read back. */
async function storedOrder(api: Api): Promise<string[]> {
  return (await orderNode(api)).scenes.map((scene) => scene.id);
}

/**
 * The rows on screen in DOM order, by the title they show.
 *
 * Read off the move controls: they carry the row's title in their accessible
 * name, and a row has no other handle that says where it stands.
 */
async function shownOrder(page: Page): Promise<string[]> {
  const labels = await page
    .getByRole("button", { name: new RegExp(`${escapeRe(MOVE_DOWN_AFTER)}$`) })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  return labels.map((label) =>
    label.slice(MOVE_DOWN_BEFORE.length, label.length - MOVE_DOWN_AFTER.length),
  );
}

/** The titles of an order given by id — what `shownOrder` has to answer. */
function titlesOf(order: readonly string[]): string[] {
  return order.map((id) => TITLES[id] ?? id);
}

test.describe("the scene order of a chapter", () => {
  test.use({ seed: ORDER_SEED });

  const up = (page: Page, id: string) =>
    page.getByRole("button", {
      name: ui("chapterOverview.scene.moveUp.aria", { title: TITLES[id] ?? id }),
    });
  const down = (page: Page, id: string) =>
    page.getByRole("button", {
      name: ui("chapterOverview.scene.moveDown.aria", { title: TITLES[id] ?? id }),
    });

  test("the scenes are ONE list, and a step down survives a reload", async ({ page, api }) => {
    await page.goto("/campaigns/beispiel");
    await expect.poll(() => shownOrder(page)).toEqual(titlesOf(SEEDED_ORDER));

    // The ends of a BLOCK are the ends of the move: the first row cannot go
    // up, the last of the plan cannot go down, and the lone contingency has
    // nowhere to go at all — its block is one row long.
    await expect(up(page, "lighthouse-arrival")).toBeDisabled();
    await expect(down(page, "lighthouse-arrival")).toBeEnabled();
    await expect(up(page, "order-steg")).toBeEnabled();
    await expect(down(page, "order-steg")).toBeDisabled();
    await expect(up(page, "smuggler-captured")).toBeDisabled();
    await expect(down(page, "smuggler-captured")).toBeDisabled();

    // One step down swaps the first two rows — visibly …
    const moved = ["order-keller", "lighthouse-arrival", "order-steg", "smuggler-captured"];
    await down(page, "lighthouse-arrival").click();
    await expect.poll(() => shownOrder(page)).toEqual(titlesOf(moved));
    // … and in the database, which is what the reload reads back.
    await expect.poll(() => storedOrder(api)).toEqual(moved);
    await page.reload();
    await expect.poll(() => shownOrder(page)).toEqual(titlesOf(moved));
    // The moved row took its ends with it: now IT is the one that cannot go up.
    await expect(up(page, "order-keller")).toBeDisabled();
    await expect(up(page, "lighthouse-arrival")).toBeEnabled();
  });

  test("a second writer rearranges: the press reports it and the current order stands", async ({
    page,
    api,
  }) => {
    await page.goto("/campaigns/beispiel");
    await expect.poll(() => shownOrder(page)).toEqual(titlesOf(SEEDED_ORDER));

    const message = page.getByText(ORDER_CONFLICT);
    // The page refreshes its token on the version poll (~5s), so the conflict
    // window is short: write, then press immediately, up to three times — the
    // same shape as the status control's conflict (critical path 7).
    let conflicted = false;
    let written: string[] = [];
    for (let attempt = 1; attempt <= 3 && !conflicted; attempt++) {
      const node = await orderNode(api);
      const front = attempt % 2 === 1 ? "order-steg" : "order-keller";
      written = [front, ...node.scenes.map((scene) => scene.id).filter((id) => id !== front)];
      await api.send("PUT", ORDER_PATH, { scenes: written, rev: node.sceneOrderRev });
      await down(page, "lighthouse-arrival").click();
      conflicted = await message
        .waitFor({ state: "visible", timeout: 4000 })
        .then(() => true)
        .catch(() => false);
    }
    expect(conflicted, "the order conflict message never appeared").toBe(true);

    // Nothing was overwritten: the order the other writer set is the stored
    // one, and the page shows exactly that — the message announces a reload
    // and there IS one.
    expect(await storedOrder(api)).toEqual(written);
    await expect.poll(() => shownOrder(page)).toEqual(titlesOf(written));

    // With the fresh token the very same press lands.
    const first = written[0] ?? "";
    const after = [written[1], first, ...written.slice(2)];
    await down(page, first).click();
    await expect.poll(() => storedOrder(api)).toEqual(after);
    await expect(message).toHaveCount(0);
  });

  test("a scene's own write leaves the order's guard alone", async ({ api }) => {
    // The other direction of the three guards: writing a scene bumps its own
    // `rev` and nothing of the chapter's order (decisions/scene-order).
    const node = await orderNode(api);
    const before = await getScene(api, "order-keller");
    const written = await patchScene(api, "order-keller", { title: "The cellar, measured anew" });
    expect(written.rev).not.toBe(before.rev);
    const after = await orderNode(api);
    expect(after.sceneOrderRev).toBe(node.sceneOrderRev);
    expect(after.scenes.map((scene) => scene.id)).toEqual(SEEDED_ORDER);
  });

  test("a reorder is no conflict for an open editor — three writers, three guards", async ({
    page,
    api,
  }) => {
    const scene = "lighthouse-arrival";
    const sceneBefore = await getScene(api, scene);
    const chapterBefore = await getChapter(api, CHAPTER);
    const addition = "A line that survives the reordering.";

    // The scene's text editor stands open on the version it started from.
    await page.goto(`/campaigns/beispiel/scenes/${scene}`);
    await page.getByRole("button", { name: ui("common.edit") }).click();
    await page.getByRole("button", { name: uiExact("composer.mode.markdown") }).click();
    const textarea = page.getByRole("textbox", {
      name: uiPattern("bodyEditor.markdown.aria", { path: ".+" }),
    });
    await expect(textarea).toHaveValue(sceneBefore.body);
    await textarea.fill(`${sceneBefore.body}\n${addition}\n`);

    // The order moves underneath — the one write the up/down buttons make.
    const node = await orderNode(api);
    const reordered = ["order-keller", "lighthouse-arrival", "order-steg", "smuggler-captured"];
    await api.send("PUT", ORDER_PATH, { scenes: reordered, rev: node.sceneOrderRev });

    // It bumped its OWN guard and nobody else's: neither the scene's row
    // version nor the chapter's moved, so neither editor is stale (decisions/scene-order).
    expect((await orderNode(api)).sceneOrderRev).not.toBe(node.sceneOrderRev);
    expect((await getScene(api, scene)).rev).toBe(sceneBefore.rev);
    expect((await getChapter(api, CHAPTER)).rev).toBe(chapterBefore.rev);

    // So the save lands — no conflict line, the typed text is stored.
    await page.getByRole("button", { name: ui("common.save") }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: ui("editConflict.line") }),
    ).toHaveCount(0);
    await expect.poll(async () => (await getScene(api, scene)).body).toContain(addition);
    expect(await storedOrder(api)).toEqual(reordered);

    // The chapter's own text holds `chapters.rev`, which the order does not
    // touch either — same promise, other half of the chapter.
    await page.goto("/campaigns/beispiel");
    await page.getByRole("button", { name: ui("chapterOverview.chapter.edit") }).click();
    const dialog = page.getByRole("dialog");
    const chapterText = dialog.getByRole("textbox", { name: ui("chapterBody.field.body") });
    await expect(chapterText).toHaveValue(new RegExp(escapeRe(CHAPTER_BODY)));
    await chapterText.fill("Light the lighthouse again.");
    const second = await orderNode(api);
    const again = ["order-steg", "order-keller", "lighthouse-arrival", "smuggler-captured"];
    await api.send("PUT", ORDER_PATH, { scenes: again, rev: second.sceneOrderRev });
    await dialog.getByRole("button", { name: ui("common.save") }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () => (await getChapter(api, CHAPTER)).body)
      .toContain("Light the lighthouse again.");
    // …and the chapter write left the order where the other writer put it.
    expect(await storedOrder(api)).toEqual(again);
  });
});

test("the npc's and the location's reading views offer the session start like every reading view", async ({
  page,
}) => {
  const start = page.getByRole("banner").getByRole("button", { name: ui("session.start") });

  // The npc's and the location's own routes are reading views: with no
  // session running the chip offers the start, exactly as it does on a scene.
  await page.goto("/campaigns/beispiel/npcs/jorna");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(JORNA);
  await expect(start).toBeVisible();
  await page.goto("/campaigns/beispiel/locations/leuchtturm");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(LIGHTHOUSE);
  await expect(start).toBeVisible();

  // The lists are lists, not reading views — no start offered there.
  await page.goto("/campaigns/beispiel/npcs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("browse.title.npcs"));
  await expect(start).toHaveCount(0);
  await page.goto("/campaigns/beispiel/locations");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ui("browse.title.locations"));
  await expect(start).toHaveCount(0);
});
