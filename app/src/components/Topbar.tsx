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
// ONE SESSION CHIP. The running session is a SINGLE chip
// (SessionChip) in a fixed slot — right behind the campaign switcher, the
// same place on EVERY campaign-scoped route, /live included:
//
//     Grimoire │ campaign switcher: <name> ⌄ │ ● 0:12:33 │ chapters · NPCs · locations
//
// The chip is the state: brass/amber (the accent token) means "a session is
// running", so there is no "Live" label to read. It carries the running
// time as H:MM:SS, ticking every second — a coarser tick looks frozen, which
// is the one thing a live clock must not do.
// Off /live a click on it navigates back into the session; ON /live it opens
// a small menu with the three session actions (pause/resume — which really
// stops and restarts the runtime —, end, discard —
// the last only while the session is still empty). Below md,
// where the topbar is not the chrome, the very same chip sits in its own slim
// row (in link mode: there is no mobile live mode), so a session is never
// invisible and never moves.
//
// Consequence: the start action appears NOWHERE while a session is running —
// there is nothing to start, only something to return to. What "running"
// means is the server's answer (GET /campaigns/:campaign/session), not a date the app
// computes: a session that goes past midnight stays the running one.
//
// Deviation from design/ (which keeps a separate live topbar): stability of
// the session control beats the prototype's two layouts. The
// live chapter label lives in the live view's own scene nav, next to the
// scenes it describes.
//
// ONE CHIP FOR EVERY SESSION STATE. The chip
// is not only the running session's control — it is THE session control, in
// the same slot, with the same geometry, in every state: it offers the start
// action while nothing runs, shows the ticking clock while one does, and reads
// an unknown-status label, dimmed and inert, when the session lookup failed.
// There is no separate brass start button and no bare unknown-status sentence;
// only content and colour change, so nothing in the chrome moves when the
// state does.
//
// The right side stays per-view: the ⌘K search chip (opens the palette;
// hidden without a campaign in the URL — "/" only ever shows the empty
// state), the session chip (one click starts a session and enters
// /campaigns/:campaign/live), the harvest progress on the
// review with a quiet chapter overview link into it while today's session
// still has unharvested entries, and the generator entry on the chapter
// overview with its run indicator.

import type { EntryResponse } from "@grimoire/shared/types";
import { isSessionEmpty } from "@grimoire/shared/session-state";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Link,
  matchPath,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";

import {
  continueSession,
  endSession,
  fetchCampaigns,
  fetchTree,
  pauseSession,
} from "@/api";
import { CommandPalette } from "@/components/CommandPalette";
import { CampaignCreateDialog } from "@/components/CreateActions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { sessionElapsedLabel, sessionIsPaused } from "@/lib/session";
import { navSection } from "@/lib/topbar-nav";
import { acceptProgress, pipelineProgress } from "@/lib/generate";
import { useGenerateJob } from "@/lib/use-generate-job";
import { cn } from "@/lib/utils";
import { useReviewEntries } from "@/lib/use-review";
import {
  useActiveSession,
  useSessionDiscard,
  useSessionStartFlow,
  useSessionWrite,
} from "@/lib/use-session";

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
  const sceneMatch = matchPath("/campaigns/:campaign/entries/*", pathname);
  const liveMatch = matchPath("/campaigns/:campaign/live", pathname);
  const reviewMatch = matchPath("/campaigns/:campaign/review", pathname);
  const generateMatch = matchPath("/campaigns/:campaign/generate", pathname);
  const listMatch = matchPath("/campaigns/:campaign/list/*", pathname);
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
    campaignOf(sceneMatch) ??
    campaignOf(liveMatch) ??
    campaignOf(reviewMatch) ??
    campaignOf(generateMatch) ??
    campaignOf(listMatch) ??
    campaignOf(knowledgeMatch) ??
    campaignOf(glossaryMatch) ??
    campaignOf(chapterOverviewMatch) ??
    (settingsFrom === "" ? undefined : settingsFrom) ??
    "";
  const filePath = sceneMatch?.params["*"] ?? "";
  // These read their OWN match, not `campaign`: on `/settings` the campaign is
  // resolved from `?from=` (see above), so asking `campaign !== ""` would make
  // the settings page the chapter overview of that campaign, marking the
  // chapters entry and hanging the chapter overview's review and generator
  // entries into the row.
  const isScene = campaignOf(sceneMatch) !== undefined && filePath !== "";
  const isLive = campaignOf(liveMatch) !== undefined;
  const isReview = campaignOf(reviewMatch) !== undefined;
  const isChapterOverview = campaignOf(chapterOverviewMatch) !== undefined;
  const listKind = listMatch?.params["*"] ?? "";

  const [searchOpen, setSearchOpen] = useState(false);

  // Which nav entry is the current view — the ONE thing that differs between
  // the campaign-scoped views. Route-derived, so it never lags behind a query.
  const section = navSection({ isChapterOverview, listKind, filePath });

  // The running session — asked on EVERY campaign route now, not just /live:
  // one shared query key, so this is one request for topbar and live view.
  const session = useActiveSession(campaign, campaign !== "");
  const live = session.data ?? undefined;

  return (
    <>
      {/* Below md the topbar is hidden — the running session must not be, so
          the same chip gets its own slim row there. */}
      {live !== undefined && campaign !== "" && (
        <MobileSessionRow campaign={campaign} session={live} />
      )}
      {/* Below md the campaign-scoped views carry their own mobile chrome
          (start-surface wordmark, "‹ Kapitel" back rows); the topbar
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
            "Kapitel" is the chapter overview — and the way BACK from everywhere: the
            campaign label next to it is the switcher trigger, not a link, and
            the wordmark is a detour via "/".
            Not in the live mode: that view belongs to the running session
            (design/README.md). Below lg the row is already carrying switcher,
            session chip and search, so the links step aside there — mobile has
            the start surface's "Nachschlagen" list, and ⌘K finds both lists at
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
              to={`/campaigns/${campaign}/list/npcs`}
              label={t("topbar.nav.npcs")}
              active={section === "npcs"}
            />
            <TopbarNavLink
              to={`/campaigns/${campaign}/list/locations`}
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
              offersStart: isChapterOverview || isScene,
              showsError: isChapterOverview || isScene || isLive,
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
 * The running time of the session as `H:MM:SS`, re-rendered every second.
 *
 * Every epoch reading comes from the SERVER (lib/session.ts): the format
 * is zone-less, so a browser in another timezone than the server would
 * otherwise show a runtime that is hours off. PAUSED time is deducted and the
 * clock STANDS while a pause runs — the number on the chip is the time
 * played, which is what makes a pause mean something. An ENDED session freezes
 * at its `ended` (the chip is gone by then, but a cache race must not tick
 * backwards).
 */
function useElapsedLabel(session: EntryResponse): string | undefined {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return sessionElapsedLabel(session, nowMs);
}

/**
 * The chip's GEOMETRY — identical in every state: same slot, same height,
 * same radius, same paddings, same font size.
 * Only the colours below and the content inside change, so the switch from
 * the start action to the running clock never makes the topbar jump. From
 * xl up a minimum width holds the states at a comparable size; below that the
 * row is too tight to reserve width (reserving from lg, which is exactly where
 * the nav trio appears, leaves the row no slack on CI's wider font metrics),
 * and the clock's tabular numbers alone keep
 * a second's tick from re-flowing anything.
 */
const SESSION_CHIP_BASE =
  "inline-flex min-h-8 flex-none items-center justify-center gap-2 rounded-full border px-3 py-[3px] text-[13px] xl:min-w-[8.5rem] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** Tone per state — the colour IS the state, never the only information. */
const SESSION_CHIP_TONE = {
  // The invitation: the brass accent, the strongest tone in the chrome.
  start:
    "border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary-hover hover:border-primary-hover",
  // A session is running: brass, but quiet — nothing to decide, just present.
  running:
    "border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-primary hover:border-primary hover:bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] hover:text-primary-hover",
  // Paused: the SAME chip, dimmed — the session has not gone
  // anywhere, it just does not count right now. Muted instead of brass, so
  // running and paused are told apart at a glance; the standing clock and
  // the aria-label carry the state itself.
  paused:
    "border-input bg-transparent text-muted-foreground hover:border-border hover:text-body-secondary",
  // The query failed: dimmed and inert — it is neither live nor an offer.
  error: "border-input bg-transparent text-muted-foreground",
} as const;

/** Which of the chip's states the session query puts it in. */
type SessionChipState = "hidden" | "start" | "running" | "error";

/**
 * The chip's state, straight from the server's answer — and from nothing
 * else:
 *
 *   running — a session came back, ended or not decided by the server.
 *   start   — EXACTLY the answer `null` ("nothing running"). Never while the
 *             query is pending (the chip would flash an offer into a running
 *             session) and never when it failed.
 *   error   — the query failed. Without it a broken lookup looks exactly
 *             like "nothing running", and the chrome offers a start that
 *             cannot work.
 *   hidden  — pending, or a route that offers neither.
 */
function sessionChipState({
  session,
  offersStart,
  showsError,
}: {
  session: { data: EntryResponse | null | undefined; isError: boolean };
  offersStart: boolean;
  showsError: boolean;
}): SessionChipState {
  if (session.data !== undefined && session.data !== null) return "running";
  if (session.isError) return showsError ? "error" : "hidden";
  if (session.data === null) return offersStart ? "start" : "hidden";
  return "hidden";
}

/**
 * The brass dot: it pulses only where motion is welcome (quality floor). While
 * the session is PAUSED it stops pulsing and loses the accent — a standing
 * clock next to a pulsing dot would read as "still counting".
 */
function SessionDot({ paused = false }: { paused?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-[7px] flex-none rounded-full",
        paused ? "bg-muted-foreground" : "bg-primary motion-safe:animate-pulse",
      )}
    />
  );
}

/**
 * THE session control: ONE chip, one slot, every state. The element stays;
 * only what it says and which colour it wears change:
 *
 *   start   — the start action. One click starts a NEW session and enters
 *             /live; there is no resume action.
 *   running — dot + H:MM:SS. Off /live a click goes back into the session;
 *             ON /live it opens the session actions (pause, end, and discard
 *             while the session is still empty), which as three separate
 *             topbar buttons would overflow the row at medium widths.
 *   error   — an unknown-status label, dimmed and inert. Neither live nor an
 *             offer, and it costs the row no second element.
 *
 * The accessible name always carries the STATE plus the running time — the
 * colour alone is not information.
 */
function SessionChip({
  campaign,
  session,
  state,
  mode,
}: {
  campaign: string;
  session: EntryResponse | undefined;
  state: SessionChipState;
  mode: "link" | "menu";
}) {
  const t = useT();
  if (state === "hidden") return null;
  if (state === "error") {
    return (
      <span
        role="status"
        aria-label={t("session.status.unknown.aria")}
        data-session-chip="error"
        className={cn(SESSION_CHIP_BASE, SESSION_CHIP_TONE.error)}
      >
        {t("session.status.unknown")}
      </span>
    );
  }
  if (state === "start" || session === undefined) {
    return <SessionStartChip campaign={campaign} />;
  }
  return (
    <SessionRunningChip campaign={campaign} session={session} mode={mode} />
  );
}

/** The running states of the chip — link off /live, menu on it. */
function SessionRunningChip({
  campaign,
  session,
  mode,
}: {
  campaign: string;
  session: EntryResponse;
  mode: "link" | "menu";
}) {
  const t = useT();
  const elapsed = useElapsedLabel(session);
  // The state is part of the accessible name — the dimmed colour alone is not
  // information (quality floor).
  const paused = sessionIsPaused(session);
  const state = t(paused ? "session.state.paused" : "session.state.running");
  const label =
    elapsed === undefined
      ? state
      : t("session.state.withElapsed", { state, elapsed });

  if (mode === "link") {
    return (
      <Link
        to={`/campaigns/${campaign}/live`}
        aria-label={t("session.chip.link.aria", { label })}
        data-session-chip={paused ? "paused" : "running"}
        className={cn(
          SESSION_CHIP_BASE,
          paused ? SESSION_CHIP_TONE.paused : SESSION_CHIP_TONE.running,
        )}
      >
        <SessionDot paused={paused} />
        <span className="font-mono tabular-nums">
          {elapsed ??
            t(paused ? "session.short.paused" : "session.short.running")}
        </span>
      </Link>
    );
  }
  return (
    <SessionMenuChip
      campaign={campaign}
      session={session}
      label={label}
      elapsed={elapsed}
      paused={paused}
    />
  );
}

/**
 * The chip in its start state: starts a NEW session and navigates to the live
 * mode. ONE click, always, and always the same label — ending a session is
 * final, so a start after an ended evening opens the next session of the day
 * instead of re-opening the closed one. There is no resume action.
 *
 * A start can still answer 409 `session_running` — an OLDER session was never
 * ended. The live view is the place that asks about it, so the click
 * navigates there.
 */
function SessionStartChip({ campaign }: { campaign: string }) {
  const t = useT();
  const navigate = useNavigate();
  const toLive = () => void navigate(`/campaigns/${campaign}/live`);
  const { enter, entering, conflict, failed } = useSessionStartFlow(
    campaign,
    toLive,
  );
  const label = t("session.start");
  return (
    <button
      type="button"
      disabled={entering}
      aria-label={label}
      data-session-chip="start"
      onClick={() => {
        if (conflict === "session_running") toLive();
        else enter();
      }}
      title={
        failed
          ? t("session.start.failed")
          : conflict === "session_running"
            ? t("session.start.olderRunning")
            : undefined
      }
      className={cn(
        SESSION_CHIP_BASE,
        SESSION_CHIP_TONE.start,
        "disabled:pointer-events-none disabled:opacity-60",
      )}
    >
      <Play aria-hidden size={13} className="flex-none fill-current" />
      {label}
    </button>
  );
}

/**
 * The chip in menu mode. The discard confirmation lives OUTSIDE the menu
 * (Radix closes the menu on select), so its dialog state sits here.
 */
function SessionMenuChip({
  campaign,
  session,
  label,
  elapsed,
  paused,
}: {
  campaign: string;
  session: EntryResponse;
  label: string;
  elapsed: string | undefined;
  paused: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [discardOpen, setDiscardOpen] = useState(false);
  // ONE entry, two directions: the pause endpoints open and
  // close a `pauses` interval in the session — the log line comes with it, and
  // the runtime really stops instead of only being annotated.
  const pause = useSessionWrite(campaign, () =>
    paused ? continueSession(campaign) : pauseSession(campaign),
  );
  // Ending a session leads into the review, not back to the chapter overview
  // (prototype: endSession → review) — the harvest is the next step.
  const end = useSessionWrite(
    campaign,
    () => endSession(campaign),
    () => void navigate(`/campaigns/${campaign}/review`),
  );
  const busy = pause.isPending || end.isPending;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("session.chip.menu.aria", { label })}
          disabled={busy}
          data-session-chip={paused ? "paused" : "running"}
          className={cn(
            SESSION_CHIP_BASE,
            paused ? SESSION_CHIP_TONE.paused : SESSION_CHIP_TONE.running,
          )}
        >
          <SessionDot paused={paused} />
          <span className="font-mono tabular-nums">
            {elapsed ??
              t(paused ? "session.short.paused" : "session.short.running")}
          </span>
          <ChevronDown aria-hidden size={13} className="flex-none opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[210px] text-[13px]">
          <DropdownMenuItem onSelect={() => pause.mutate()}>
            {paused ? (
              <Play
                aria-hidden
                size={14}
                className="flex-none text-muted-foreground"
              />
            ) : (
              <Pause
                aria-hidden
                size={14}
                className="flex-none text-muted-foreground"
              />
            )}
            {t(paused ? "session.menu.continue" : "session.menu.pause")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => end.mutate()}>
            <Square
              aria-hidden
              size={14}
              className="flex-none text-muted-foreground"
            />
            {t("session.menu.end")}
          </DropdownMenuItem>
          {/* Only while the session is EMPTY — the mis-click's undo, gone
              the moment the evening has content. */}
          {isSessionEmpty(session.properties, session.body) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-muted-foreground"
                onSelect={() => setDiscardOpen(true)}
              >
                <Trash2 aria-hidden size={14} className="flex-none" />
                {t("session.menu.discard")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {(pause.isError || end.isError) && (
        <span className="flex-none text-[12.5px] text-destructive">
          {t("session.write.failed")}
        </span>
      )}
      <DiscardSessionDialog
        campaign={campaign}
        open={discardOpen}
        onOpenChange={setDiscardOpen}
      />
    </>
  );
}

/**
 * Below md the topbar is not the chrome, so the session gets
 * its own slim row — carrying the very SAME chip, in link mode: there is no
 * mobile live mode (UI-BRIEF §4), so the way back into the session is the only
 * action mobile needs. Mobile is for looking things up and throwing ideas in,
 * and this is exactly the way back out of a lookup.
 */
function MobileSessionRow({
  campaign,
  session,
}: {
  campaign: string;
  session: EntryResponse;
}) {
  const t = useT();
  return (
    <div className="flex min-h-11 flex-none items-center gap-2.5 border-b border-border bg-panel-deep px-4 md:hidden">
      <SessionChip
        campaign={campaign}
        session={session}
        state="running"
        mode="link"
      />
      <span className="ml-auto text-[13px] text-body-secondary">
        {t("topbar.session.back")}
      </span>
    </div>
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
 * The discard action: deletes the session that has nothing in it — the undo
 * of a start that was a mis-click. It lives in the session menu (last entry,
 * dimmed), below the end action, which stays THE way out of a session that
 * happened.
 *
 * It deletes a session, so it asks first. The confirmation names the consequence
 * instead of asking for a bare yes/no — that is the only thing worth reading here.
 * After the discard nothing is live any more, so the chapter overview is where the DM
 * lands (the live route without a session would only show its empty state).
 */
function DiscardSessionDialog({
  campaign,
  open,
  onOpenChange,
}: {
  campaign: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const discard = useSessionDiscard(campaign, () => {
    onOpenChange(false);
    void navigate(`/campaigns/${campaign}`);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("session.discard.title")}</DialogTitle>
        <DialogDescription>
          {t("session.discard.description")}
        </DialogDescription>
        {discard.isError && (
          <p className="mt-3 text-[12.5px] text-destructive">
            {t("session.discard.failed")}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={discard.isPending}
            onClick={() => discard.mutate()}
            className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
          >
            {t("common.discard")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  // progress are no longer exclusive — the chip shows what is true.
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
  const review = useReviewEntries(campaign);
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
  const review = useReviewEntries(campaign);
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
      to={`/campaigns/${campaign}/review`}
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
            xl it also carries the "Kapitel · NPCs · Orte" trio, and below lg
            the search chip has already reached its floor, so the name is the
            last thing that can still give way there. The full name is one
            click away in the menu below.
            The xl cap is 160px, not 280: at exactly
            1280 the FULLEST row — switcher, nav trio, search, the review
            link, generator, gear and the "Session starten" chip with its
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
