// The compact short form of an npc — the rows of its live aside card, and the
// same rows inside the hover preview of a `[[slug]]` reference. Two surfaces,
// one rendering: the preview is this card seen from the text, so its type
// sizes, order and colors are the card's.
//
// Presentation only. The caller reads the npc (./npc-excerpt.ts) and decides
// the surface around it: a clickable card shell in the aside, a passive
// popover at a reference. Absent fields are left out — no placeholder.
//
// `clamp` is the preview's: there the motivation is a glimpse, never the
// whole paragraph, so it stops after four lines with an ellipsis. The aside
// card shows it in full.

import { CompactName } from "@/components/Compact";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import type { NpcExcerpt } from "./npc-excerpt";

export function NpcCompact({
  name,
  excerpt,
  clamp = false,
}: {
  name: string;
  excerpt: NpcExcerpt;
  clamp?: boolean;
}) {
  const t = useT();
  const { role, voice, will, quickstats } = excerpt;
  return (
    <>
      <CompactName name={name} />
      {role !== undefined && <p className="mb-[9px] text-[12px] text-muted-foreground">{role}</p>}
      {voice !== undefined && (
        <p className="mb-2 text-[12.5px] leading-[1.5] text-body italic">{voice}</p>
      )}
      {will !== undefined && (
        <p
          className={cn(
            "mb-2.5 text-[12.5px] leading-[1.5] text-body-secondary",
            clamp && "line-clamp-4",
          )}
        >
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
    </>
  );
}
