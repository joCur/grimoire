// "/campaigns/:campaign/live" — the live mode, three zones per the design
// prototype: left the planned scenes and contingencies of the ACTIVE
// chapter, center the selected scene through the same article pipeline as
// the reading view, right the location and NPC cards plus the log panel and
// the quick note.
//
// The scenes stand in the order the DM arranged in the chapter overview
// (decisions/scene-order) — this view moderates that order and never reorders it. Which
// scene it opens on, and where the "next scene" step under the open one
// leads, are both read out of that order (lib/scene-order.ts).
//
// The server is the truth: every write answers the row it wrote, and whether
// a scene was played is its STATUS — the checkmark and the played group
// read it from the tree, never from client state. The DM marks the scene
// being left as played with the box beside the next-scene step
// (session/NextSceneStep); the status write is the scene's, handed in here.
// WHICH session is running is the server's answer too (`?running=true`) — a
// session that runs past midnight keeps running.
//
// The page composes slices: the scenes, the npc and location cards, the
// session's log, start prompt and "next scene" step, and the reminders that
// join the session's log with the ideas (./PcReminders.tsx).
//
// Client state is exactly two things: the selected scene and which entity the
// detail drawer shows. Aside cards therefore do NOT navigate here
// — a click would leave the live route and take the selected scene and the
// half-typed quick note with it.
// There is NO mobile live mode (UI-BRIEF §4) — below md the route shows a
// quiet note with a link to the read view of the active scene instead.

import type { SceneSummary } from "@grimoire/shared/campaign-tree";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Check, ChevronDown, GitFork } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { fetchTree } from "@/api";
import { LiveDrawer } from "@/components/LiveDrawer";
import { LocationCard } from "@/location/LocationCard";
import type { OpenTarget } from "@/lib/open-target";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NpcCard } from "@/npc/NpcCard";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useI18n, useT } from "@/i18n";
import { initialSessionScene, nextSessionScene } from "@/lib/scene-order";
import { RefDrawerTarget } from "@/markdown/refs";
import { cn } from "@/lib/utils";
import { SceneArticle } from "@/scene/SceneArticle";
import { sceneHref } from "@/scene/scene-links";
import { sceneQuery } from "@/scene/scene-query";
import { isSceneDone } from "@/scene/scene-status";
import { useMarkScenePlayed } from "@/scene/use-scene-status";
import { NextSceneStep } from "@/session/NextSceneStep";
import { SessionLog } from "@/session/SessionLog";
import { SessionStart } from "@/session/SessionStart";
import { useRunningSession } from "@/session/use-session";

import { PcReminders } from "./PcReminders";

export function LiveRoute() {
  const { campaign = "" } = useParams();
  return (
    <>
      <div className="md:hidden">
        <MobileLiveNote campaign={campaign} />
      </div>
      <div className="hidden h-full min-h-0 md:block">
        <LiveDesktop campaign={campaign} />
      </div>
    </>
  );
}

/** Below md: no live mode — a quiet pointer to the reading view instead. */
function MobileLiveNote({ campaign }: { campaign: string }) {
  const t = useT();
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  // "Active scene" = the session view's default selection, read from the same
  // function so the phone points at the scene the desktop would open.
  const chapters = tree.data?.chapters ?? [];
  const chapter = chapters.find((ch) => ch.status === "active") ?? chapters[0];
  const scene = initialSessionScene(chapter?.scenes ?? []);

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="px-5 pt-12 text-center">
        <p className="text-[14px] leading-[1.6] text-muted-foreground">{t("live.mobile.note")}</p>
        {scene !== undefined && (
          <Link
            to={sceneHref(campaign, scene.id)}
            className="mt-2 inline-flex min-h-11 items-center text-[15px] text-primary hover:text-primary-hover"
          >
            {t("live.mobile.read", { title: scene.title })}
          </Link>
        )}
      </div>
    </>
  );
}

function LiveDesktop({ campaign }: { campaign: string }) {
  const t = useT();
  const session = useRunningSession(campaign);
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  // The live nav shows the ACTIVE chapter; without one, the first.
  const chapters = tree.data?.chapters ?? [];
  const chapter = chapters.find((ch) => ch.status === "active") ?? chapters[0];
  // The chapter's scenes in the order the DM arranged in the overview — this
  // view moderates that order, it does not make one of its own (decisions/scene-order).
  const scenes = chapter?.scenes ?? [];
  // The scene STATUS splits the plan: `played`/`dropped` scenes
  // drop out of the planned group into the collapsed played group below.
  const nonContingency = scenes.filter((s) => s.type !== "contingency");
  const planned = nonContingency.filter((s) => !isSceneDone(s.status));
  const done = nonContingency.filter((s) => isSceneDone(s.status));
  const contingencies = scenes.filter((s) => s.type === "contingency");

  // Selected scene = client state (the scene's ID); the default is the first
  // PLANNED scene of the order that is not behind us, and with the plan played
  // its first scene — `initialSessionScene`. A chapter without a planned scene
  // leaves it undefined and the center column says so.
  const [selectedId, setSelectedId] = useState<string>();
  const selected = scenes.find((s) => s.id === selectedId) ?? initialSessionScene(scenes);
  // The thread of the evening: where the DM reaches after this scene.
  const next = nextSessionScene(scenes, selected?.id);

  // What the drawer shows — undefined = closed. Sitting HERE
  // (not inside the aside) is what keeps scene selection and note draft
  // untouched while the drawer opens and closes.
  const [drawerTarget, setDrawerTarget] = useState<OpenTarget>();

  const markPlayed = useMarkScenePlayed(campaign);

  // Only the tree decides whether a scene's `location` is an entity: the
  // format allows a free string there, and that must stay plain text instead
  // of claiming a missing entry (degrade, README).
  const locationId = selected?.location;
  const knownLocation = tree.data?.locations.find((l) => l.id === locationId);

  if (session.isPending) {
    return <p className="px-7 pt-10 text-muted-foreground">{t("live.session.loading")}</p>;
  }
  if (session.data === null) {
    return <SessionStart campaign={campaign} />;
  }
  if (session.isError || session.data === undefined) {
    return <p className="px-7 pt-10 text-muted-foreground">{t("live.session.unloadable")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col max-lg:overflow-y-auto lg:flex-row">
      <nav
        aria-label={t("live.nav.aria")}
        className="flex-none border-b border-border px-3 py-[18px] lg:w-[250px] lg:overflow-y-auto lg:border-b-0 lg:border-r"
      >
        {/* The chapter the session plays. The topbar carries one session
            chip and nothing more, so the chapter title belongs here — next to
            the scenes it describes. */}
        {chapter !== undefined && (
          <p className="px-2 pb-3 font-serif text-[14px] text-foreground">{chapter.title}</p>
        )}
        <p className="px-2 pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
          {t("scene.planned.heading")}
        </p>
        <div className="mb-6 flex flex-col gap-0.5">
          {planned.map((scene) => (
            <SceneNavRow
              key={scene.id}
              scene={scene}
              active={scene.id === selected?.id}
              onPick={() => setSelectedId(scene.id)}
            />
          ))}
          {planned.length === 0 && (
            <p className="px-2 text-[12.5px] text-muted-foreground">
              {t("live.nav.noPlanned")}
            </p>
          )}
        </div>
        {contingencies.length > 0 && (
          <>
            <p className="px-2 pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
              {t("scene.contingencies.heading")}
            </p>
            <div className="mb-6 flex flex-col gap-0.5">
              {contingencies.map((scene) => (
                <SceneNavRow
                  key={scene.id}
                  scene={scene}
                  active={scene.id === selected?.id}
                  onPick={() => setSelectedId(scene.id)}
                />
              ))}
            </div>
          </>
        )}
        {done.length > 0 && (
          <PlayedGroup
            scenes={done}
            selectedId={selected?.id}
            onPick={setSelectedId}
          />
        )}
      </nav>

      <main className="min-w-0 flex-1 lg:overflow-y-auto">
        <div className="mx-auto max-w-[680px] px-7 pt-[30px] pb-[100px]">
          {selected === undefined ? (
            <p className="text-muted-foreground">{t("live.scene.none")}</p>
          ) : (
            // A `[[slug]]` in the scene text behaves like the aside cards
            // here: the click opens the DRAWER instead of navigating away
            // — the selected scene and the half-typed
            // quick note survive it.
            <>
              <RefDrawerTarget onOpen={setDrawerTarget}>
                {/* Keyed by the scene: a switch REMOUNTS the column instead of
                    reconciling the new text into the old nodes. Without it the
                    `## If:` branches the DM opened in one scene would stay open
                    in the next one — the branches start collapsed per scene and
                    nothing is remembered across a switch. */}
                <LiveScene key={selected.id} campaign={campaign} id={selected.id} />
              </RefDrawerTarget>
              {next !== undefined && (
                // Keyed by the scene it leaves: the played box starts
                // over in every scene.
                <NextSceneStep
                  key={selected.id}
                  session={session.data}
                  left={selected.id}
                  next={next}
                  markPlayed={markPlayed}
                  onNext={setSelectedId}
                />
              )}
            </>
          )}
        </div>
      </main>

      <aside className="flex w-full flex-none flex-col border-t border-border lg:min-h-0 lg:w-[300px] lg:border-t-0 lg:border-l">
        <div className="flex flex-col gap-3 px-4 py-[18px] lg:flex-1 lg:overflow-y-auto">
          {/* What the players should get or hear TONIGHT — above the scene
              cards, because it is about the table, not
              about the scene. Renders nothing when there is nothing. */}
          <PcReminders campaign={campaign} />
          {locationId !== undefined && (
            <>
              <p className="text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
                {t("live.scene.locationHeading")}
              </p>
              {knownLocation !== undefined ? (
                // The tree knows the location: the card reads it from its
                // own resource by its id (decisions/resources).
                <LocationCard campaign={campaign} id={knownLocation.id} onOpen={setDrawerTarget} />
              ) : (
                // A free-text location (no entry behind it) is exactly
                // what the format allows — show it, claim nothing.
                <p className="text-[12.5px] leading-[1.5] text-body-secondary">{locationId}</p>
              )}
            </>
          )}
          <p className="text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
            {t("live.scene.npcsHeading")}
          </p>
          {(selected?.npcs ?? []).map((id) => (
            <NpcCard key={id} campaign={campaign} id={id} compact onOpen={setDrawerTarget} />
          ))}
          {(selected?.npcs ?? []).length === 0 && (
            <p className="text-[12.5px] text-muted-foreground">{t("live.scene.noNpcs")}</p>
          )}
        </div>
        <SessionLog campaign={campaign} session={session.data} activeSceneId={selected?.id} />
      </aside>

      {/* A reference INSIDE the drawer switches the drawer, it does not
          navigate either — same rule, one level deeper. */}
      <RefDrawerTarget onOpen={setDrawerTarget}>
        <LiveDrawer
          campaign={campaign}
          target={drawerTarget}
          onClose={() => setDrawerTarget(undefined)}
        />
      </RefDrawerTarget>
    </div>
  );
}

/**
 * The scenes whose STATUS says they are behind us: dimmed, in a
 * group that starts collapsed. Collapsed/open is view state only — deliberately
 * NOT persisted (no localStorage for data either way). Selecting and
 * opening a scene in here works exactly as above.
 */
function PlayedGroup({
  scenes,
  selectedId,
  onPick,
}: {
  scenes: SceneSummary[];
  selectedId: string | undefined;
  onPick: (id: string) => void;
}) {
  const { t, tNode } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-2 pb-2 text-left text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground hover:text-body-secondary">
        <ChevronDown
          aria-hidden
          size={13}
          className="flex-none -rotate-90 transition-transform group-data-[state=open]:rotate-0"
        />
        {/* One sentence, one key: the count is a PART of the message (the
            quieter styling travels with it) instead of a heading glued to a
            number in JSX. */}
        {tNode("live.nav.playedGroup", {
          count: (
            <span key="count" className="font-normal tracking-normal normal-case text-faint">
              {`(${scenes.length})`}
            </span>
          ),
        })}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div role="group" aria-label={t("live.nav.played")} className="flex flex-col gap-0.5">
          {scenes.map((scene) => (
            <SceneNavRow
              key={scene.id}
              scene={scene}
              active={scene.id === selectedId}
              dimmed
              onPick={() => onPick(scene.id)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Left-nav row per the prototype: icon, brass left edge + darker bg when
 * active, a checkmark when the scene's status is `played`. `dimmed` is the
 * played group's quieter treatment — an active row stays readable. */
function SceneNavRow({
  scene,
  active,
  dimmed = false,
  onPick,
}: {
  scene: SceneSummary;
  active: boolean;
  dimmed?: boolean;
  onPick: () => void;
}) {
  const t = useT();
  const Icon = scene.type === "contingency" ? GitFork : Bookmark;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-[9px] rounded-r-md border-l-2 px-2.5 py-[9px] text-left text-[13.5px]",
        active
          ? "border-l-primary bg-secondary text-foreground"
          : dimmed
            ? "border-l-transparent text-faint hover:bg-divider hover:text-body-secondary"
            : "border-l-transparent text-body-secondary hover:bg-divider",
      )}
    >
      <Icon
        aria-hidden
        size={15}
        className={cn("flex-none", active ? "text-primary" : "text-muted-foreground")}
      />
      <span className="min-w-0 flex-1 truncate">{scene.title}</span>
      {scene.status === "played" && (
        <>
          <Check aria-hidden size={13} className="flex-none text-success-text" />
          <span className="sr-only">{t("status.scene.played")}</span>
        </>
      )}
    </button>
  );
}

/** Center column: the selected scene through the shared article pipeline. */
function LiveScene({ campaign, id }: { campaign: string; id: string }) {
  const t = useT();
  const { data, isPending, isError } = useQuery(sceneQuery(campaign, id));
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
  });

  if (isPending) return <p className="text-muted-foreground">{t("live.scene.loading")}</p>;
  if (isError || !data) {
    return <p className="text-muted-foreground">{t("live.scene.unloadable")}</p>;
  }
  return <SceneArticle scene={data} tree={tree.data} variant="live" />;
}

