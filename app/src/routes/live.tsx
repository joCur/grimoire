// "/:campaign/live" — the live mode (issue #9), three zones per the design
// prototype: left the planned scenes and contingencies of the ACTIVE
// chapter, center the selected scene through the same article pipeline as
// the reading view, right the NPC cards plus the log panel and the
// Schnellnotiz. The session file on the server is the truth: every write
// returns the fresh file, the "played" checkmark comes from scenes_played
// (server-maintained — never faked client-side). The only client state is
// which scene is selected.

import type { SceneSummary } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, Check, GitFork } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import { appendLog, fetchFile, fetchTree, startSession } from "@/api";
import { NpcCard } from "@/components/NpcCard";
import { SceneArticle } from "@/components/SceneArticle";
import { Button } from "@/components/ui/button";
import { fmStringArray } from "@/lib/frontmatter";
import { parseLogEntries } from "@/lib/session";
import { cn } from "@/lib/utils";
import { noSessionYet, useSessionFile, useSessionWrite } from "@/lib/use-session";

export function LiveRoute() {
  const { campaign = "" } = useParams();
  const session = useSessionFile(campaign);
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });

  // The live nav shows the ACTIVE chapter; without one, the first.
  const chapters = tree.data?.chapters ?? [];
  const chapter = chapters.find((ch) => ch.status === "active") ?? chapters[0];
  const scenes = chapter?.groups.flatMap((g) => g.scenes) ?? [];
  const planned = scenes.filter((s) => s.type !== "contingency");
  const contingencies = scenes.filter((s) => s.type === "contingency");

  // Selected scene = client state (path); default: first planned scene.
  const [selectedPath, setSelectedPath] = useState<string>();
  const selected = scenes.find((s) => s.path === selectedPath) ?? planned[0] ?? scenes[0];

  const playedIds = fmStringArray(session.data?.frontmatter.scenes_played);

  if (session.isError && noSessionYet(session.error)) {
    return <NoSessionYet campaign={campaign} />;
  }
  if (session.isPending) {
    return <p className="px-7 pt-10 text-muted-foreground">Lade Session …</p>;
  }
  if (session.isError) {
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
            <div className="flex flex-col gap-0.5">
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
      </nav>

      <main className="min-w-0 flex-1 lg:overflow-y-auto">
        <div className="mx-auto max-w-[680px] px-7 pt-[30px] pb-[100px]">
          {selected === undefined ? (
            <p className="text-muted-foreground">
              Keine Szene im aktiven Kapitel — Szenen im Pool anlegen.
            </p>
          ) : (
            <LiveScene campaign={campaign} path={selected.path} />
          )}
        </div>
      </main>

      <aside className="flex w-full flex-none flex-col border-t border-border lg:min-h-0 lg:w-[300px] lg:border-t-0 lg:border-l">
        <div className="flex flex-col gap-3 px-4 py-[18px] lg:flex-1 lg:overflow-y-auto">
          <p className="text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
            NPCs
          </p>
          {(selected?.npcs ?? []).map((id) => (
            <NpcCard key={id} campaign={campaign} id={id} compact />
          ))}
          {(selected?.npcs ?? []).length === 0 && (
            <p className="text-[12.5px] text-muted-foreground">Keine NPCs in dieser Szene.</p>
          )}
        </div>
        <LogPanel campaign={campaign} body={session.data.body} activeSceneId={selected?.id} />
      </aside>
    </div>
  );
}

/** Left-nav row per the prototype: icon, brass left edge + darker bg when
 * active, played checkmark from scenes_played. */
function SceneNavRow({
  scene,
  active,
  played,
  onPick,
}: {
  scene: SceneSummary;
  active: boolean;
  played: boolean;
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
    return <p className="text-muted-foreground">Szene nicht ladbar — Datei prüfen.</p>;
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

/** Quiet empty state when the live route is opened without a session today. */
function NoSessionYet({ campaign }: { campaign: string }) {
  const start = useSessionWrite(campaign, () => startSession(campaign));
  return (
    <div className="flex h-full items-center justify-center px-7">
      <div className="text-center">
        <p className="mb-4 text-[14px] text-muted-foreground">
          Heute läuft noch keine Session.
        </p>
        <Button
          type="button"
          disabled={start.isPending}
          onClick={() => start.mutate()}
          className="h-auto px-4 py-2 text-[13px] font-semibold"
        >
          Session starten
        </Button>
        {start.isError && (
          <p className="mt-3 text-[12.5px] text-destructive">
            Session nicht gestartet — Server prüfen.
          </p>
        )}
      </div>
    </div>
  );
}
