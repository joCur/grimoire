// NPC card fed from npcs/<id> — voice, the motivation (the `motivation`
// property, labelled "Will") and quickstats, exactly those three per UI-BRIEF.
// Two densities per the design prototype: the scene aside ("full", with id
// badge and labeled rows) and the live aside ("compact", the label inline —
// the same rows the hover preview of a reference shows,
// components/EntityCompact). A `[[slug]]` inside the motivation reads as the
// current name, like in the text; the body is not read at all.
// The whole card links to the NPC reading view — UNLESS the caller
// passes `onOpen`: in the live mode the card must not navigate
// away from the running session, it opens the detail drawer instead. Same
// card, same hover, only the element differs (link vs. button).
//
// Degradation: an npc a scene lists always HAS an entry — the
// reference is a foreign key, and a write that names nothing is refused. The
// entry may be empty, and then this card is simply thin: the name (the id,
// until somebody types one) and nothing else. What is left is the honest
// failure line for a server that cannot answer, and silence while the query
// runs.

import { useQuery } from "@tanstack/react-query";

import { fetchEntry } from "@/api";
import { EntityCardShell } from "@/components/EntityCardShell";
import { NpcCompact } from "@/components/EntityCompact";
import { useI18n } from "@/i18n";
import { isEntityId } from "@/lib/entity";
import { npcExcerpt } from "@/lib/entity-excerpt";
import { propString } from "@/lib/properties";
import { useEntityRefs } from "@/markdown/entity-refs";

/** Campaign-relative path of an NPC entry — the reference key is the id. */
function npcPath(id: string): string {
  return `npcs/${id}`;
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
   * path to the caller instead of navigating (live mode drawer).
   */
  onOpen?: (path: string) => void;
}) {
  const { t, tNode } = useI18n();
  const { resolve } = useEntityRefs();
  const path = npcPath(id);
  // A NON-SLUG value is no id and therefore no entry: `npcs:` holds ids and
  // the server refuses anything else. Asking for `npcs/Alte Fischerin` would
  // answer 404 and blame the server for data it was handed — so it is not
  // asked at all, and the line says what is actually the case.
  const isId = isEntityId(id);
  const { data, isPending, isError } = useQuery({
    queryKey: ["entry", campaign, path],
    queryFn: () => fetchEntry(campaign, path),
    retry: false,
    enabled: isId,
  });

  if (!isId) {
    return (
      <p className="text-[12px] leading-[1.5] text-muted-foreground">
        {tNode("npcCard.noId", { id: monoId(id) })}
      </p>
    );
  }

  // Nothing decided yet — never claim anything while loading.
  if (isPending) return null;

  if (isError) {
    return (
      <p className="text-[12px] leading-[1.5] text-muted-foreground">
        {tNode("npcCard.unloadable", { id: monoId(id) })}
      </p>
    );
  }
  // The address names an npc, whose fields travel under `properties`.
  if (data === undefined || data.kind === "location") return null;

  const properties = data.properties;
  const name = propString(properties.name) ?? id;
  const npcId = propString(properties.id) ?? id;
  const excerpt = npcExcerpt(data, (slug) => resolve(slug)?.name);
  const { role, voice, will, quickstats } = excerpt;

  if (compact) {
    return (
      <EntityCardShell campaign={campaign} path={path} onOpen={onOpen} className="p-3.5">
        <NpcCompact name={name} excerpt={excerpt} />
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
            {t("npcCard.voice")}
          </p>
          <p className="mb-2.5 text-[13px] leading-[1.5] text-body italic">{voice}</p>
        </>
      )}
      {will !== undefined && (
        <>
          <p className="mb-[3px] text-[11px] tracking-[.06em] uppercase text-muted-foreground">
            {t("npcCard.will")}
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

/** The id inside a degrade sentence — mono, and part of the sentence (tNode). */
function monoId(id: string) {
  return (
    <span key="id" className="font-mono">
      {id}
    </span>
  );
}
