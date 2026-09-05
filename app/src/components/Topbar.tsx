// The constant topbar (design reference: 56px, hairline below).
//
// THE CHROME IS GLOBAL AND STABLE (PO rework of PR #35). Every campaign-scoped
// view — pool, browse lists, file/scene, generator, review — shows the very
// same left block:
//
//     Grimoire │ Kampagne: <name> ⌄ │ Kapitel · NPCs · Orte
//
// Nothing appears, disappears or shifts when moving between them; the only
// difference is which nav entry is marked as the current section
// (lib/topbar-nav.ts). There are NO breadcrumbs in the topbar any more. The
// three it used to have (scene, list, generator) each repeated the campaign
// name the switcher already carries, competed with the nav next to them, and
// on a file view claimed a chapter path that was misleading for an NPC opened
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
// a small menu with the three session actions (Pause, beenden, verwerfen —
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
// starten" (or "fortsetzen") while nothing runs, shows the ticking clock
// while one does, and reads "Status unbekannt", dimmed and inert, when the
// session lookup failed. The separate brass start button and the bare
// "Session-Status unbekannt" sentence are gone; only content and colour
// change, so nothing in the chrome moves when the state does.
//
// The right side stays per-view: the ⌘K search chip (opens the palette;
// hidden without a campaign in the URL — "/" only ever shows the empty
// state), the session chip (issue #9: one click starts — or resumes —
// today's session and enters /:campaign/live), the harvest progress on the
// review (issue #10) with a quiet pool link into it while today's session
// still has unharvested entries, and the "Generator" on the pool (issue #12)
// with its run indicator (issue #19).

import type { FileResponse } from "@grimoire/shared/types";
import { isSessionEmpty } from "@grimoire/shared/session-state";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Pause, Play, Search, Sparkles, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, matchPath, useLocation, useNavigate } from "react-router";

import { appendLog, endSession, fetchCampaigns, fetchTree } from "@/api";
import { CommandPalette } from "@/components/CommandPalette";
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
import { campaignDescription, campaignLabel } from "@/lib/campaign";
import { formatElapsed, sessionEndMs, sessionStartMs } from "@/lib/session";
import { navSection } from "@/lib/topbar-nav";
import { useGenerateJob } from "@/lib/use-generate-job";
import { cn } from "@/lib/utils";
import { useReviewEntries } from "@/lib/use-review";
import {
  useActiveSession,
  useSessionDiscard,
  useSessionStartFlow,
  useSessionWrite,
} from "@/lib/use-session";

export function Topbar() {
  const { pathname } = useLocation();
  const sceneMatch = matchPath("/:campaign/file/*", pathname);
  const liveMatch = matchPath("/:campaign/live", pathname);
  const reviewMatch = matchPath("/:campaign/review", pathname);
  const generateMatch = matchPath("/:campaign/generate", pathname);
  const listMatch = matchPath("/:campaign/list/*", pathname);
  const poolMatch = matchPath("/:campaign", pathname);
  const campaign =
    sceneMatch?.params.campaign ??
    liveMatch?.params.campaign ??
    reviewMatch?.params.campaign ??
    generateMatch?.params.campaign ??
    listMatch?.params.campaign ??
    poolMatch?.params.campaign ??
    "";
  const filePath = sceneMatch?.params["*"] ?? "";
  const isScene = sceneMatch !== null && filePath !== "" && campaign !== "";
  const isLive = liveMatch !== null && campaign !== "";
  const isReview = reviewMatch !== null && campaign !== "";
  const isPool = poolMatch !== null && campaign !== "";
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
          "flex h-14 flex-none items-center gap-3.5 border-b border-border px-6",
          campaign !== "" && "max-md:hidden",
        )}
      >
        <Link
          to="/"
          className="-ml-1.5 flex flex-none items-center gap-[9px] rounded-md px-1.5 py-1 font-serif text-[17px] font-semibold tracking-[.01em] text-foreground hover:text-primary-hover"
        >
          <IconLogo size={19} className="text-primary" />
          Grimoire
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
            aria-label="Kapitel, NPCs und Orte"
            className="flex flex-none items-center gap-1 border-l border-border pl-3 text-[13px] max-lg:hidden"
          >
            {/* The section of the current view carries aria-current and the
                stronger tone (lib/topbar-nav.ts). It is the ONLY thing that
                differs between the campaign-scoped views, so it is a full step
                of contrast, not a hint. Generator and review belong to no
                section and mark nothing. */}
            <TopbarNavLink
              to={`/${campaign}`}
              label="Kapitel"
              active={section === "chapters"}
            />
            <TopbarNavLink
              to={`/${campaign}/list/npcs`}
              label="NPCs"
              active={section === "npcs"}
            />
            <TopbarNavLink
              to={`/${campaign}/list/locations`}
              label="Orte"
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
              // 200px, gives way down to ~5rem at medium widths and never
              // lets the row overflow. Its label truncates; the ⌘K hint and
              // the icon stay, so the chip is still recognizable at its
              // narrowest.
              className="hidden h-auto min-w-[5rem] shrink basis-[200px] gap-2 border-input bg-card px-3 py-1.5 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-card hover:text-soft sm:flex"
            >
              <Search aria-hidden size={15} className="flex-none text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-left">Suchen …</span>
              <span className="flex-none rounded-[4px] border border-input px-[5px] py-px font-mono text-[11px] text-muted-foreground">
                ⌘K
              </span>
            </Button>
            <CommandPalette campaign={campaign} open={searchOpen} onOpenChange={setSearchOpen} />
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
 * The start is the SERVER's epoch reading of `started` (lib/session.ts): the
 * file format is zone-less, so a browser in another timezone than the server
 * used to show a runtime that was hours off (issue #40). Pauses are NOT
 * deducted — that stays a non-goal. An ENDED session freezes at its `ended`
 * (the chip is gone by then, but a resume race must not tick backwards).
 */
function useElapsedLabel(session: FileResponse): string | undefined {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const startedMs = sessionStartMs(session);
  if (startedMs === undefined) return undefined;
  return formatElapsed(startedMs, sessionEndMs(session) ?? nowMs);
}

/**
 * The chip's GEOMETRY — identical in every state (PO requirement on issue
 * #40): same slot, same height, same radius, same paddings, same font size.
 * Only the colours below and the content inside change, so the switch from
 * "Session starten" to the running clock never makes the topbar jump. From
 * lg up a minimum width holds the states at a comparable size; below that the
 * row is too tight to reserve width (issue #50), and the clock's tabular
 * numbers alone keep a second's tick from re-flowing anything.
 */
const SESSION_CHIP_BASE =
  "inline-flex min-h-8 flex-none items-center justify-center gap-2 rounded-full border px-3 py-[3px] text-[13px] lg:min-w-[8.5rem] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/** Tone per state — the colour IS the state, never the only information. */
const SESSION_CHIP_TONE = {
  // The invitation: the brass accent the separate start button used to carry.
  start:
    "border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary-hover hover:border-primary-hover",
  // A session is running: brass, but quiet — nothing to decide, just present.
  running:
    "border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-primary hover:border-primary hover:bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] hover:text-primary-hover",
  // The query failed: dimmed and inert — it is neither live nor an offer.
  error: "border-input bg-transparent text-muted-foreground",
} as const;

/** Which of the chip's states the session query puts it in. */
type SessionChipState = "hidden" | "start" | "running" | "error";

/**
 * The chip's state, straight from the server's answer — and from nothing else
 * (issue #40 review, finding 6):
 *
 *   running — a session file came back, ended or not decided by the server.
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
  session: { data: FileResponse | null | undefined; isError: boolean };
  offersStart: boolean;
  showsError: boolean;
}): SessionChipState {
  if (session.data !== undefined && session.data !== null) return "running";
  if (session.isError) return showsError ? "error" : "hidden";
  if (session.data === null) return offersStart ? "start" : "hidden";
  return "hidden";
}

/** The brass dot: it pulses only where motion is welcome (quality floor). */
function SessionDot() {
  return (
    <span
      aria-hidden
      className="size-[7px] flex-none rounded-full bg-primary motion-safe:animate-pulse"
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
 *   start   — "Session starten" ("Session fortsetzen" once today's session is
 *             ended). One click starts or resumes and enters /live.
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
  session: FileResponse | undefined;
  state: SessionChipState;
  mode: "link" | "menu";
}) {
  if (state === "hidden") return null;
  if (state === "error") {
    return (
      <span
        role="status"
        aria-label="Session-Status unbekannt — Server prüfen"
        data-session-chip="error"
        className={cn(SESSION_CHIP_BASE, SESSION_CHIP_TONE.error)}
      >
        Status unbekannt
      </span>
    );
  }
  if (state === "start" || session === undefined) {
    return <SessionStartChip campaign={campaign} />;
  }
  return <SessionRunningChip campaign={campaign} session={session} mode={mode} />;
}

/** The running states of the chip — link off /live, menu on it. */
function SessionRunningChip({
  campaign,
  session,
  mode,
}: {
  campaign: string;
  session: FileResponse;
  mode: "link" | "menu";
}) {
  const elapsed = useElapsedLabel(session);
  const label = elapsed === undefined ? "Session läuft" : `Session läuft, ${elapsed}`;

  if (mode === "link") {
    return (
      <Link
        to={`/${campaign}/live`}
        aria-label={`${label} — zur laufenden Session`}
        data-session-chip="running"
        className={cn(SESSION_CHIP_BASE, SESSION_CHIP_TONE.running)}
      >
        <SessionDot />
        <span className="font-mono tabular-nums">{elapsed ?? "läuft"}</span>
      </Link>
    );
  }
  return <SessionMenuChip campaign={campaign} session={session} label={label} elapsed={elapsed} />;
}

/**
 * The chip in its start state: starts — or resumes — today's session and
 * navigates to the live mode. ONE click, always (PO feedback on issue #40):
 * the label is the intention, and "fortsetzen" must not cost a second press
 * or an intermediate screen.
 *
 * A start can answer 409 (issue #40 review): today's session is already
 * ended, or an older one still runs. The ended case is answered inside the
 * flow (use-session.ts: `enter` retries as a resume immediately) — that is
 * the accident this chip causes ("beenden" hit one evening too early). For
 * the still-running case the live view is the place that asks, so the click
 * navigates there.
 */
function SessionStartChip({ campaign }: { campaign: string }) {
  const navigate = useNavigate();
  const toLive = () => void navigate(`/${campaign}/live`);
  const { enter, entering, resume, conflict, failed } = useSessionStartFlow(campaign, toLive);
  const resuming = conflict === "session_ended";
  const label = resuming ? "Session fortsetzen" : "Session starten";
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
        failed || resume.isError
          ? "Session nicht gestartet — Server prüfen"
          : conflict === "session_running"
            ? "Eine ältere Session läuft noch — im Live-Modus beenden"
            : resuming
              ? "Die heutige Session ist beendet — fortsetzen"
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
}: {
  campaign: string;
  session: FileResponse;
  label: string;
  elapsed: string | undefined;
}) {
  const navigate = useNavigate();
  const [discardOpen, setDiscardOpen] = useState(false);
  const pause = useSessionWrite(campaign, () => appendLog(campaign, "— Pause"));
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
          aria-label={`${label} — Session-Menü`}
          disabled={busy}
          data-session-chip="running"
          className={cn(SESSION_CHIP_BASE, SESSION_CHIP_TONE.running)}
        >
          <SessionDot />
          <span className="font-mono tabular-nums">{elapsed ?? "läuft"}</span>
          <ChevronDown aria-hidden size={13} className="flex-none opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[210px] text-[13px]">
          <DropdownMenuItem onSelect={() => pause.mutate()}>
            <Pause aria-hidden size={14} className="flex-none text-muted-foreground" />
            Pause
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => end.mutate()}>
            <Square aria-hidden size={14} className="flex-none text-muted-foreground" />
            Session beenden
          </DropdownMenuItem>
          {/* Only while the session is EMPTY (issue #40 AK7) — the mis-click's
              undo, gone the moment the evening has content. */}
          {isSessionEmpty(session.frontmatter, session.body) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-muted-foreground"
                onSelect={() => setDiscardOpen(true)}
              >
                <Trash2 aria-hidden size={14} className="flex-none" />
                Session verwerfen
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {(pause.isError || end.isError) && (
        <span className="flex-none text-[12.5px] text-destructive">
          Session nicht geändert — Server prüfen.
        </span>
      )}
      <DiscardSessionDialog campaign={campaign} open={discardOpen} onOpenChange={setDiscardOpen} />
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
function MobileSessionRow({ campaign, session }: { campaign: string; session: FileResponse }) {
  return (
    <div className="flex min-h-11 flex-none items-center gap-2.5 border-b border-border bg-panel-deep px-4 md:hidden">
      <SessionChip campaign={campaign} session={session} state="running" mode="link" />
      <span className="ml-auto text-[13px] text-body-secondary">Zur Session</span>
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
 * "Session verwerfen" (issue #40 AK7): deletes the session file of a session
 * that has nothing in it — the undo of a "Session starten" that was a
 * mis-click. It lives in the session menu now (last entry, dimmed), below
 * "Session beenden", which stays THE way out of a session that happened.
 *
 * It deletes a file, so it asks first. The confirmation names the consequence
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
  const navigate = useNavigate();
  const discard = useSessionDiscard(campaign, () => {
    onOpenChange(false);
    void navigate(`/${campaign}`);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Leere Session verwerfen?</DialogTitle>
        <DialogDescription>Die Datei wird gelöscht.</DialogDescription>
        {discard.isError && (
          <p className="mt-3 text-[12.5px] text-destructive">
            Session nicht verworfen — Server prüfen und neu laden.
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              Abbrechen
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={discard.isPending}
            onClick={() => discard.mutate()}
            className="h-auto px-3.5 py-1.5 text-[12.5px] font-semibold"
          >
            Verwerfen
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
  const { data } = useGenerateJob(campaign);
  const running = data?.status === "running";
  return (
    <Link
      to={`/${campaign}/generate`}
      title={running ? "Generierung läuft" : undefined}
      className={cn(
        buttonVariants({ variant: "outline" }),
        "h-auto flex-none gap-[7px] border-input bg-card px-3.5 py-[7px] text-[13px] font-normal text-soft hover:border-border-hover hover:bg-card hover:text-foreground [&_svg]:size-[15px]",
      )}
    >
      <Sparkles aria-hidden />
      {/* Below xl the row is tight (issue #50): the label steps aside and the
          icon carries the entry — the accessible name stays either way. */}
      <span className="max-xl:sr-only">Generator</span>
      {running && (
        <>
          {/* Pulses only where motion is welcome; otherwise a static dot
              carries the same information. */}
          <span
            aria-hidden
            className="size-1.5 flex-none rounded-full bg-primary motion-safe:animate-pulse"
          />
          <span className="sr-only">Generierung läuft</span>
        </>
      )}
    </Link>
  );
}

/** "n von m gesichtet" on the review view (prototype's isReview topbar). */
function ReviewProgress({ campaign }: { campaign: string }) {
  const review = useReviewEntries(campaign);
  if (review.isPending || review.noSession || review.isError || review.total === 0) return null;
  return <div className="flex-none text-[13px] text-soft">{review.progressLabel}</div>;
}

/** Pool affordance into the review: only when the harvested session (the
 *  server's last started one) still has entries — nothing to see otherwise. */
function PoolReviewLink({ campaign }: { campaign: string }) {
  const review = useReviewEntries(campaign);
  if (review.isPending || review.noSession || review.isError || review.pendingCount === 0) {
    return null;
  }
  return (
    <Link
      to={`/${campaign}/review`}
      className="flex-none rounded-md px-1.5 py-1 text-[13px] text-body-secondary hover:text-foreground"
    >
      Review · {review.pendingCount} offen
    </Link>
  );
}

function CampaignSwitcher({ campaign }: { campaign: string }) {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });
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
            (issue #50) — and harder below xl, where the row also carries the
            "Kapitel · NPCs · Orte" trio. The full name is one click away in
            the menu below. */}
        <span className="min-w-0 max-w-[9.5rem] truncate xl:max-w-[280px]">
          Kampagne: {current}
        </span>
        <ChevronDown aria-hidden size={14} className="flex-none text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[290px]">
        {/* Name over description — the prototype's campaignRows (name + meta);
            the id never shows up, it only lives in the URL. */}
        {(data ?? []).map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => void navigate(`/${c.id}`)}>
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
              <Check aria-hidden size={13} className="flex-none text-success-text" />
            )}
          </DropdownMenuItem>
        ))}
        {data !== undefined && data.length === 0 && (
          <p className="px-2.5 py-[9px] text-[13px] text-muted-foreground">
            Noch keine Kampagnen gefunden.
          </p>
        )}
        <DropdownMenuSeparator />
        <p className="px-2.5 pt-[7px] pb-[5px] text-[11.5px] text-faint">
          Kampagnen liegen als Ordner unter campaigns/
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
