// The constant topbar (design reference: 56px, hairline below).
//
// THE CHROME IS GLOBAL AND STABLE. Every campaign-scoped
// view — chapter overview, browse lists, entry/scene, generator, review — shows the very
// same left block:
//
//     Grimoire │ campaign switcher: <name> ⌄ │ chapters · NPCs · locations
//
// Nothing appears, disappears or shifts when moving between them; the only
// difference is which nav entry is marked as the current section
// (lib/topbar-nav.ts). There are NO breadcrumbs in the topbar: one would
// repeat the campaign name the switcher already carries, compete with the nav
// next to it, and on an entry view claim a chapter path that is misleading for
// an NPC opened from the NPC list. Hierarchical context lives in the page
// header instead (components/PageContext.tsx) — where it belongs, next to the
// title it describes. The campaign name appears exactly ONCE in the chrome.
//
// ONE SESSION CHIP. The running session is a SINGLE chip in a fixed slot —
// right behind the campaign switcher, the same place on EVERY campaign-scoped
// route, /live included. The session draws it (session/SessionChip.tsx); the
// topbar only says where it sits and which state the route allows.
//
// Deviation from design/ (which keeps a separate live topbar): stability of
// the session control beats the prototype's two layouts. The
// live chapter label lives in the live view's own scene nav, next to the
// scenes it describes.
//
// The right side stays per-view: the ⌘K search chip (opens the palette;
// hidden without a campaign in the URL — "/" only ever shows the empty
// state), the session chip (one click starts a session and enters
// /campaigns/:campaign/live), the harvest progress on the
// review with a quiet chapter overview link into it while today's session
// still has unharvested entries, and the generator entry on the chapter
// overview with its run indicator.

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Plus, Search, Settings, Sparkles } from "lucide-react";
import { useState } from "react";
import {
  Link,
  matchPath,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";

import { fetchCampaigns } from "@/api";
import { CampaignCreateDialog } from "@/campaign/CampaignCreate";
import { CommandPalette } from "@/components/CommandPalette";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconLogo } from "@/icons";
import { useT } from "@/i18n";
import {
  campaignDescription,
  campaignLabel,
  settingsCampaign,
} from "@/lib/campaign";
import { locationsHref } from "@/location/location-links";
import { npcsHref } from "@/npc/npc-links";
import { navSection } from "@/lib/topbar-nav";
import { acceptProgress, pipelineProgress } from "@/generator-job/generator-job-state";
import { useGenerateJob } from "@/generator-job/generator-job-query";
import { cn } from "@/lib/utils";
import { useReviewCards } from "@/lib/use-review";
import { MobileSessionRow, SessionChip, sessionChipState } from "@/session/SessionChip";
import { reviewHref } from "@/session/session-links";
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
 * bar it sits on: the switcher, the nav trio, the search chip and the session
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
  // The two campaign-content pages. They are NOT in the nav trio
  // and must not be — but the bar above them is still
  // this campaign's bar, so the campaign has to be derived here too. Without
  // them the topbar goes blank on those pages: no switcher, no ⌘K, no gear.
  const knowledgeMatch = matchPath("/campaigns/:campaign/knowledge", pathname);
  const glossaryMatch = matchPath("/campaigns/:campaign/glossary", pathname);
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
    campaignOf(chapterOverviewMatch) ??
    (settingsFrom === "" ? undefined : settingsFrom) ??
    "";
  // These read their OWN match, not `campaign`: on `/settings` the campaign is
  // resolved from `?from=` (see above), so asking `campaign !== ""` would make
  // the settings page the chapter overview of that campaign, marking the
  // chapters entry and hanging the chapter overview's review and generator
  // entries into the row.
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
  const isChapterOverview = campaignOf(chapterOverviewMatch) !== undefined;

  const [searchOpen, setSearchOpen] = useState(false);

  // Which nav entry is the current view — the ONE thing that differs between
  // the campaign-scoped views. Route-derived, so it never lags behind a query.
  const isScenes = campaignOf(scenesMatch) !== undefined;
  const isNpcs = campaignOf(npcsMatch) !== undefined;
  const isLocations = campaignOf(locationsMatch) !== undefined;
  const section = navSection({
    isChapterOverview,
    isChapter,
    isScenes,
    isNpcs,
    isLocations,
  });

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
          (start-surface wordmark, back rows to the chapters); the topbar
          is desktop chrome there. Without a campaign in the URL ("/" with no
          campaign at all) it stays visible on every width, so the empty state
          is not a bare page. */}
      <header
        className={cn(
          // Gap: 14px is the designed rhythm, and it holds from 2xl up —
          // below that the SPACING gives way instead of any content
          // (nothing is hidden or truncated for it). Below lg
          // the row carries switcher, icon-only search, review count,
          // generator and gear with the search chip already at its floor; in
          // the lg–2xl band the nav trio, the full search chip, the long
          // start-session label and the review link with its open count
          // are all on the row at once, and at exactly 1280 (the xl edge,
          // where the trio, the full search and the chip's reserved width
          // switch on together) that band is the tightest width there is —
          // tight enough that CI's wider Linux glyphs push a 14px rhythm 2px
          // over while macOS rendering still clears it. 10px instead of 14px
          // across eight gaps hands the row ~32px, which is real reserve
          // rather than reserve to the pixel.
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

        {/* ONE campaign context for every campaign-scoped view: the switcher
            trigger, always the same element in the same place. There are no
            breadcrumbs next to it: one would spell the campaign name again
            and, on an entry, claim a chapter path that is plain misleading for
            an NPC opened from the NPC list. Hierarchical context lives in the
            page header (components/PageContext.tsx). */}
        {campaign !== "" && <CampaignSwitcher campaign={campaign} />}

        {/* Quiet campaign navigation: the three campaign-wide entry
            points, reachable without scrolling, from every campaign view. The
            design prototype does not cover this navigation — these links fill
            the gap per PO decision (design/README.md).
            The chapters link is the chapter overview — and the way BACK from everywhere: the
            campaign label next to it is the switcher trigger, not a link, and
            the wordmark is a detour via "/".
            Not in the live mode: that view belongs to the running session
            (design/README.md). Below lg the row is already carrying switcher,
            session chip and search, so the links step aside there — mobile has
            the start surface's lookup list, and ⌘K finds both lists at
            any width. */}
        {campaign !== "" && !isLive && (
          <nav
            // Deliberately NOT named after the mobile lookup nav: that label
            // belongs to the mobile start surface, and on the chapter overview
            // both live in the DOM at once (responsive swap) — two navs with
            // one name is a worse tree.
            aria-label={t("topbar.nav.aria")}
            className="flex flex-none items-center gap-1 border-l border-border pl-3 text-[13px] max-lg:hidden"
          >
            {/* The section of the current view carries aria-current and the
                stronger tone (lib/topbar-nav.ts). It is the ONLY thing that
                differs between the campaign-scoped views, so it is a full step
                of contrast, not a hint. Generator and review belong to no
                section and mark nothing. */}
            <TopbarNavLink
              to={`/campaigns/${campaign}`}
              label={t("topbar.nav.chapters")}
              active={section === "chapters"}
            />
            <TopbarNavLink
              to={npcsHref(campaign)}
              label={t("topbar.nav.npcs")}
              active={section === "npcs"}
            />
            <TopbarNavLink
              to={locationsHref(campaign)}
              label={t("topbar.nav.locations")}
              active={section === "locations"}
            />
          </nav>
        )}

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
              // Below XL it goes ICON-ONLY: at 1024px the nav trio, the full
              // search and the chip's reserved width would otherwise switch
              // on ALL AT ONCE, and the row would clear that step by single
              // digits — on CI's wider font metrics not at all. So the
              // elastic element shrinks one
              // breakpoint EARLIER and the band from lg to xl, which carries
              // switcher, nav trio, search, review link, generator and gear
              // together, has room to spare instead of room to the pixel.
              // The accessible name stays, so the control is unchanged for a
              // screen reader.
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

        {/* Quiet review affordance — only while the harvested session still
            has unharvested entries; otherwise nothing is shown.
            "The harvested session" is the server's last STARTED one, the same
            entry the review page works on: after a session that ran past
            midnight, today's date names no entry at all. */}
        {isChapterOverview && <ChapterOverviewReviewLink campaign={campaign} />}

        {/* Quiet entry into the generator — chapter overview only, next to the brass
            session button per the prototype. Carries the run indicator. */}
        {isChapterOverview && <GeneratorLink campaign={campaign} />}

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
 * One quiet link of the topbar's campaign navigation (chapters, NPCs,
 * locations), marked when it is the view currently open. The caller decides what
 * "current" means — the chapter overview and the two lists are matched differently.
 *
 * The marking is COLOUR ONLY (full contrast step: body-secondary ->
 * foreground). A heavier weight would reflow the row and move the other two
 * links, and this navigation's whole point is that nothing shifts between the
 * three views.
 */
function TopbarNavLink({
  to,
  label,
  active,
}: {
  to: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-1.5 py-1 hover:text-foreground",
        active ? "text-foreground" : "text-body-secondary",
      )}
    >
      {label}
    </Link>
  );
}

/**
 * The chapter overview's generator entry — with a quiet run indicator while a generate
 * job is working. It shares the generator route's query key,
 * so there is no second poll loop: one lookup when the chapter overview mounts, then
 * polling only while a job is actually running.
 */
function GeneratorLink({ campaign }: { campaign: string }) {
  const t = useT();
  const { data } = useGenerateJob(campaign);
  const running = data?.status === "running";
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
  return (
    <Link
      to={`/campaigns/${campaign}/generate`}
      title={
        running
          ? (runProgress ?? t("topbar.generator.running"))
          : partial
            ? progressLabel
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
      {running && (
        <>
          {/* Pulses only where motion is welcome; otherwise a static dot
              carries the same information. */}
          <span
            aria-hidden
            className="size-1.5 flex-none rounded-full bg-primary motion-safe:animate-pulse"
          />
          <span className="sr-only">{runProgress ?? t("topbar.generator.running")}</span>
        </>
      )}
      {/* The progress number, and the width it is allowed to cost. A run that
          is BOTH running and half accepted (a pipelined one)
          carries the dot AND this label, which is ~90px the row cannot
          budget for: at 1280, where the nav trio, the full search chip and
          this chip's reserved width all switch on at once, that runs the row
          over by 50px. So the pair is only spelled out from 2xl up; below
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
 * switcher) it is the only settings entry there is. Same geometry as the
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
        // On `/settings` the gear IS the current view, marked the way the nav
        // trio marks its section: a full step of contrast, no geometry change
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

/** Chapter overview affordance into the review: only when the harvested session (the
 *  server's last started one) still has entries — nothing to see otherwise. */
function ChapterOverviewReviewLink({ campaign }: { campaign: string }) {
  const t = useT();
  const review = useReviewCards(campaign);
  if (
    review.isPending ||
    review.noSession ||
    review.isError ||
    review.pendingCount === 0
  ) {
    return null;
  }
  // Below xl the row carries switcher, search (already at its floor),
  // generator, gear and the session chip with nothing elastic left: at 768
  // and at 1024 the full label would push the chip OVER the right padding and
  // off the viewport. The label steps down to the
  // count, which is the news; the accessible name stays the full sentence at
  // every width, so nothing changes for a screen reader.
  const label = t("topbar.review.pending", { count: review.pendingCount });
  return (
    <Link
      to={reviewHref(campaign)}
      aria-label={label}
      className="flex-none rounded-md px-1.5 py-1 text-[13px] text-body-secondary hover:text-foreground"
    >
      <span className="max-xl:hidden">{label}</span>
      <span aria-hidden className="xl:hidden">
        {t("topbar.review.pendingShort", { count: review.pendingCount })}
      </span>
    </Link>
  );
}

/**
 * The switcher is also where a SECOND campaign is created. The cold start
 * covers the FIRST one; without this the menu would be a read-only list and a
 * second campaign would have no entry point in the UI at all. So the menu ends
 * with a quiet create-campaign entry that opens the shared create dialog
 * (components/CreateActions.tsx) and navigates into the new campaign.
 *
 * The menu says nothing about WHERE campaigns are stored: a shell command is
 * developer jargon, `grimoire seed` belongs in README.md/docs/DEPLOYMENT.md,
 * and storage is not a question this menu has to answer while switching
 * between campaigns.
 */
function CampaignSwitcher({ campaign }: { campaign: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
  });
  const current = campaignLabel(
    (data ?? []).find((c) => c.id === campaign),
    campaign,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "ghost" }),
          // flex-none: the campaign context is the anchor of the topbar and
          // its width must not depend on what the right-hand side happens to
          // carry (otherwise the chapter overview's Generator link makes the name shorter
          // there than on a list — the chrome has to be identical on every
          // route). A very long name truncates at max-w-[280px] with an
          // ellipsis instead of pushing the row over; the elastic
          // element of the row is the search chip below.
          "h-auto min-w-0 flex-none gap-[7px] rounded-md border border-transparent px-2.5 py-[5px] text-[13px] font-normal text-body-secondary hover:border-input hover:bg-transparent hover:text-foreground",
        )}
      >
        {/* Truncates with an ellipsis rather than pushing the row over,
            and one step harder per tightening of the row: below
            xl it also carries the chapters · npcs · locations trio, and below lg
            the search chip has already reached its floor, so the name is the
            last thing that can still give way there. The full name is one
            click away in the menu below.
            The xl cap is 160px, not 280: at exactly
            1280 the FULLEST row — switcher, nav trio, search, the review
            link, generator, gear and the start-session chip with its
            reserved 8.5rem — has only the search chip's ~50px of shrink left,
            and CI's wider Linux font metrics eat more than that. A static cap
            keeps the chrome identical on every route (that is why the trigger
            is flex-none) while handing the row 120px more slack; from 2xl the
            row is wide enough for the full 280 again. The two caps below it
            step down by the same logic (7rem / 8.5rem).
            Note that the SEARCH chip's `basis` is deliberately NOT part of
            this: it is the elastic element, so a smaller basis only moves
            width from the chip to the free space in the middle of the row and
            changes what the row can absorb by exactly nothing. Reserve comes
            from the flex-none parts — these caps and the gaps. */}
        <span className="min-w-0 max-w-[7rem] truncate lg:max-w-[8.5rem] xl:max-w-[160px] 2xl:max-w-[280px]">
          {t("campaign.switcher.current", { name: current })}
        </span>
        <ChevronDown
          aria-hidden
          size={14}
          className="flex-none text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[290px]">
        {/* Name over description — the prototype's campaignRows (name + meta);
            the id never shows up, it only lives in the URL. */}
        {(data ?? []).map((c) => (
          <DropdownMenuItem
            key={c.id}
            onSelect={() => void navigate(`/campaigns/${c.id}`)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-foreground">
                {campaignLabel(c, c.id)}
              </span>
              {campaignDescription(c) !== undefined && (
                <span className="mt-px block truncate text-[11.5px] text-muted-foreground">
                  {campaignDescription(c)}
                </span>
              )}
            </span>
            {c.id === campaign && (
              <Check
                aria-hidden
                size={13}
                className="flex-none text-success-text"
              />
            )}
          </DropdownMenuItem>
        ))}
        {data !== undefined && data.length === 0 && (
          <p className="px-2.5 py-[9px] text-[13px] text-muted-foreground">
            {t("campaign.switcher.empty")}
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          // The dialog must not mount inside the menu: Radix unmounts the
          // content on select, which would take the dialog with it.
          onSelect={() => setCreateOpen(true)}
          className="gap-2 text-[13px] text-body-secondary"
        >
          <Plus
            aria-hidden
            size={13}
            className="flex-none text-muted-foreground"
          />
          {t("create.campaign.title")}
        </DropdownMenuItem>
      </DropdownMenuContent>
      {createOpen && (
        <CampaignCreateDialog onClose={() => setCreateOpen(false)} />
      )}
    </DropdownMenu>
  );
}
