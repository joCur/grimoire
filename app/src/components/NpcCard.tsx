// NPC card fed from npcs/<id> — voice, "Will" (first paragraph of the
// `## Will` section) and quickstats, exactly those three per UI-BRIEF.
// Two densities per the design prototype: the scene aside ("full", with id
// badge and labeled rows) and the live aside ("compact", inline "Will:").
// The whole card links to the NPC reading view (issue #26) — UNLESS the caller
// passes `onOpen`: in the live mode (issue #40) the card must not navigate
// away from the running session, it opens the detail drawer instead. Same
// card, same hover, only the element differs (link vs. button).
//
// Degradation (issue #26, #70): a reference CREATES the entry it names
// (server store/write.ts), so an npc in a scene always has a row; it may be
// empty, and then this card is simply thin — name (the id, until somebody
// types one) and nothing else. What is left is the honest failure line for a
// server that cannot answer, and silence while the query runs.

import { useQuery } from "@tanstack/react-query";

import { fetchEntry } from "@/api";
import { EntityCardShell } from "@/components/EntityCardShell";
import { useI18n } from "@/i18n";
import { isEntityId } from "@/lib/entity";
import { fmQuickstats, fmString } from "@/lib/properties";
import { firstParagraphOfSection } from "@/lib/md-section";

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
   * path to the caller instead of navigating (live mode drawer, issue #40).
   */
  onOpen?: (path: string) => void;
}) {
  const { t, tNode } = useI18n();
  const path = npcPath(id);
  // A NON-SLUG value is no id and therefore no entry (#70): `npcs:` holds
  // ids, the server refuses free text there, and only the importer can still
  // bring some in. Asking for `npcs/Alte Fischerin` would answer 404 and
  // blame the server for data it was handed — so it is not asked at all, and
  // the line says what is actually the case.
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
  if (data === undefined) return null;

  const fm = data.properties;
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
            <span className="text-muted-foreground">{t("npcCard.will.inline")}</span> {will}
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
