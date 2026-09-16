// The constant topbar (design reference: 56px, hairline below).
//
// THE CHROME IS GLOBAL AND STABLE (PO rework of PR #35). Every campaign-scoped
// view — pool, browse lists, entry/scene, generator, review — shows the very
// same left block:
//
//     Grimoire │ Kampagne: <name> ⌄ │ Kapitel · NPCs · Orte
//
// Nothing appears, disappears or shifts when moving between them; the only
// difference is which nav entry is marked as the current section
// (lib/topbar-nav.ts). There are NO breadcrumbs in the topbar any more. The
// three it used to have (scene, list, generator) each repeated the campaign
// name the switcher already carries, competed with the nav next to them, and
// on an entry view claimed a chapter path that was misleading for an NPC opened
// from the NPC list. Hierarchical context now lives in the page header instead
// (components/PageContext.tsx) — where it belongs, next to the title it
// describes. The campaign name appears exactly ONCE in the chrome.
//
// ONE SESSION CHIP (PO feedback on issue #40, overflow issue #50). The
// running session used to be spread over six controls whose set and order
// changed with the route: a green "Live" pill, a separate elapsed timer,
// Pause, "Session beenden", "Session verwerfen", and a mobile LiveBar of its
// own. At medium widths that row simply ran over. It is now a SINGLE chip
// (SessionChip) in a fixed slot — right behind the campaign switcher, the
// same place on EVERY campaign-scoped route, /live included:
//
//     Grimoire │ Kampagne: <name> ⌄ │ ● 0:12:33 │ Kapitel · NPCs · Orte
//
// The chip is the state: brass/amber (the accent token) means "a session is
// running", so there is no "Live" label left to read. It carries the running
// time as H:MM:SS, ticking every second — the 15s tick of the minutes-only
// readout looked frozen, which is the one thing a live clock must not do.
// Off /live a click on it navigates back into the session; ON /live it opens
// a small menu with the three session actions (Pause/Weiter — which really
// stops and restarts the runtime, issue #40 AK8 —, beenden, verwerfen —
// the last only while the session is still empty, issue #40 AK7). Below md,
// where the topbar is not the chrome, the very same chip sits in its own slim
// row (in link mode: there is no mobile live mode), so a session is never
// invisible and never moves.
//
// Consequence: "Session starten" appears NOWHERE while a session is running —
// there is nothing to start, only something to return to. What "running"
// means is the server's answer (GET /:campaign/session), not a date the app
// computes: a session that goes past midnight stays the running one.
//
// Deviation from design/ (which keeps a separate live topbar) per PO decision
// — stability of the session control beats the prototype's two layouts. The
// live chapter label moved into the live view's own scene nav, next to the
// scenes it describes.
//
// ONE CHIP FOR EVERY SESSION STATE (PO requirement on issue #40). The chip
// is not only the running session's control — it is THE session control, in
// the same slot, with the same geometry, in every state: it offers "Session
// starten" while nothing runs, shows the ticking clock
// while one does, and reads "Status unbekannt", dimmed and inert, when the
// session lookup failed. The separate brass start button and the bare
// "Session-Status unbekannt" sentence are gone; only content and colour
// change, so nothing in the chrome moves when the state does.
//
// The right side stays per-view: the ⌘K search chip (opens the palette;
// hidden without a campaign in the URL — "/" only ever shows the empty
// state), the session chip (issue #9: one click starts a session and enters
// /:campaign/live), the harvest progress on the
// review (issue #10) with a quiet pool link into it while today's session
// still has unharvested entries, and the "Generator" on the pool (issue #12)
// with its run indicator (issue #19).

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
import { NON_CAMPAIGN_SEGMENTS } from "@/lib/routes";
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

/**
 * The campaign of a `matchPath` result, or undefined when the segment is a
 * ROUTE and not a campaign id (`lib/routes.ts` — App.tsx and this heuristic
 * read the same list). React Router itself ranks the static route higher and
 * renders the right page; only this heuristic has to be told.
 */
function campaignOf(
  match: { params: { campaign?: string } } | null,
): string | undefined {
  const id = match?.params.campaign;
  if (id === undefined || NON_CAMPAIGN_SEGMENTS.has(id)) return undefined;
  return id;
}

/**
 * `/settings` KEEPS THE CAMPAIGN CHROME (PO feedback on PR #83).
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
  const sceneMatch = matchPath("/:campaign/entry/*", pathname);
  const liveMatch = matchPath("/:campaign/live", pathname);
  const reviewMatch = matchPath("/:campaign/review", pathname);
  const generateMatch = matchPath("/:campaign/generate", pathname);
  const listMatch = matchPath("/:campaign/list/*", pathname);
  // The two campaign-content pages (issue #53). They are NOT in the nav trio
  // and must not be (PO feedback on PR #87) — but the bar above them is still
  // this campaign's bar, so the campaign has to be derived here too. Without
  // them the topbar went blank on those pages: no switcher, no ⌘K, no gear.
  const knowledgeMatch = matchPath("/:campaign/knowledge", pathname);
  const glossaryMatch = matchPath("/:campaign/glossary", pathname);
  const poolMatch = matchPath("/:campaign", pathname);
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
    campaignOf(poolMatch) ??
    (settingsFrom === "" ? undefined : settingsFrom) ??
    "";
  const filePath = sceneMatch?.params["*"] ?? "";
  // These read their OWN match, not `campaign`: on `/settings` the campaign is
  // resolved from `?from=` (see above), and `/:campaign` matches "/settings"
  // itself — asking `campaign !== ""` would make the settings page the POOL of
  // that campaign, marking "Kapitel" and hanging the pool's review and
  // generator entries into the row.
  const isScene = campaignOf(sceneMatch) !== undefined && filePath !== "";
  const isLive = campaignOf(liveMatch) !== undefined;
  const isReview = campaignOf(reviewMatch) !== undefined;
  const isPool = campaignOf(poolMatch) !== undefined;
  const listKind = listMatch?.params["*"] ?? "";

  const [searchOpen, setSearchOpen] = useState(false);

  // Which nav entry is the current view — the ONE thing that differs between
  // the campaign-scoped views. Route-derived, so it never lags behind a query.
  const section = navSection({ isPool, listKind, filePath });

  // The running session — asked on EVERY campaign route now, not just /live:
  // one shared query key, so this is one request for topbar and live view.
  const session = useActiveSession(campaign, campaign !== "");
  const live = session.data ?? undefined;

  return (
    <>
      {/* Below md the topbar is hidden — the running session must not be
          (issue #40 AK2), so the same chip gets its own slim row there. */}
      {live !== undefined && campaign !== "" && (
        <MobileSessionRow campaign={campaign} session={live} />
      )}
      {/* Below md the campaign-scoped views carry their own mobile chrome
          (start-surface wordmark, "‹ Pool" back rows — issue #11); the topbar
          is desktop chrome there. Without a campaign in the URL ("/" with no
          campaign at all) it stays visible on every width, so the empty state
          is not a bare page. */}
      <header
        className={cn(
          // Gap: 14px is the designed rhythm, and it holds from 2xl up —
          // below that the SPACING gives way instead of any content (issue
          // #69 CI finding; nothing is hidden or truncated for it). Below lg
          // the row carries switcher, icon-only search, review count,
          // generator and gear with the search chip already at its floor; in
          // the lg–2xl band the nav trio, the full search chip, the long
          // "Session starten" label and the "Nachbereitung · N offen" link
          // are all on the row at once, and at exactly 1280 (the xl edge,
          // where the trio, the full search and the chip's reserved width
          // switch on together) that band was the tightest width there is:
          // CI's wider Linux glyphs pushed it 2px over while macOS rendering
          // still cleared it. 10px instead of 14px across eight gaps hands
          // the row ~32px, which is real reserve rather than reserve to the
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

        {/* ONE campaign context for every campaign-scoped view: the switcher
            trigger, always the same element in the same place. It replaced three
            different breadcrumbs (scene, list, generator) that each spelled the
            campaign name again and, on a file, a chapter path that was plain
            misleading for an NPC opened from the NPC list. Hierarchical context
            moved into the page header (components/PageContext.tsx). */}
        {campaign !== "" && <CampaignSwitcher campaign={campaign} />}

        {/* Quiet campaign navigation (issue #34): the three campaign-wide entry
            points, reachable without scrolling, from every campaign view. The
            design prototype does not cover this navigation — the pool's
            "NPCs · Orte" footer of issue #26 was a team interim solution and is
            gone; these links fill the gap per PO decision (design/README.md).
            "Kapitel" is the pool — and the way BACK from everywhere: the
            campaign label next to it is the switcher trigger, not a link, and
            the wordmark is a detour via "/" (PO feedback on PR #35).
            Not in the live mode: that view belongs to the running session
            (design/README.md). Below lg the row is already carrying switcher,
            session chip and search, so the links step aside there — mobile has
            the start surface's "Nachschlagen" list, and ⌘K finds both lists at
            any width. */}
        {campaign !== "" && !isLive && (
          <nav
            // Deliberately NOT "Nachschlagen": that is the mobile start
            // surface's nav, and on the pool both live in the DOM at once
            // (responsive swap) — two navs with one name is a worse tree.
            aria-label={t("topbar.nav.aria")}
            className="flex flex-none items-center gap-1 border-l border-border pl-3 text-[13px] max-lg:hidden"
          >
            {/* The section of the current view carries aria-current and the
                stronger tone (lib/topbar-nav.ts). It is the ONLY thing that
                differs between the campaign-scoped views, so it is a full step
                of contrast, not a hint. Generator and review belong to no
                section and mark nothing. */}
            <TopbarNavLink
              to={`/${campaign}`}
              label={t("topbar.nav.chapters")}
              active={section === "chapters"}
            />
            <TopbarNavLink
              to={`/${campaign}/list/npcs`}
              label={t("topbar.nav.npcs")}
              active={section === "npcs"}
            />
            <TopbarNavLink
              to={`/${campaign}/list/locations`}
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
              // THE elastic element of the topbar (issue #50): it wants
              // 200px, gives way down to 3rem at medium widths and never
              // lets the row overflow — its label truncates on the way.
              // Below XL it goes ICON-ONLY (issue #69 CI finding): 1024px is
              // where the nav trio, the full search and the chip's reserved
              // width used to switch on ALL AT ONCE, and the row cleared that
              // step by single digits — on CI's wider font metrics it did not
              // clear it at all. So the elastic element shrinks one
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
                  settings gear of issue #69 would otherwise push it over
                  (issue #50). The shortcut itself keeps working at every
                  width. */}
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
            has unharvested entries (issue #10); otherwise nothing is shown.
            "The harvested session" is the server's last STARTED one, the same
            file the review page works on (issue #40 review): after a session
            that ran past midnight, today's date names no file at all. */}
        {isPool && <PoolReviewLink campaign={campaign} />}

        {/* Quiet entry into the generator (issue #12) — pool only, next to the
            brass session button per the prototype. Carries the run indicator
            of issue #19. */}
        {isPool && <GeneratorLink campaign={campaign} />}

        {/* Instance settings (issue #69, PO feedback on PR #83) — ONE gear,
            icon-only, following the generator entry's icon pattern. Icon-only
            at EVERY width on purpose: the topbar overflowed once (issue #50)
            and this is the least urgent thing on it, so it must not be able to
            grow the row. Its accessible name comes from aria-label. */}
        <SettingsLink campaign={campaign} active={isSettings} />

        {/* THE session control: ONE chip in ONE slot for EVERY state (PO
            feedback on issue #40) — start offer, running session, unknown
            status. Same position, same geometry; only content and colour
            change. */}
        {campaign !== "" && (
          <SessionChip
            campaign={campaign}
            session={live}
            state={sessionChipState({
              session,
              offersStart: isPool || isScene,
              showsError: isPool || isScene || isLive,
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
 * is zone-less, so a browser in another timezone than the server used to show
 * a runtime that was hours off (issue #40). PAUSED time is deducted and the
 * clock STANDS while a pause runs (AK8) — the number on the chip is the time
 * played, which is what makes „Pause" mean something. An ENDED session freezes
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
 * The chip's GEOMETRY — identical in every state (PO requirement on issue
 * #40): same slot, same height, same radius, same paddings, same font size.
 * Only the colours below and the content inside change, so the switch from
 * "Session starten" to the running clock never makes the topbar jump. From
 * xl up a minimum width holds the states at a comparable size; below that the
 * row is too tight to reserve width (issue #50 — the reservation used to start
 * at lg, which is exactly where the nav trio appears and the row had no slack
 * left on CI's wider font metrics), and the clock's tabular numbers alone keep
 * a second's tick from re-flowing anything.
 */
const SESSION_CHIP_BASE =
  "inline-flex min-h-8 flex-none items-center justify-center gap-2 rounded-full border px-3 py-[3px] text-[13px] xl:min-w-[8.5rem] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** Tone per state — the colour IS the state, never the only information. */
const SESSION_CHIP_TONE = {
  // The invitation: the brass accent the separate start button used to carry.
  start:
    "border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary-hover hover:border-primary-hover",
  // A session is running: brass, but quiet — nothing to decide, just present.
  running:
    "border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-primary hover:border-primary hover:bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] hover:text-primary-hover",
  // Paused (issue #40 AK8): the SAME chip, dimmed — the session has not gone
  // anywhere, it just does not count right now. Muted instead of brass, so
  // "läuft" and "pausiert" are told apart at a glance; the standing clock and
  // the aria-label carry the state itself.
  paused:
    "border-input bg-transparent text-muted-foreground hover:border-border hover:text-body-secondary",
  // The query failed: dimmed and inert — it is neither live nor an offer.
  error: "border-input bg-transparent text-muted-foreground",
} as const;

/** Which of the chip's states the session query puts it in. */
type SessionChipState = "hidden" | "start" | "running" | "error";

/**
 * The chip's state, straight from the server's answer — and from nothing else
 * (issue #40 review, finding 6):
 *
 *   running — a session came back, ended or not decided by the server.
 *   start   — EXACTLY the answer `null` ("nothing running"). Never while the
 *             query is pending (the chip would flash an offer into a running
 *             session) and never when it failed.
 *   error   — the query failed. A broken lookup used to look exactly like
 *             "nothing running", so the chrome offered a start that could not
 *             work.
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
 * THE session control (PO feedback on issue #40): ONE chip, one slot, every
 * state. It used to be two different elements in the same place — a filled
 * "Session starten" button and, once a session ran, a pill of another shape —
 * plus a bare sentence for a failed lookup. Now the element stays; only what
 * it says and which colour it wears change:
 *
 *   start   — "Session starten". One click starts a NEW session and enters
 *             /live; there is no "fortsetzen" (issue #58).
 *   running — dot + H:MM:SS. Off /live a click goes back into the session;
 *             ON /live it opens the session actions (Pause, beenden, and
 *             verwerfen while the session is still empty) — three separate
 *             topbar buttons before, which is what made the row overflow at
 *             medium widths (issue #50).
 *   error   — "Status unbekannt", dimmed and inert. Neither live nor an
 *             offer, and it no longer costs the row a second element.
 *
 * The accessible name always carries the STATE plus the running time
 * ("Session läuft, 0:12:33") — the colour alone is not information.
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
  // information (quality floor, AK8).
  const paused = sessionIsPaused(session);
  const state = t(paused ? "session.state.paused" : "session.state.running");
  const label =
    elapsed === undefined
      ? state
      : t("session.state.withElapsed", { state, elapsed });

  if (mode === "link") {
    return (
      <Link
        to={`/${campaign}/live`}
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
 * mode. ONE click, always, and always the same label — "Session beenden" is
 * final since issue #58, so a start after an ended evening opens the next
 * session of the day instead of re-opening the closed one. No "fortsetzen".
 *
 * A start can still answer 409 `session_running` — an OLDER session was never
 * ended. The live view is the place that asks about it, so the click
 * navigates there.
 */
function SessionStartChip({ campaign }: { campaign: string }) {
  const t = useT();
  const navigate = useNavigate();
  const toLive = () => void navigate(`/${campaign}/live`);
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
  // ONE entry, two directions (issue #40 AK8): the pause endpoints open and
  // close a `pauses` interval in the session — the log line comes with it, and
  // the runtime really stops instead of only being annotated.
  const pause = useSessionWrite(campaign, () =>
    paused ? continueSession(campaign) : pauseSession(campaign),
  );
  // "Session beenden" leads into the review, not back to the pool
  // (prototype: endSession → review) — the harvest is the next step.
  const end = useSessionWrite(
    campaign,
    () => endSession(campaign),
    () => void navigate(`/${campaign}/review`),
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
          {/* Only while the session is EMPTY (issue #40 AK7) — the mis-click's
              undo, gone the moment the evening has content. */}
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
 * Below md the topbar is not the chrome (issue #40 AK2), so the session gets
 * its own slim row — carrying the very SAME chip, in link mode: there is no
 * mobile live mode (UI-BRIEF §4), so the way back into the session is the only
 * action mobile needs. Mobile is "nachschlagen und einwerfen", and this is
 * exactly the way back out of a lookup.
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
 * One quiet link of the topbar's campaign navigation ("Kapitel · NPCs ·
 * Orte"), marked when it is the view currently open. The caller decides what
 * "current" means — the pool and the two lists are matched differently.
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
 * "Session verwerfen" (issue #40 AK7): deletes the session
 * that has nothing in it — the undo of a "Session starten" that was a
 * mis-click. It lives in the session menu now (last entry, dimmed), below
 * "Session beenden", which stays THE way out of a session that happened.
 *
 * It deletes a session, so it asks first. The confirmation names the consequence
 * instead of asking "sicher?" — that is the only thing worth reading here.
 * After the discard nothing is live any more, so the pool is where the DM
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
    void navigate(`/${campaign}`);
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
 * The pool's generator entry — with a quiet run indicator while a generate
 * job is working (issue #19 AK5). It shares the generator route's query key,
 * so there is no second poll loop: one lookup when the pool mounts, then
 * polling only while a job is actually running.
 */
function GeneratorLink({ campaign }: { campaign: string }) {
  const t = useT();
  const { data } = useGenerateJob(campaign);
  const running = data?.status === "running";
  // A run the DM already took PART of is not „done" and not „running" — it
  // is half applied (issue #97), and the entry says how far it got so a
  // forgotten rest is findable from anywhere.
  // Counted against ALL parts of the run (issue #102 review): while a
  // pipelined run is still going, only the finished parts have produced a
  // draft, so „1 von 2 übernommen" stood next to „2 von 3 Szenen fertig".
  const progress = acceptProgress(data);
  const partial = progress.written > 0 && progress.written < progress.total;
  const progressLabel = t("topbar.generator.progress", progress);
  // A PIPELINED run (issue #102) is both at once: parts are still going while
  // finished ones are already reviewable and acceptable. So the dot and the
  // progress are no longer exclusive — the chip shows what is true.
  const runProgress = pipelineProgress(data, t);
  return (
    <Link
      to={`/${campaign}/generate`}
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
      {/* Below xl the row is tight (issue #50): the label steps aside and the
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
          is BOTH running and half accepted (a pipelined one — issue #102)
          carries the dot AND this label, which is ~90px the row never had to
          budget for: at 1280, where the nav trio, the full search chip and
          this chip's reserved width all switch on at once, the row ran over
          by 50px. So the pair is only spelled out from 2xl up; below that the
          dot carries the state and the number stays in the accessible name
          (and in the chip's `title`) — the same trade the label above makes
          below xl. */}
      {/* ONE element, whatever the width (issue #102 review): `sr-only` takes
          the number off the row without taking it out of the accessible name,
          so the second, screen-reader-only copy that used to stand next to it
          only doubled the chip's name (and its innerText) below the
          breakpoint. */}
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
 * The gear: `/settings` (issue #69). Icon-only and always present — the
 * language lives behind it, and on a fresh instance (no campaign, no
 * switcher) it is the only settings entry there is. Same geometry as the
 * generator entry minus its label, so the row's width does not depend on it
 * (issue #50).
 *
 * WHICH CAMPAIGN the page shows its campaign half for travels ALONG, in
 * `?from=` (issue #69, PO feedback on PR #83): the campaign the DM was looking
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
        // moves — issue #50, and the chrome must not shift at all).
        active && "border-border-hover text-foreground",
      )}
    >
      <Settings aria-hidden />
    </Link>
  );
}

/** "n von m gesichtet" on the review view (prototype's isReview topbar). */
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

/** Pool affordance into the review: only when the harvested session (the
 *  server's last started one) still has entries — nothing to see otherwise. */
function PoolReviewLink({ campaign }: { campaign: string }) {
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
  // and at 1024 the full label pushed the chip OVER the right padding and off
  // the viewport (issue #69 CI finding — the old guard measured
  // `scrollWidth - clientWidth`, which does not see an item overflowing INTO
  // the padding, so it reported a clean row). The label steps down to the
  // count, which is the news; the accessible name stays the full sentence at
  // every width, so nothing changes for a screen reader.
  const label = t("topbar.review.pending", { count: review.pendingCount });
  return (
    <Link
      to={`/${campaign}/review`}
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
 * The switcher is also where a SECOND campaign is created (PO feedback on
 * issue #56). The cold start covers the FIRST one, but on a running instance
 * this menu was a read-only list, so a second campaign had no entry point in
 * the UI at all. The menu therefore ends with a quiet „Kampagne anlegen" that
 * opens the shared create dialog (components/CreateActions.tsx) and navigates
 * into the new campaign.
 *
 * What used to close the menu — „Kampagnen liegen in der Datenbank — Import
 * über „grimoire seed"" — is GONE and gets no replacement (PO feedback on the
 * same review): a shell command is developer jargon, `grimoire seed` belongs
 * in README.md/docs/DEPLOYMENT.md, and where campaigns are stored is not a
 * question this menu has to answer while switching between them.
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
          // carry (the pool's Generator link used to make the name shorter
          // there than on a list — the chrome has to be identical on every
          // route). A very long name truncates at max-w-[280px] with an
          // ellipsis instead of pushing the row over (issue #50); the elastic
          // element of the row is the search chip below.
          "h-auto min-w-0 flex-none gap-[7px] rounded-md border border-transparent px-2.5 py-[5px] text-[13px] font-normal text-body-secondary hover:border-input hover:bg-transparent hover:text-foreground",
        )}
      >
        {/* Truncates with an ellipsis rather than pushing the row over
            (issue #50), and one step harder per tightening of the row: below
            xl it also carries the "Kapitel · NPCs · Orte" trio, and below lg
            the search chip has already reached its floor, so the name is the
            last thing that can still give way there. The full name is one
            click away in the menu below.
            The xl cap is 160px, not 280 (issue #69 CI finding): at exactly
            1280 the FULLEST row — switcher, nav trio, search, the review
            link, generator, gear and the "Session starten" chip with its
            reserved 8.5rem — had only the search chip's ~50px of shrink left,
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
            onSelect={() => void navigate(`/${c.id}`)}
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
