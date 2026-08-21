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
// The live mode is the one exception: it keeps its own left block (green Live
// pill + chapter label), because that topbar belongs to the running session.
//
// The right side stays per-view and unchanged: the ⌘K search chip (opens the
// palette; hidden without a campaign in the URL — "/" only ever shows the
// empty state), the brass "Session starten" button on pool and scene views
// (issue #9: starts today's session and enters /:campaign/live), the elapsed
// timer plus Pause / "Session beenden" in the live mode, the harvest progress
// on the review (issue #10) with a quiet pool link into it while today's
// session still has unharvested entries, and the quiet "Generator" button on
// the pool (issue #12) with its run indicator (issue #19).

import type { FileResponse } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Clock, Pause, Play, Search, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, matchPath, useLocation, useNavigate } from "react-router";

import { appendLog, endSession, fetchCampaigns, fetchTree, startSession } from "@/api";
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
import { campaignDescription, campaignLabel } from "@/lib/campaign";
import { formatElapsed, parseLocalDateTime } from "@/lib/session";
import { navSection } from "@/lib/topbar-nav";
import { useGenerateJob } from "@/lib/use-generate-job";
import { cn } from "@/lib/utils";
import { useReviewEntries } from "@/lib/use-review";
import { useSessionFile, useSessionWrite } from "@/lib/use-session";

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

  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: isLive,
  });
  const session = useSessionFile(campaign, isLive);

  // The live chapter label: the ACTIVE chapter (fallback: first) — the same
  // rule the live nav uses.
  const liveChapter =
    tree.data?.chapters.find((c) => c.status === "active") ?? tree.data?.chapters[0];

  return (
    // Below md the campaign-scoped views carry their own mobile chrome
    // (start-surface wordmark, "‹ Pool" back rows — issue #11); the topbar
    // is desktop chrome there. Without a campaign in the URL ("/" with no
    // campaign at all) it stays visible on every width, so the empty state
    // is not a bare page.
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
      {!isLive && campaign !== "" && <CampaignSwitcher campaign={campaign} />}

      {isLive && session.data !== undefined && (
        <div className="flex min-w-0 items-center gap-2.5 text-[13px] text-muted-foreground">
          <span className="inline-flex flex-none items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--success)_35%,transparent)] px-2.5 py-[2px] text-[12px] text-success-text">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            Live
          </span>
          {liveChapter !== undefined && (
            <span className="hidden truncate md:inline">{liveChapter.title}</span>
          )}
        </div>
      )}

      {/* Quiet campaign navigation (issue #34): the three campaign-wide entry
          points, reachable without scrolling, from every campaign view. The
          design prototype does not cover this navigation — the pool's
          "NPCs · Orte" footer of issue #26 was a team interim solution and is
          gone; these links fill the gap per PO decision (design/README.md).
          "Kapitel" is the pool — and the way BACK from everywhere: the
          campaign label next to it is the switcher trigger, not a link, and
          the wordmark is a detour via "/" (PO feedback on PR #35).
          Not in the live mode: that topbar belongs to the running session.
          Below lg the row is already carrying switcher, search and the session
          controls, so the links step aside there — mobile has the start
          surface's "Nachschlagen" list, and ⌘K finds both lists at any width. */}
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
            className="hidden h-auto min-w-[200px] gap-2 border-input bg-card px-3 py-1.5 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-card hover:text-soft sm:flex"
          >
            <Search aria-hidden size={15} className="text-muted-foreground" />
            <span className="flex-1 text-left">Suchen …</span>
            <span className="rounded-[4px] border border-input px-[5px] py-px font-mono text-[11px] text-muted-foreground">
              ⌘K
            </span>
          </Button>
          <CommandPalette campaign={campaign} open={searchOpen} onOpenChange={setSearchOpen} />
        </>
      )}

      {/* Quiet review affordance — only while today's session still has
          unharvested entries (issue #10); otherwise nothing is shown. */}
      {isPool && <PoolReviewLink campaign={campaign} />}

      {/* Quiet entry into the generator (issue #12) — pool only, next to the
          brass session button per the prototype. Carries the run indicator
          of issue #19. */}
      {isPool && <GeneratorLink campaign={campaign} />}

      {(isPool || isScene) && <StartSessionButton campaign={campaign} />}

      {isLive && session.data !== undefined && (
        <LiveControls campaign={campaign} session={session.data} />
      )}

      {isReview && <ReviewProgress campaign={campaign} />}
    </header>
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

/** Starts (or re-enters) today's session and navigates to the live mode. */
function StartSessionButton({ campaign }: { campaign: string }) {
  const navigate = useNavigate();
  const start = useSessionWrite(
    campaign,
    () => startSession(campaign),
    () => void navigate(`/${campaign}/live`),
  );
  return (
    <Button
      type="button"
      disabled={start.isPending}
      onClick={() => start.mutate()}
      title={start.isError ? "Session nicht gestartet — Server prüfen" : undefined}
      className="h-auto gap-2 px-4 py-2 text-[13px] font-semibold [&_svg]:size-[13px]"
    >
      <Play aria-hidden className="fill-current" />
      Session starten
    </Button>
  );
}

/** Elapsed timer (ticks ~15s, text only — nothing animates), Pause and
 * "Session beenden" per the prototype's live topbar. */
function LiveControls({ campaign, session }: { campaign: string; session: FileResponse }) {
  const navigate = useNavigate();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const startedMs = parseLocalDateTime(session.frontmatter.started);
  const endedMs = parseLocalDateTime(session.frontmatter.ended);
  const elapsed =
    startedMs === undefined ? undefined : formatElapsed(startedMs, endedMs ?? nowMs);

  const pause = useSessionWrite(campaign, () => appendLog(campaign, "— Pause"));
  // "Session beenden" leads into the review, not back to the pool
  // (prototype: endSession → review) — the harvest is the next step.
  const end = useSessionWrite(
    campaign,
    () => endSession(campaign),
    () => void navigate(`/${campaign}/review`),
  );

  return (
    <>
      {elapsed !== undefined && (
        <div className="hidden flex-none items-center gap-2 text-soft sm:flex">
          <Clock aria-hidden size={15} className="flex-none" />
          <span className="font-mono text-[14px]">{elapsed}</span>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={pause.isPending}
        onClick={() => pause.mutate()}
        className="hidden h-auto gap-1.5 border-input bg-card px-3 py-1.5 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-card hover:text-foreground sm:flex [&_svg]:size-[13px]"
      >
        <Pause aria-hidden />
        Pause
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={end.isPending}
        onClick={() => end.mutate()}
        className="h-auto border-input bg-transparent px-3 py-1.5 text-[13px] font-normal text-soft hover:border-primary hover:bg-transparent hover:text-primary-hover"
      >
        Session beenden
      </Button>
    </>
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
      Generator
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

/** Pool affordance into the review: only when today's session exists and
 *  still has entries to harvest — nothing to see otherwise. */
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
          "h-auto min-w-0 gap-[7px] rounded-md border border-transparent px-2.5 py-[5px] text-[13px] font-normal text-body-secondary hover:border-input hover:bg-transparent hover:text-foreground",
        )}
      >
        <span className="max-w-[280px] truncate">Kampagne: {current}</span>
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
