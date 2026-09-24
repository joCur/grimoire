// What the hover preview of a `[[slug]]` reference says about its target — a
// glimpse, not the entry: a head line with kind and status, then the rows of
// the compact card (components/EntityCompact.tsx) for an NPC or a location,
// or the scene's own short form (type, trigger, location).
//
// Kind and name are known before anything loads — the tree that resolved the
// reference has them — so the card opens labelled, never empty. The rest
// comes with the entry — for a location its own resource (ADR #31) — under
// the SAME query key the aside cards and the drawer use, so an entry one of them already read is not asked for again
// (`staleTime: Infinity`: only the version poll's invalidation makes it
// stale). While it loads, static placeholder bars stand in; if it fails, the
// card simply keeps kind and name — mid-sentence an error line is noise.
//
// Passive by contract: nothing in here is a link or a control, and names
// inside an excerpt are plain text (lib/entity-excerpt.ts).

import { useQuery } from "@tanstack/react-query";
import { Skull } from "lucide-react";
import type { ReactNode } from "react";

import type { NpcStatus, SceneStatus } from "@grimoire/shared/types";

import { fetchEntry, fetchLocation, fetchTree } from "@/api";
import { CompactName, LocationCompact, NpcCompact } from "@/components/EntityCompact";
import { useT, type Translate } from "@/i18n";
import { npcStatusLabel } from "@/lib/entity";
import {
  locationExcerpt,
  npcExcerpt,
  sceneExcerpt,
  type NameOf,
  type SceneExcerpt,
} from "@/lib/entity-excerpt";
import { sceneStatusMeta } from "@/lib/scene-status";
import { locationKey } from "@/lib/use-location-edit";
import { cn } from "@/lib/utils";
import type { ResolvedEntityRef } from "@/markdown/entity-refs";

/** How loud a status is: alive/ready are good news, dead is the one warning. */
type StatusTone = "good" | "dead" | "quiet";

interface StatusLine {
  label: string;
  tone: StatusTone;
}

function npcStatusLine(status: NpcStatus, t: Translate): StatusLine {
  const tone: StatusTone = status === "alive" ? "good" : status === "dead" ? "dead" : "quiet";
  return { label: npcStatusLabel(status, t), tone };
}

function sceneStatusLine(status: SceneStatus, t: Translate): StatusLine {
  return { label: sceneStatusMeta(status, t).label, tone: status === "ready" ? "good" : "quiet" };
}

/** The scene's kind is its type: planned or contingency, else just "scene". */
function sceneKindLabel(type: string | undefined, t: Translate): string {
  if (type === "contingency") return t("sceneArticle.type.contingency");
  if (type === "planned") return t("sceneArticle.type.planned");
  return t("kind.scene");
}

export function EntityPreview({
  campaign,
  target,
  nameOf,
}: {
  campaign: string;
  target: ResolvedEntityRef;
  /** Display name of a slug — references inside an excerpt read as names. */
  nameOf: NameOf;
}) {
  const t = useT();
  const entryPath = target.kind === "location" ? "" : target.path;
  const entry = useQuery({
    queryKey: ["entry", campaign, entryPath],
    queryFn: () => fetchEntry(campaign, entryPath),
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
    enabled: target.kind !== "location",
  });
  const location = useQuery({
    queryKey: locationKey(campaign, target.slug),
    queryFn: () => fetchLocation(campaign, target.slug),
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
    enabled: target.kind === "location",
  });
  // A scene names its location by id; its display name is the tree's —
  // already in the cache, because the tree is what resolved this reference.
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    staleTime: Infinity,
    enabled: target.kind === "scene",
  });
  const data = entry.data;

  let kind: string;
  let status: StatusLine | undefined;
  let rows: ReactNode = null;

  if (target.kind === "npc") {
    kind = t("kind.npc");
    if (data !== undefined) {
      const excerpt = npcExcerpt(data, nameOf);
      if (excerpt.status !== undefined) status = npcStatusLine(excerpt.status, t);
      rows = <NpcCompact name={target.name} excerpt={excerpt} clamp />;
    }
  } else if (target.kind === "location") {
    kind = t("kind.location");
    if (location.data !== undefined) {
      rows = (
        <LocationCompact
          name={target.name}
          excerpt={locationExcerpt(location.data, nameOf)}
          clamp
        />
      );
    }
  } else {
    const excerpt =
      data === undefined
        ? undefined
        : sceneExcerpt(
            data,
            (id) => tree.data?.locations.find((location) => location.id === id)?.name,
            nameOf,
          );
    kind = sceneKindLabel(excerpt?.type, t);
    if (excerpt !== undefined) {
      status = sceneStatusLine(excerpt.status, t);
      rows = <SceneCompact name={target.name} excerpt={excerpt} />;
    }
  }

  return (
    <>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] tracking-[.06em] uppercase text-muted-foreground">
        <span>{kind}</span>
        {status !== undefined && (
          <>
            <span aria-hidden className="text-faint">
              ·
            </span>
            <StatusLabel status={status} />
          </>
        )}
      </p>
      {rows ?? (
        <>
          <CompactName name={target.name} />
          {(target.kind === "location" ? location.isPending : entry.isPending) && (
            <Placeholder kind={target.kind} />
          )}
        </>
      )}
    </>
  );
}

function StatusLabel({ status }: { status: StatusLine }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11.5px] tracking-normal normal-case",
        status.tone === "good" && "text-success-text",
        status.tone === "dead" && "text-destructive",
        status.tone === "quiet" && "text-dim",
      )}
    >
      {status.tone === "dead" && <Skull aria-hidden size={12} className="flex-none" />}
      {status.label}
    </span>
  );
}

/** The scene's short form: title, then trigger and location as labelled rows. */
function SceneCompact({ name, excerpt }: { name: string; excerpt: SceneExcerpt }) {
  const t = useT();
  return (
    <>
      <CompactName name={name} />
      {excerpt.trigger !== undefined && (
        <p className="mt-1.5 flex items-baseline gap-2 text-[12.5px] leading-[1.5]">
          <span className="flex-none text-muted-foreground">{t("sceneArticle.trigger.label")}</span>
          <span className="line-clamp-3 min-w-0 text-soft italic">{excerpt.trigger}</span>
        </p>
      )}
      {excerpt.location !== undefined && (
        <p className="mt-1.5 flex items-baseline gap-2 text-[12.5px] leading-[1.5]">
          <span className="flex-none text-muted-foreground">{t("refPreview.scene.location")}</span>
          <span className="min-w-0 text-body">{excerpt.location}</span>
        </p>
      )}
    </>
  );
}

/** Static bars where the rows will be — no shimmer, nothing that moves. */
function Placeholder({ kind }: { kind: ResolvedEntityRef["kind"] }) {
  const bar = "my-[7px] block h-[9px] rounded-[4px] bg-secondary";
  if (kind !== "npc") {
    return (
      <div aria-hidden className="mt-1.5">
        <span className={cn(bar, "w-[85%]")} />
        <span className={cn(bar, "w-[60%]")} />
      </div>
    );
  }
  return (
    <div aria-hidden className="mt-1.5">
      <span className={cn(bar, "w-[60%]")} />
      <span className={cn(bar, "w-[95%]")} />
      <span className={cn(bar, "w-[85%]")} />
      <div className="mt-2.5 flex gap-[5px]">
        <span className="h-[18px] w-[58px] rounded-[4px] border border-border bg-secondary" />
        <span className="h-[18px] w-[58px] rounded-[4px] border border-border bg-secondary" />
        <span className="h-[18px] w-[58px] rounded-[4px] border border-border bg-secondary" />
      </div>
    </div>
  );
}
