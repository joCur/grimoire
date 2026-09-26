// NPC card fed from the npc's own resource (decisions/resources) — voice, the motivation
// (the `motivation` field, labelled "Will") and quickstats, exactly those
// three per UI-BRIEF.
// Two densities per the design prototype: the scene aside ("full", with id
// badge and labeled rows) and the live aside ("compact", the label inline —
// the same rows the hover preview of a reference shows, ./NpcCompact.tsx). A
// `[[slug]]` inside the motivation reads as the current name, like in the
// text; the body is not read at all.
// The whole card links to the NPC reading view — UNLESS the caller
// passes `onOpen`: in the live mode the card must not navigate
// away from the running session, it opens the detail drawer instead. Same
// card, same hover, only the element differs (link vs. button).
//
// Degradation: an npc a scene lists always EXISTS — the reference is a
// foreign key, and a write that names nothing is refused. The npc may be
// empty, and then this card is simply thin: the name (the id, until somebody
// types one) and nothing else. What is left is the honest
// failure line for a server that cannot answer, and silence while the query
// runs.

import { isEntityId } from "@grimoire/shared/slug";
import { useQuery } from "@tanstack/react-query";

import { CardShell } from "@/components/CardShell";
import { useI18n } from "@/i18n";
import type { OpenTarget } from "@/lib/open-target";
import { useRefs } from "@/markdown/refs";

import { NpcCompact } from "./NpcCompact";
import { npcExcerpt } from "./npc-excerpt";
import { npcHref } from "./npc-links";
import { npcQuery } from "./npc-query";

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
   * When given, the card is a BUTTON that hands the npc — by its id — to the
   * caller instead of navigating (live mode drawer).
   */
  onOpen?: (target: OpenTarget) => void;
}) {
  const { t, tNode } = useI18n();
  const { resolve } = useRefs();
  // A NON-SLUG value is no id and therefore no npc: `npcs:` holds ids and
  // the server refuses anything else. Asking for `Alte Fischerin` would
  // answer 404 and blame the server for data it was handed — so it is not
  // asked at all, and the line says what is actually the case.
  const isId = isEntityId(id);
  const { data, isPending, isError } = useQuery({
    ...npcQuery(campaign, id),
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
  if (data === undefined) return null;

  const name = data.name === "" ? data.id : data.name;
  const excerpt = npcExcerpt(data, (slug) => resolve(slug)?.name);
  const { role, voice, will, quickstats } = excerpt;
  const shell = {
    href: npcHref(campaign, id),
    onOpen: onOpen === undefined ? undefined : () => onOpen({ kind: "npc", id }),
  };

  if (compact) {
    return (
      <CardShell {...shell} className="p-3.5">
        <NpcCompact name={name} excerpt={excerpt} />
      </CardShell>
    );
  }

  return (
    <CardShell {...shell} className="p-4">
      <div className="mb-[2px] flex items-baseline gap-2">
        <span className="font-serif text-[16px] font-semibold text-foreground">{name}</span>
        <span className="font-mono text-[10.5px] text-faint">{data.id}</span>
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
    </CardShell>
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
