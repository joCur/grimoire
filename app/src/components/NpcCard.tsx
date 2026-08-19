// NPC card fed from npcs/<id>.md — voice, "Will" (first paragraph of the
// `## Will` section) and quickstats, exactly those three per UI-BRIEF.
// Two densities per the design prototype: the scene aside ("full", with id
// badge and labeled rows) and the live aside ("compact", inline "Will:").
// A missing or broken npc file skips the card silently (degrade).

import { useQuery } from "@tanstack/react-query";

import { fetchFile } from "@/api";
import { fmQuickstats, fmString } from "@/lib/frontmatter";
import { firstParagraphOfSection } from "@/lib/md-section";

export function NpcCard({
  campaign,
  id,
  compact = false,
}: {
  campaign: string;
  id: string;
  compact?: boolean;
}) {
  const { data, isError } = useQuery({
    queryKey: ["file", campaign, `npcs/${id}.md`],
    queryFn: () => fetchFile(campaign, `npcs/${id}.md`),
    retry: false,
  });
  if (isError || !data) return null;

  const fm = data.frontmatter;
  const name = fmString(fm.name) ?? id;
  const npcId = fmString(fm.id) ?? id;
  const role = fmString(fm.role);
  const voice = fmString(fm.voice);
  const will = firstParagraphOfSection(data.body, "Will");
  const quickstats = fmQuickstats(fm.quickstats);

  if (compact) {
    return (
      <div className="rounded-lg border border-border bg-card p-3.5">
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
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
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
    </div>
  );
}
