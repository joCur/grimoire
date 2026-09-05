// NPC card fed from npcs/<id>.md — voice, "Will" (first paragraph of the
// `## Will` section) and quickstats, exactly those three per UI-BRIEF.
// Two densities per the design prototype: the scene aside ("full", with id
// badge and labeled rows) and the live aside ("compact", inline "Will:").
// The whole card links to the NPC reading view (issue #26) — UNLESS the caller
// passes `onOpen`: in the live mode (issue #40) the card must not navigate
// away from the running session, it opens the detail drawer instead. Same
// card, same hover, only the element differs (link vs. button).
//
// Degradation (issue #26): a referenced id WITHOUT a file used to render
// nothing at all — the DM saw a bare slug in the scene and no explanation.
// Now the 404 shows a quiet placeholder with "Stub anlegen" (POST
// /review/npc-stub), so the gap is visible and closable from where it hurts.
// Any OTHER failure stays a quiet one-liner (server down — nothing to fix
// here), and while the query is still running nothing is claimed at all.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, fetchFile } from "@/api";
import { EntityCardShell } from "@/components/EntityCardShell";
import { Button } from "@/components/ui/button";
import { fmQuickstats, fmString } from "@/lib/frontmatter";
import { firstParagraphOfSection } from "@/lib/md-section";
import { ensureNpcStub } from "@/lib/npc-stub";
import { cn } from "@/lib/utils";

/** Campaign-relative path of an npc file — the reference key is the id. */
function npcPath(id: string): string {
  return `npcs/${id}.md`;
}

export function NpcCard({
  campaign,
  id,
  compact = false,
  onOpen,
}: {
  campaign: string;
  id: string;
  compact?: boolean;
  /**
   * When given, the card is a BUTTON that hands the npc's campaign-relative
   * path to the caller instead of navigating (live mode drawer, issue #40).
   */
  onOpen?: (path: string) => void;
}) {
  const path = npcPath(id);
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["file", campaign, path],
    queryFn: () => fetchFile(campaign, path),
    retry: false,
  });

  const stub = useMutation({
    // 409 (the file exists now) counts as success — see lib/npc-stub.ts.
    mutationFn: () => ensureNpcStub(campaign, id),
    onSuccess: (file) => {
      // The endpoint returns the fresh file: seed, then invalidate on top.
      if (file !== undefined) queryClient.setQueryData(["file", campaign, file.path], file);
      void queryClient.invalidateQueries({ queryKey: ["file", campaign, path] });
      // A new npc file changes the tree (lists, search) as well.
      void queryClient.invalidateQueries({ queryKey: ["tree", campaign] });
    },
  });

  // Nothing decided yet — never claim a missing file while loading.
  if (isPending) return null;

  if (isError) {
    const missing = error instanceof ApiError && error.status === 404;
    if (!missing) {
      return (
        <p className="text-[12px] leading-[1.5] text-muted-foreground">
          <span className="font-mono">{id}</span> — NPC nicht ladbar, Server prüfen.
        </p>
      );
    }
    return (
      <MissingNpcCard
        id={id}
        compact={compact}
        pending={stub.isPending}
        error={stub.isError ? "Stub nicht angelegt — Server prüfen." : undefined}
        onCreate={() => {
          stub.reset();
          stub.mutate();
        }}
      />
    );
  }
  if (data === undefined) return null;

  const fm = data.frontmatter;
  const name = fmString(fm.name) ?? id;
  const npcId = fmString(fm.id) ?? id;
  const role = fmString(fm.role);
  const voice = fmString(fm.voice);
  const will = firstParagraphOfSection(data.body, "Will");
  const quickstats = fmQuickstats(fm.quickstats);

  if (compact) {
    return (
      <EntityCardShell campaign={campaign} path={path} onOpen={onOpen} className="p-3.5">
        <p className="mb-px font-serif text-[15px] font-semibold text-foreground">{name}</p>
        {role !== undefined && (
          <p className="mb-[9px] text-[12px] text-muted-foreground">{role}</p>
        )}
        {voice !== undefined && (
          <p className="mb-2 text-[12.5px] leading-[1.5] text-body italic">{voice}</p>
        )}
        {will !== undefined && (
          <p className="mb-2.5 text-[12.5px] leading-[1.5] text-body-secondary">
            <span className="text-muted-foreground">Will:</span> {will}
          </p>
        )}
        {quickstats.length > 0 && (
          <div className="flex flex-wrap gap-[5px]">
            {quickstats.map(([key, value]) => (
              <span
                key={key}
                className="rounded-[4px] border border-input bg-background px-1.5 py-[2px] font-mono text-[10.5px] text-soft"
              >
                {key} {value}
              </span>
            ))}
          </div>
        )}
      </EntityCardShell>
    );
  }

  return (
    <EntityCardShell campaign={campaign} path={path} onOpen={onOpen} className="p-4">
      <div className="mb-[2px] flex items-baseline gap-2">
        <span className="font-serif text-[16px] font-semibold text-foreground">{name}</span>
        <span className="font-mono text-[10.5px] text-faint">{npcId}</span>
      </div>
      {role !== undefined && <p className="mb-3 text-[12.5px] text-muted-foreground">{role}</p>}
      {voice !== undefined && (
        <>
          <p className="mb-[3px] text-[11px] tracking-[.06em] uppercase text-muted-foreground">
            Stimme
          </p>
          <p className="mb-2.5 text-[13px] leading-[1.5] text-body italic">{voice}</p>
        </>
      )}
      {will !== undefined && (
        <>
          <p className="mb-[3px] text-[11px] tracking-[.06em] uppercase text-muted-foreground">
            Will
          </p>
          <p className="mb-3 text-[13px] leading-[1.5] text-body">{will}</p>
        </>
      )}
      {quickstats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {quickstats.map(([key, value]) => (
            <span
              key={key}
              className="rounded-[4px] border border-input bg-background px-[7px] py-[3px] font-mono text-[11px] text-soft"
            >
              {key} {value}
            </span>
          ))}
        </div>
      )}
    </EntityCardShell>
  );
}

/**
 * The visible degradation of a referenced npc id without a file: mono slug,
 * the reason, and the one action that fixes it. Exported for the render test
 * — it is pure, the query/mutation lives in NpcCard.
 */
export function MissingNpcCard({
  id,
  compact = false,
  pending,
  error,
  onCreate,
}: {
  id: string;
  compact?: boolean;
  pending: boolean;
  error?: string | undefined;
  onCreate: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-input bg-transparent",
        compact ? "p-3.5" : "p-4",
      )}
    >
      <p className="font-mono text-[12.5px] text-soft">{id}</p>
      <p className="mt-1 mb-2.5 text-[12.5px] leading-[1.5] text-muted-foreground">
        NPC-Datei fehlt
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={onCreate}
        className="h-auto border-input bg-transparent px-2.5 py-1 text-[12px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
      >
        Stub anlegen
      </Button>
      {error !== undefined && (
        <p className="mt-2 text-[12px] text-destructive" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
