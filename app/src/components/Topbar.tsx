// The constant topbar (design reference: 56px, hairline below).
//
// THE CHROME IS GLOBAL AND STABLE. Every campaign-scoped view — chapter
// overview, lists, reading views, generator, review — shows the very same
// left block:
//
//     Grimoire │ <campaign> › <area> ⌄ │ session chip
//
// The campaign menu (components/CampaignMenu.tsx) is the ONE way into the
// areas of a campaign; closed, it names the campaign and the area of the
// current view, and that name is the only thing that differs between the
// campaign-scoped views. There are NO breadcrumbs in the topbar: hierarchical
// context lives in the page header instead (components/PageContext.tsx), next
// to the title it describes. The campaign name appears exactly ONCE in the
// chrome.
//
// ONE SESSION CHIP. The running session is a SINGLE chip in a fixed slot —
// the same place on EVERY campaign-scoped route, /live included. The session
// draws it (session/SessionChip.tsx); the topbar only says where it sits and
// which state the route allows.
//
// Deviation from design/ (which keeps a separate live topbar): stability of
// the session control beats the prototype's two layouts. The
// live chapter label lives in the live view's own scene nav, next to the
// scenes it describes.
//
// The right side holds the tools, not places: the ⌘K search chip (opens the
// palette; hidden without a campaign in the URL — "/" only ever shows the
// empty state), the generator entry — on the chapter overview always, on
// every other campaign view while the campaign has a job — with the job's
// state and the way to its review, the settings gear, the session chip (one
// click starts a session and enters /campaigns/:campaign/live) and the
// harvest progress on the review.

import { useQuery } from "@tanstack/react-query";
import { Search, Settings, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, matchPath, useLocation, useSearchParams } from "react-router";

import { fetchCampaigns, fetchTree } from "@/api";
import { CampaignMenu } from "@/components/CampaignMenu";
import { CommandPalette } from "@/components/CommandPalette";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconLogo } from "@/icons";
import { useT } from "@/i18n";
import { settingsCampaign } from "@/lib/campaign";
import {
  acceptProgress,
  augmentTarget,
  augmentTargetName,
  jobSentence,
  jobState,
  pipelineProgress,
} from "@/generator-job/generator-job-state";
import { generatorHref, jobHref } from "@/generator-job/job-links";
import { useGenerateJob } from "@/generator-job/generator-job-query";
import { cn } from "@/lib/utils";
import { useReviewCards } from "@/lib/use-review";
import { MobileSessionRow, SessionChip, sessionChipState } from "@/session/SessionChip";
import { useRunningSession } from "@/session/use-session";

/** The campaign of a `matchPath` result, or undefined when nothing matched. */
function campaignOf(
  match: { params: { campaign?: string } } | null,
): string | undefined {
  return match?.params.campaign;
}

/**
 * `/settings` KEEPS THE CAMPAIGN CHROME.
 *
 * The gear is part of the global chrome, so pressing it must not undress the
 * bar it sits on: the campaign menu, the search chip and the session
 * chip stay exactly where they were, and the gear itself is simply marked as
 * the current view. Which campaign that chrome is about is NOT a path segment
 * here — `/settings` is campaign-independent on purpose — it is the campaign
 * the DM came from, travelling in `?from=`. That answer has exactly one
 * source, `settingsCampaign` (lib/campaign.ts), shared with the page below
 * (routes/settings.tsx): the bar and the page can never name two different
 * campaigns. Only the cold start — no usable `from` and no campaign at all —
 * leaves the bar with the wordmark alone, because then there is nothing to
 * dress it with.
 */
function useSettingsCampaign(isSettings: boolean): string {
  const [search] = useSearchParams();
  const from = search.get("from");
  const { data } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
    enabled: isSettings,
  });
  if (!isSettings) return "";
  return settingsCampaign(from, data ?? []) ?? "";
}

export function Topbar() {
  const t = useT();
  const { pathname } = useLocation();
  const liveMatch = matchPath("/campaigns/:campaign/live", pathname);
  const reviewMatch = matchPath("/campaigns/:campaign/review", pathname);
  const generateMatch = matchPath("/campaigns/:campaign/generate", pathname);
  // A chapter's, a scene's, an npc's and a location's own routes — the
  // reading view, and for the npc and the location their list (decisions/resources).
  const chaptersMatch = matchPath("/campaigns/:campaign/chapters/*", pathname);
  const scenesMatch = matchPath("/campaigns/:campaign/scenes/*", pathname);
  const npcsMatch = matchPath("/campaigns/:campaign/npcs/*", pathname);
  const locationsMatch = matchPath("/campaigns/:campaign/locations/*", pathname);
  // The two campaign-content pages, the price page, the random tables and the trash: the bar
  // above them is this campaign's bar too. Without them the topbar goes blank
  // on those pages: no campaign menu, no ⌘K, no gear.
  const knowledgeMatch = matchPath("/campaigns/:campaign/knowledge", pathname);
  const glossaryMatch = matchPath("/campaigns/:campaign/glossary", pathname);
  const itemPricesMatch = matchPath("/campaigns/:campaign/item-prices", pathname);
  const randomTablesMatch = matchPath("/campaigns/:campaign/random-tables", pathname);
  const trashMatch = matchPath("/campaigns/:campaign/trash", pathname);
  const chapterOverviewMatch = matchPath("/campaigns/:campaign", pathname);
  const isSettings = matchPath("/settings", pathname) !== null;
  const settingsFrom = useSettingsCampaign(isSettings);
  const campaign =
    campaignOf(chaptersMatch) ??
    campaignOf(scenesMatch) ??
    campaignOf(liveMatch) ??
    campaignOf(reviewMatch) ??
    campaignOf(generateMatch) ??
    campaignOf(npcsMatch) ??
    campaignOf(locationsMatch) ??
    campaignOf(knowledgeMatch) ??
    campaignOf(glossaryMatch) ??
    campaignOf(itemPricesMatch) ??
    campaignOf(randomTablesMatch) ??
    campaignOf(trashMatch) ??
    campaignOf(chapterOverviewMatch) ??
    (settingsFrom === "" ? undefined : settingsFrom) ??
    "";
  // These read their OWN match, not `campaign`: on `/settings` the campaign is
  // resolved from `?from=` (see above), so asking `campaign !== ""` would make
  // the settings page the chapter overview of that campaign, hanging the
  // chapter overview's generator entry into the row.
  const isChapter =
    campaignOf(chaptersMatch) !== undefined && (chaptersMatch?.params["*"] ?? "") !== "";
  const isScene =
    campaignOf(scenesMatch) !== undefined && (scenesMatch?.params["*"] ?? "") !== "";
  // An npc's and a location's reading views are reading views like a
  // scene's; their lists are not.
  const isNpcView = campaignOf(npcsMatch) !== undefined && (npcsMatch?.params["*"] ?? "") !== "";
  const isLocationView =
    campaignOf(locationsMatch) !== undefined && (locationsMatch?.params["*"] ?? "") !== "";
  const isReadingView = isChapter || isScene || isNpcView || isLocationView;
  const isLive = campaignOf(liveMatch) !== undefined;
  const isReview = campaignOf(reviewMatch) !== undefined;
  const isGenerate = campaignOf(generateMatch) !== undefined;
  const isChapterOverview = campaignOf(chapterOverviewMatch) !== undefined;

  const [searchOpen, setSearchOpen] = useState(false);

  // The running session — asked on EVERY campaign route now, not just /live:
  // one shared query key, so this is one request for topbar and live view.
  const session = useRunningSession(campaign, campaign !== "");
  const live = session.data ?? undefined;

  return (
    <>
      {/* Below md the topbar is hidden — the running session must not be, so
          the same chip gets its own slim row there. */}
      {live !== undefined && campaign !== "" && (
        <MobileSessionRow campaign={campaign} session={live} />
      )}
      {/* Below md the campaign-scoped views carry their own mobile chrome
          (the start's wordmark row and every other view's row with the
          campaign menu); the topbar
          is desktop chrome there. Without a campaign in the URL ("/" with no
          campaign at all) it stays visible on every width, so the empty state
          is not a bare page. */}
      <header
        className={cn(
          // Gap: 14px is the designed rhythm, and it holds from 2xl up —
          // below that the SPACING gives way instead of any content
          // (nothing is hidden or truncated for it), so the row keeps real
          // reserve on CI's wider Linux glyphs rather than reserve to the
          // pixel.
          "flex h-14 flex-none items-center gap-2.5 border-b border-border px-6 2xl:gap-3.5",
          campaign !== "" && "max-md:hidden",
        )}
      >
        <Link
          to="/"
          className="-ml-1.5 flex flex-none items-center gap-[9px] rounded-md px-1.5 py-1 font-serif text-[17px] font-semibold tracking-[.01em] text-foreground hover:text-primary-hover"
        >
          <IconLogo size={19} className="text-primary" />
          {t("topbar.brand")}
        </Link>

        {/* ONE campaign context for every campaign-scoped view: the
            campaign menu, always the same element in the same place. It is
            the one way into the areas of the campaign, the live mode
            included. */}
        {campaign !== "" && <CampaignMenu campaign={campaign} />}

        <div className="flex-1" />

        {/* Only on campaign-scoped views — "/" has no search context (palette
            and shortcut are not mounted there at all). */}
        {campaign !== "" && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSearchOpen(true)}
              // THE elastic element of the topbar: it wants
              // 200px, gives way down to 3rem at medium widths and never
              // lets the row overflow — its label truncates on the way.
              // Below XL it goes ICON-ONLY, so the band up to xl, which
              // carries the campaign menu with its area, search, generator,
              // gear and the session chip together, has room to spare instead
              // of room to the pixel. The accessible name stays, so the
              // control is unchanged for a screen reader.
              className="hidden h-auto min-w-[3rem] shrink basis-[200px] gap-2 border-input bg-card px-3 py-1.5 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-card hover:text-soft max-xl:min-w-0 max-xl:basis-auto max-xl:px-2.5 sm:flex"
            >
              <Search
                aria-hidden
                size={15}
                className="flex-none text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate text-left max-xl:sr-only">
                {t("topbar.search")}
              </span>
              {/* The ⌘K HINT, not the shortcut: it steps aside with the
                  label, below xl, where the row is tight enough that the
                  settings gear would otherwise push it over. The shortcut
                  itself keeps working at every width. */}
              <span className="flex-none rounded-[4px] border border-input px-[5px] py-px font-mono text-[11px] text-muted-foreground max-xl:hidden">
                ⌘K
              </span>
            </Button>
            <CommandPalette
              campaign={campaign}
              open={searchOpen}
              onOpenChange={setSearchOpen}
            />
          </>
        )}

        {/* Quiet entry into the generator, next to the brass session button
            per the prototype — always on the chapter overview, and on every
            other campaign view while the campaign has a job, which it then
            carries: where it stands, and one click to where it is reviewed.
            Not in the live mode, which belongs to the running session, and
            not on the generator page, which shows the job itself. */}
        {campaign !== "" && !isLive && !isSettings && !isGenerate && (
          <GeneratorLink campaign={campaign} always={isChapterOverview} />
        )}

        {/* Instance settings — ONE gear, icon-only, following the generator
            entry's icon pattern. Icon-only at EVERY width on purpose: the
            topbar is tight and this is the least urgent thing on it, so it
            must not be able to grow the row. Its accessible name comes from
            aria-label. */}
        <SettingsLink campaign={campaign} active={isSettings} />

        {/* THE session control: ONE chip in ONE slot for EVERY state — start
            offer, running session, unknown status. Same position, same
            geometry; only content and colour change. */}
        {campaign !== "" && (
          <SessionChip
            campaign={campaign}
            session={live}
            state={sessionChipState({
              session,
              offersStart: isChapterOverview || isReadingView,
              showsError: isChapterOverview || isReadingView || isLive,
            })}
            mode={isLive ? "menu" : "link"}
          />
        )}

        {isReview && <ReviewProgress campaign={campaign} />}
      </header>
    </>
  );
}

/**
 * The generator entry and the campaign's job in ONE chip. On the chapter
 * overview it is always there — the way into the generator. On every other
 * campaign view it appears while the campaign has a job, so a run started on
 * a reading view is findable from anywhere: a dot for where the job stands,
 * the job in one sentence as its name and title, and a click lands where the
 * job is reviewed — an augment run at its row with the review open, any other
 * run on the generator page (generator-job/job-links.ts).
 *
 * It shares the generator route's query key, so there is no second poll
 * loop: one lookup when a campaign view mounts, then polling only while a job
 * is actually running.
 */
function GeneratorLink({ campaign, always }: { campaign: string; always: boolean }) {
  const t = useT();
  const { data } = useGenerateJob(campaign);
  const job = data ?? null;
  const target = augmentTarget(job);
  // The name of the augmented row, from the campaign tree (the same query
  // the search and the reference links share), asked only while an augment
  // run is there to name.
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: target !== undefined,
  });
  const state = jobState(job);
  const sentence = jobSentence(
    job,
    target === undefined ? "" : augmentTargetName(tree.data, target),
    t,
  );
  const running = state === "running";
  // A run the DM already took PART of is neither done nor running — it
  // is half applied, and the entry says how far it got so a
  // forgotten rest is findable from anywhere.
  // Counted against ALL parts of the run: while a
  // pipelined run is still going, only the finished parts have produced a
  // draft, so an accepted count over the finished parts alone would
  // contradict the progress count over all parts.
  const progress = acceptProgress(data);
  const partial = progress.written > 0 && progress.written < progress.total;
  const progressLabel = t("topbar.generator.progress", progress);
  // A PIPELINED run is both at once: parts are still going while
  // finished ones are already reviewable and acceptable. So the dot and the
  // progress are not exclusive — the chip shows what is true.
  const runProgress = pipelineProgress(data, t);
  const status = [sentence, runProgress].filter((part) => part !== undefined).join(" ");
  if (!always && state === undefined) return null;
  return (
    <Link
      to={job === null ? generatorHref(campaign) : jobHref(campaign, job)}
      title={
        status !== ""
          ? partial
            ? `${status} ${progressLabel}`
            : status
          : undefined
      }
      className={cn(
        buttonVariants({ variant: "outline" }),
        "h-auto flex-none gap-[7px] border-input bg-card px-3.5 py-[7px] text-[13px] font-normal text-soft hover:border-border-hover hover:bg-card hover:text-foreground [&_svg]:size-[15px]",
      )}
    >
      <Sparkles aria-hidden />
      {/* Below xl the row is tight: the label steps aside and the
          icon carries the entry — the accessible name stays either way. */}
      <span className="max-xl:sr-only">{t("topbar.generator")}</span>
      {state !== undefined && (
        <>
          {/* The dot says where the job stands: it pulses while the run is
              going (only where motion is welcome; otherwise it stands
              still), stands still once a proposal waits, and turns to the
              error colour when the run failed. */}
          <span
            aria-hidden
            className={cn(
              "size-1.5 flex-none rounded-full",
              state === "failed" ? "bg-destructive" : "bg-primary",
              running && "motion-safe:animate-pulse",
            )}
          />
          <span className="sr-only">{status}</span>
        </>
      )}
      {/* The progress number, and the width it is allowed to cost. A run that
          is BOTH running and half accepted (a pipelined one)
          carries the dot AND this label, which is ~90px the row cannot
          budget for: at 1280, where the full search chip and this chip's
          reserved width switch on, it would run the row over. So the pair is only spelled out from 2xl up; below
          that the dot carries the state and the number stays in the
          accessible name (and in the chip's `title`) — the same trade the
          label above makes below xl. */}
      {/* ONE element, whatever the width: `sr-only` takes the number off the
          row without taking it out of the accessible name, so no second,
          screen-reader-only copy is needed next to it — that would only
          double the chip's name (and its innerText) below the breakpoint. */}
      {partial && (
        <span
          className={cn(
            "text-[12px] text-muted-foreground",
            running ? "max-2xl:sr-only" : "max-xl:sr-only",
          )}
        >
          {progressLabel}
        </span>
      )}
    </Link>
  );
}

/**
 * The gear: `/settings`. Icon-only and always present — the
 * language lives behind it, and on a fresh instance (no campaign, no
 * campaign menu) it is the only settings entry there is. Same geometry as the
 * generator entry minus its label, so the row's width does not depend on it.
 *
 * WHICH CAMPAIGN the page shows its campaign half for travels ALONG, in
 * `?from=`: the campaign the DM was looking
 * at when they reached for the gear. `/settings` itself stays campaign-
 * independent — it has to work on a fresh instance — and without a campaign in
 * the URL the link carries nothing, so the page falls back to the same
 * heuristic "/" uses. A search param rather than `location.state`, so a
 * reload, a bookmark and the back button all keep the answer.
 */
function SettingsLink({
  campaign,
  active,
}: {
  campaign: string;
  active: boolean;
}) {
  const t = useT();
  return (
    <Link
      to={
        campaign === ""
          ? "/settings"
          : `/settings?from=${encodeURIComponent(campaign)}`
      }
      aria-label={t("settings.title")}
      title={t("settings.title")}
      aria-current={active ? "page" : undefined}
      className={cn(
        buttonVariants({ variant: "outline" }),
        "h-auto w-auto flex-none border-input bg-card px-2.5 py-[7px] text-soft hover:border-border-hover hover:bg-card hover:text-foreground [&_svg]:size-[15px]",
        // On `/settings` the gear IS the current view, marked by a full step
        // of contrast, no geometry change
        // (padding and border width stay identical, so nothing next to it
        // moves — the chrome must not shift at all).
        active && "border-border-hover text-foreground",
      )}
    >
      <Settings aria-hidden />
    </Link>
  );
}

/** The seen-of-total progress on the review view (prototype's isReview topbar). */
function ReviewProgress({ campaign }: { campaign: string }) {
  const review = useReviewCards(campaign);
  if (
    review.isPending ||
    review.noSession ||
    review.isError ||
    review.total === 0
  )
    return null;
  return (
    <div className="flex-none text-[13px] text-soft">
      {review.progressLabel}
    </div>
  );
}
