// "/campaigns/:campaign/live" — the live mode, three zones per the design
// prototype: left the planned scenes and contingencies of the ACTIVE
// chapter, center the selected scene through the same article pipeline as
// the reading view, right the location and NPC cards plus the log panel and
// the Schnellnotiz. The session on the server is the truth: every write
// returns the fresh session, the "played" checkmark comes from its played
// scenes (server-maintained — never faked client-side). WHICH session is running is
// the server's answer too (GET /campaigns/:campaign/session) — a session
// past midnight lives in yesterday's session.
//
// Client state is exactly two things: the selected scene and which entity the
// detail drawer shows. Aside cards therefore do NOT navigate here
// — a click would leave the live route and take the selected scene and the
// half-typed Schnellnotiz with it.
// There is NO mobile live mode (UI-BRIEF §4) — below md the route shows a
// quiet note with a link to the read view of the active scene instead.

import type { SceneSummary, SessionLogEntry } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Check, ChevronDown, GitFork } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { appendLog, endSession, fetchEntry, fetchTree } from "@/api";
import { LiveEntityDrawer } from "@/components/LiveEntityDrawer";
import { LocationCard } from "@/components/LocationCard";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NpcCard } from "@/components/NpcCard";
import { PcReminders } from "@/components/PcReminders";
import { SceneArticle } from "@/components/SceneArticle";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useI18n, useT } from "@/i18n";
import { isSceneDone } from "@/lib/scene-status";
import { EntityRefDrawerTarget } from "@/markdown/entity-refs";
import { cn } from "@/lib/utils";
import { useActiveSession, useSessionStartFlow, useSessionWrite } from "@/lib/use-session";

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
  // "Active scene" = the live view's default selection: first planned scene
  // of the active chapter (fallbacks as in LiveDesktop).
  const chapters = tree.data?.chapters ?? [];
  const chapter = chapters.find((ch) => ch.status === "active") ?? chapters[0];
  const scenes = chapter?.groups.flatMap((g) => g.scenes) ?? [];
  const openScenes = scenes.filter((s) => s.type !== "contingency" && !isSceneDone(s.status));
  const scene = openScenes[0] ?? scenes.find((s) => s.type !== "contingency") ?? scenes[0];

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="px-5 pt-12 text-center">
        <p className="text-[14px] leading-[1.6] text-muted-foreground">{t("live.mobile.note")}</p>
        {scene !== undefined && (
          <Link
            to={`/campaigns/${campaign}/entries/${scene.path}`}
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
  const session = useActiveSession(campaign);
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  // The live nav shows the ACTIVE chapter; without one, the first.
  const chapters = tree.data?.chapters ?? [];
  const chapter = chapters.find((ch) => ch.status === "active") ?? chapters[0];
  const scenes = chapter?.groups.flatMap((g) => g.scenes) ?? [];
  // The scene STATUS splits the plan: `played`/`dropped` scenes
  // drop out of "Geplant" into the collapsed "Gespielt" group below. The
  // session checkmark is a different thing and stays on top of both.
  const nonContingency = scenes.filter((s) => s.type !== "contingency");
  const planned = nonContingency.filter((s) => !isSceneDone(s.status));
  const done = nonContingency.filter((s) => isSceneDone(s.status));
  const contingencies = scenes.filter((s) => s.type === "contingency");

  // Selected scene = client state (the scene's ID); default: FIRST PLANNED
  // scene, never a played one. With everything played the fallbacks keep
  // the view usable instead of blanking it: a done scene, else any scene, else
  // the empty note in the center column.
  //
  // The ID and not the address: a scene's address carries its
  // `location`, so a location change moves the address out from under the
  // selection — the tree refetches, no scene matches the stored path any
  // more, and the live view jumps to the first planned scene mid-session.
  const [selectedId, setSelectedId] = useState<string>();
  const selected =
    scenes.find((s) => s.id === selectedId) ?? planned[0] ?? done[0] ?? scenes[0];

  // Which entry the drawer shows — undefined = closed. Sitting HERE
  // (not inside the aside) is what keeps scene selection and note draft
  // untouched while the drawer opens and closes.
  const [drawerPath, setDrawerPath] = useState<string>();

  const playedIds = session.data?.scenesPlayed ?? [];

  // Only the tree decides whether a scene's `location` is an entity: the
  // format allows a free string there, and that must stay plain text instead
  // of claiming a missing entry (degrade, README).
  const locationId = selected?.location;
  const knownLocation = tree.data?.locations.find((l) => l.id === locationId);

  if (session.isPending) {
    return <p className="px-7 pt-10 text-muted-foreground">{t("live.session.loading")}</p>;
  }
  if (session.data === null) {
    return <NoSessionYet campaign={campaign} />;
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
              key={scene.path}
              scene={scene}
              active={scene.id === selected?.id}
              played={playedIds.includes(scene.id)}
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
                  key={scene.path}
                  scene={scene}
                  active={scene.id === selected?.id}
                  played={playedIds.includes(scene.id)}
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
            playedIds={playedIds}
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
            // Schnellnotiz survive it.
            <EntityRefDrawerTarget onOpen={setDrawerPath}>
              <LiveScene campaign={campaign} path={selected.path} />
            </EntityRefDrawerTarget>
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
                // The tree knows the REAL path of the entry — the card must not
                // re-derive `locations/<id>`.
                <LocationCard
                  campaign={campaign}
                  id={knownLocation.id}
                  path={knownLocation.path}
                  onOpen={setDrawerPath}
                />
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
            <NpcCard key={id} campaign={campaign} id={id} compact onOpen={setDrawerPath} />
          ))}
          {(selected?.npcs ?? []).length === 0 && (
            <p className="text-[12.5px] text-muted-foreground">{t("live.scene.noNpcs")}</p>
          )}
        </div>
        <LogPanel campaign={campaign} log={session.data.log} activeSceneId={selected?.id} />
      </aside>

      {/* A reference INSIDE the drawer switches the drawer, it does not
          navigate either — same rule, one level deeper. */}
      <EntityRefDrawerTarget onOpen={setDrawerPath}>
        <LiveEntityDrawer
          campaign={campaign}
          path={drawerPath}
          onClose={() => setDrawerPath(undefined)}
        />
      </EntityRefDrawerTarget>
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
  playedIds,
  onPick,
}: {
  scenes: SceneSummary[];
  selectedId: string | undefined;
  playedIds: string[];
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
              key={scene.path}
              scene={scene}
              active={scene.id === selectedId}
              played={playedIds.includes(scene.id)}
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
 * active, played checkmark from scenes_played. `dimmed` is the "Gespielt"
 * group's quieter treatment — an active row stays readable. */
function SceneNavRow({
  scene,
  active,
  played,
  dimmed = false,
  onPick,
}: {
  scene: SceneSummary;
  active: boolean;
  played: boolean;
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
      {played && (
        <>
          <Check aria-hidden size={13} className="flex-none text-success-text" />
          <span className="sr-only">{t("status.scene.played")}</span>
        </>
      )}
    </button>
  );
}

/** Center column: the selected scene through the shared article pipeline. */
function LiveScene({ campaign, path }: { campaign: string; path: string }) {
  const t = useT();
  const { data, isPending, isError } = useQuery({
    queryKey: ["entry", campaign, path],
    queryFn: () => fetchEntry(campaign, path),
  });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
  });

  if (isPending) return <p className="text-muted-foreground">{t("live.scene.loading")}</p>;
  if (isError || !data) {
    return <p className="text-muted-foreground">{t("live.scene.unloadable")}</p>;
  }
  return <SceneArticle entry={data} tree={tree.data} variant="live" />;
}

/** Log panel (newest first) pinned above the Schnellnotiz — recessed panel,
 * max ~46% of the aside. Nothing may ever overlay the note input. */
function LogPanel({
  campaign,
  log,
  activeSceneId,
}: {
  campaign: string;
  log: readonly SessionLogEntry[];
  activeSceneId: string | undefined;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const rows = [...log].reverse();
  const append = useSessionWrite(campaign, (vars: { text: string; sceneId?: string }) =>
    appendLog(campaign, vars.text, vars.sceneId),
  );

  const send = () => {
    const text = note.trim();
    if (text === "") return;
    // Clear immediately (the input keeps focus); a failed send restores the
    // text unless the DM already typed something new.
    setNote("");
    append.mutate(
      activeSceneId === undefined ? { text } : { text, sceneId: activeSceneId },
      { onError: () => setNote((current) => (current === "" ? text : current)) },
    );
  };

  return (
    <div className="flex flex-none flex-col border-t border-border bg-panel-deep lg:max-h-[46%]">
      <p className="px-4 pt-3.5 pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
        {t("live.log.heading")}
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-2.5">
        {rows.length === 0 && (
          <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
            {t("live.log.empty")}
          </p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="flex gap-2 text-[12.5px] leading-[1.5]">
            {row.at !== "" && (
              <span className="flex-none font-mono text-muted-foreground">{row.at}</span>
            )}
            <span className="min-w-0 text-body">{row.text}</span>
          </div>
        ))}
      </div>
      <div className="flex-none px-4 pt-1 pb-3.5">
        {append.isError && (
          <p className="mb-1.5 text-[11.5px] text-destructive">{t("live.note.failed")}</p>
        )}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          placeholder={t("live.note.placeholder")}
          aria-label={t("live.note.aria")}
          className="w-full rounded-lg border border-input bg-card px-[13px] py-[11px] text-[13.5px] text-foreground placeholder:text-muted-foreground"
        />
        <p className="mt-[7px] text-[11.5px] text-faint">{t("live.note.hint")}</p>
      </div>
    </div>
  );
}

/**
 * Quiet empty state when the live route is opened while nothing is running —
 * and the ONE place a start conflict becomes a question the DM can answer.
 *
 * Exactly ONE conflict is a question here: `session_running`, an OLDER
 * session that was never ended — ending someone else's evening is not implied
 * by "starten". An already ended session of today is no question at all: the
 * start opens the NEXT session of the day, so there is no
 * "fortsetzen" here either.
 */
function NoSessionYet({ campaign }: { campaign: string }) {
  const t = useT();
  const { enter, entering, conflict, conflictSessionId, failed } = useSessionStartFlow(campaign);
  const end = useSessionWrite(campaign, () => endSession(campaign));
  const busy = entering || end.isPending;
  return (
    <div className="flex h-full items-center justify-center px-7">
      <div className="max-w-[380px] text-center">
        {conflict === "session_running" ? (
          <>
            <p className="mb-4 text-[14px] leading-[1.6] text-muted-foreground">
              {/* One sentence either way — the session is a parameter, not a
                  fragment pasted between two halves. */}
              {conflictSessionId === undefined
                ? t("live.session.olderRunning")
                : t("live.session.olderRunning.withSession", { session: conflictSessionId })}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => end.mutate()}
              className="h-auto px-4 py-2 text-[13px]"
            >
              {t("live.session.endOld")}
            </Button>
          </>
        ) : (
          <>
            <p className="mb-4 text-[14px] text-muted-foreground">{t("live.session.none")}</p>
            <Button
              type="button"
              disabled={busy}
              onClick={() => enter()}
              className="h-auto px-4 py-2 text-[13px] font-semibold"
            >
              {t("session.start")}
            </Button>
          </>
        )}
        {(failed || end.isError) && (
          <p className="mt-3 text-[12.5px] text-destructive">{t("session.write.failed")}</p>
        )}
      </div>
    </div>
  );
}
