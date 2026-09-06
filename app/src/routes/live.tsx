// "/:campaign/live" — the live mode (issue #9), three zones per the design
// prototype: left the planned scenes and contingencies of the ACTIVE
// chapter, center the selected scene through the same article pipeline as
// the reading view, right the location and NPC cards plus the log panel and
// the Schnellnotiz. The session file on the server is the truth: every write
// returns the fresh file, the "played" checkmark comes from scenes_played
// (server-maintained — never faked client-side). WHICH session is running is
// the server's answer too (GET /:campaign/session, issue #40) — a session
// past midnight lives in yesterday's file.
//
// Client state is exactly two things: the selected scene and which entity the
// detail drawer shows (issue #40). Aside cards therefore do NOT navigate here
// — a click used to leave the live route and take the selected scene and the
// half-typed Schnellnotiz with it.
// There is NO mobile live mode (UI-BRIEF §4) — below md the route shows a
// quiet note with a link to the read view of the active scene instead.

import type { SceneSummary } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Check, ChevronDown, GitFork } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { appendLog, endSession, fetchFile, fetchTree } from "@/api";
import { LiveEntityDrawer } from "@/components/LiveEntityDrawer";
import { LocationCard } from "@/components/LocationCard";
import { MobileBackRow } from "@/components/MobileBackRow";
import { NpcCard } from "@/components/NpcCard";
import { SceneArticle } from "@/components/SceneArticle";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fmStringArray } from "@/lib/properties";
import { isSceneDone } from "@/lib/scene-status";
import { parseLogEntries } from "@/lib/session";
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
        <p className="text-[14px] leading-[1.6] text-muted-foreground">
          Der Live-Modus ist für den Desktop gedacht.
        </p>
        {scene !== undefined && (
          <Link
            to={`/${campaign}/file/${scene.path}`}
            className="mt-2 inline-flex min-h-11 items-center text-[15px] text-primary hover:text-primary-hover"
          >
            Szene lesen: {scene.title}
          </Link>
        )}
      </div>
    </>
  );
}

function LiveDesktop({ campaign }: { campaign: string }) {
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
  // The scene STATUS splits the plan (issue #73): `played`/`dropped` scenes
  // drop out of "Geplant" into the collapsed "Gespielt" group below. The
  // session checkmark is a different thing and stays on top of both (AK2).
  const nonContingency = scenes.filter((s) => s.type !== "contingency");
  const planned = nonContingency.filter((s) => !isSceneDone(s.status));
  const done = nonContingency.filter((s) => isSceneDone(s.status));
  const contingencies = scenes.filter((s) => s.type === "contingency");

  // Selected scene = client state (path); default: FIRST PLANNED scene, never
  // a played one (AK3). With everything played the fallbacks keep the view
  // usable instead of blanking it: a done scene, else any scene, else the
  // empty note in the center column.
  const [selectedPath, setSelectedPath] = useState<string>();
  const selected =
    scenes.find((s) => s.path === selectedPath) ?? planned[0] ?? done[0] ?? scenes[0];

  // Which entity file the drawer shows — undefined = closed. Sitting HERE
  // (not inside the aside) is what keeps scene selection and note draft
  // untouched while the drawer opens and closes.
  const [drawerPath, setDrawerPath] = useState<string>();

  const playedIds = fmStringArray(session.data?.properties.scenes_played);

  // Only the tree decides whether a scene's `location` is an entity: the
  // format allows a free string there, and that must stay plain text instead
  // of claiming a missing file (degrade, README).
  const locationId = selected?.location;
  const knownLocation = tree.data?.locations.find((l) => l.id === locationId);

  if (session.isPending) {
    return <p className="px-7 pt-10 text-muted-foreground">Lade Session …</p>;
  }
  if (session.data === null) {
    return <NoSessionYet campaign={campaign} />;
  }
  if (session.isError || session.data === undefined) {
    return (
      <p className="px-7 pt-10 text-muted-foreground">
        Session nicht ladbar — Server prüfen und neu laden.
      </p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col max-lg:overflow-y-auto lg:flex-row">
      <nav
        aria-label="Szenen der Session"
        className="flex-none border-b border-border px-3 py-[18px] lg:w-[250px] lg:overflow-y-auto lg:border-b-0 lg:border-r"
      >
        {/* The chapter the session plays. It used to sit in the topbar next to
            the live pill; with the topbar consolidated to one session chip
            (PO feedback on issue #40) it belongs here — next to the scenes it
            describes. */}
        {chapter !== undefined && (
          <p className="px-2 pb-3 font-serif text-[14px] text-foreground">{chapter.title}</p>
        )}
        <p className="px-2 pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
          Geplant
        </p>
        <div className="mb-6 flex flex-col gap-0.5">
          {planned.map((scene) => (
            <SceneNavRow
              key={scene.path}
              scene={scene}
              active={scene.path === selected?.path}
              played={playedIds.includes(scene.id)}
              onPick={() => setSelectedPath(scene.path)}
            />
          ))}
          {planned.length === 0 && (
            <p className="px-2 text-[12.5px] text-muted-foreground">
              Keine geplanten Szenen in diesem Kapitel.
            </p>
          )}
        </div>
        {contingencies.length > 0 && (
          <>
            <p className="px-2 pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
              Falls es schiefgeht
            </p>
            <div className="mb-6 flex flex-col gap-0.5">
              {contingencies.map((scene) => (
                <SceneNavRow
                  key={scene.path}
                  scene={scene}
                  active={scene.path === selected?.path}
                  played={playedIds.includes(scene.id)}
                  onPick={() => setSelectedPath(scene.path)}
                />
              ))}
            </div>
          </>
        )}
        {done.length > 0 && (
          <PlayedGroup
            scenes={done}
            selectedPath={selected?.path}
            playedIds={playedIds}
            onPick={setSelectedPath}
          />
        )}
      </nav>

      <main className="min-w-0 flex-1 lg:overflow-y-auto">
        <div className="mx-auto max-w-[680px] px-7 pt-[30px] pb-[100px]">
          {selected === undefined ? (
            <p className="text-muted-foreground">
              Keine Szene im aktiven Kapitel — Szenen im Pool anlegen.
            </p>
          ) : (
            // A `[[slug]]` in the scene text behaves like the aside cards
            // here: the click opens the DRAWER instead of navigating away
            // (issue #68) — the selected scene and the half-typed
            // Schnellnotiz survive it.
            <EntityRefDrawerTarget onOpen={setDrawerPath}>
              <LiveScene campaign={campaign} path={selected.path} />
            </EntityRefDrawerTarget>
          )}
        </div>
      </main>

      <aside className="flex w-full flex-none flex-col border-t border-border lg:min-h-0 lg:w-[300px] lg:border-t-0 lg:border-l">
        <div className="flex flex-col gap-3 px-4 py-[18px] lg:flex-1 lg:overflow-y-auto">
          {locationId !== undefined && (
            <>
              <p className="text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
                Ort
              </p>
              {knownLocation !== undefined ? (
                // The tree knows the REAL path of the file — the card must not
                // re-derive `locations/<id>.md` (finding 10).
                <LocationCard
                  campaign={campaign}
                  id={knownLocation.id}
                  path={knownLocation.path}
                  onOpen={setDrawerPath}
                />
              ) : (
                // A free-text location (no entity file behind it) is exactly
                // what the format allows — show it, claim nothing.
                <p className="text-[12.5px] leading-[1.5] text-body-secondary">{locationId}</p>
              )}
            </>
          )}
          <p className="text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
            NPCs
          </p>
          {(selected?.npcs ?? []).map((id) => (
            <NpcCard key={id} campaign={campaign} id={id} compact onOpen={setDrawerPath} />
          ))}
          {(selected?.npcs ?? []).length === 0 && (
            <p className="text-[12.5px] text-muted-foreground">Keine NPCs in dieser Szene.</p>
          )}
        </div>
        <LogPanel campaign={campaign} body={session.data.body} activeSceneId={selected?.id} />
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
 * The scenes whose STATUS says they are behind us (issue #73): dimmed, in a
 * group that starts collapsed. Collapsed/open is view state only — deliberately
 * NOT persisted (AK1, and no localStorage for data either way). Selecting and
 * opening a scene in here works exactly as above.
 */
function PlayedGroup({
  scenes,
  selectedPath,
  playedIds,
  onPick,
}: {
  scenes: SceneSummary[];
  selectedPath: string | undefined;
  playedIds: string[];
  onPick: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-2 pb-2 text-left text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground hover:text-body-secondary">
        <ChevronDown
          aria-hidden
          size={13}
          className="flex-none -rotate-90 transition-transform group-data-[state=open]:rotate-0"
        />
        <span>Gespielt</span>
        <span className="font-normal tracking-normal normal-case text-faint">
          ({scenes.length})
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div role="group" aria-label="Gespielt" className="flex flex-col gap-0.5">
          {scenes.map((scene) => (
            <SceneNavRow
              key={scene.path}
              scene={scene}
              active={scene.path === selectedPath}
              played={playedIds.includes(scene.id)}
              dimmed
              onPick={() => onPick(scene.path)}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Left-nav row per the prototype: icon, brass left edge + darker bg when
 * active, played checkmark from scenes_played. `dimmed` is the "Gespielt"
 * group's quieter treatment (issue #73) — an active row stays readable. */
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
          <span className="sr-only">gespielt</span>
        </>
      )}
    </button>
  );
}

/** Center column: the selected scene through the shared article pipeline. */
function LiveScene({ campaign, path }: { campaign: string; path: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["file", campaign, path],
    queryFn: () => fetchFile(campaign, path),
  });
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
  });

  if (isPending) return <p className="text-muted-foreground">Lade Szene …</p>;
  if (isError || !data) {
    return <p className="text-muted-foreground">Szene nicht ladbar — Pfad prüfen.</p>;
  }
  return <SceneArticle file={data} tree={tree.data} variant="live" />;
}

/** Log panel (newest first) pinned above the Schnellnotiz — recessed panel,
 * max ~46% of the aside. Nothing may ever overlay the note input. */
function LogPanel({
  campaign,
  body,
  activeSceneId,
}: {
  campaign: string;
  body: string;
  activeSceneId: string | undefined;
}) {
  const [note, setNote] = useState("");
  const entries = parseLogEntries(body).reverse();
  const log = useSessionWrite(campaign, (vars: { text: string; sceneId?: string }) =>
    appendLog(campaign, vars.text, vars.sceneId),
  );

  const send = () => {
    const text = note.trim();
    if (text === "") return;
    // Clear immediately (the input keeps focus); a failed send restores the
    // text unless the DM already typed something new.
    setNote("");
    log.mutate(
      activeSceneId === undefined ? { text } : { text, sceneId: activeSceneId },
      { onError: () => setNote((current) => (current === "" ? text : current)) },
    );
  };

  return (
    <div className="flex flex-none flex-col border-t border-border bg-panel-deep lg:max-h-[46%]">
      <p className="px-4 pt-3.5 pb-2 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
        Log
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-2.5">
        {entries.length === 0 && (
          <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
            Noch keine Einträge — die Schnellnotiz unten landet hier.
          </p>
        )}
        {entries.map((entry, index) => (
          <div key={index} className="flex gap-2 text-[12.5px] leading-[1.5]">
            {entry.time !== undefined && (
              <span className="flex-none font-mono text-muted-foreground">{entry.time}</span>
            )}
            <span className="min-w-0 text-body">{entry.text}</span>
          </div>
        ))}
      </div>
      <div className="flex-none px-4 pt-1 pb-3.5">
        {log.isError && (
          <p className="mb-1.5 text-[11.5px] text-destructive">
            Notiz nicht gespeichert — Server prüfen.
          </p>
        )}
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          placeholder="Schnellnotiz … #thread #npc #loot"
          aria-label="Schnellnotiz"
          className="w-full rounded-lg border border-input bg-card px-[13px] py-[11px] text-[13.5px] text-foreground placeholder:text-muted-foreground"
        />
        <p className="mt-[7px] text-[11.5px] text-faint">
          Enter sendet · Zeit und Szene werden automatisch gesetzt
        </p>
      </div>
    </div>
  );
}

/**
 * Quiet empty state when the live route is opened while nothing is running —
 * and the ONE place a start conflict becomes a question the DM can answer
 * (issue #40 review, finding 2).
 *
 * Exactly ONE conflict is a question here: `session_running`, an OLDER
 * session that was never ended — ending someone else's evening is not implied
 * by "starten". An already ended session of today is no question at all: the
 * start opens the NEXT session of the day (issue #58), so there is no
 * "fortsetzen" here either.
 */
function NoSessionYet({ campaign }: { campaign: string }) {
  const { enter, entering, conflict, conflictPath, failed } = useSessionStartFlow(campaign);
  const end = useSessionWrite(campaign, () => endSession(campaign));
  const busy = entering || end.isPending;
  return (
    <div className="flex h-full items-center justify-center px-7">
      <div className="max-w-[380px] text-center">
        {conflict === "session_running" ? (
          <>
            <p className="mb-4 text-[14px] leading-[1.6] text-muted-foreground">
              Eine ältere Session läuft noch
              {conflictPath === undefined ? "" : ` (${conflictPath})`} — erst beenden.
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => end.mutate()}
              className="h-auto px-4 py-2 text-[13px]"
            >
              Alte Session beenden
            </Button>
          </>
        ) : (
          <>
            <p className="mb-4 text-[14px] text-muted-foreground">Es läuft keine Session.</p>
            <Button
              type="button"
              disabled={busy}
              onClick={() => enter()}
              className="h-auto px-4 py-2 text-[13px] font-semibold"
            >
              Session starten
            </Button>
          </>
        )}
        {(failed || end.isError) && (
          <p className="mt-3 text-[12.5px] text-destructive">
            Session nicht geändert — Server prüfen.
          </p>
        )}
      </div>
    </div>
  );
}
