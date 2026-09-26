// The reading view of an NPC (decisions/resources): its name and status, the lines the
// table needs — role, voice, appearance, what it wants (`motivation`), the
// quick stats and the Roll20 sheet it refers to — and its text. The same
// column and the same markdown pipeline as every other article.
//
// The statblock line stays PLAIN TEXT on purpose: the format references
// Roll20 by name, it never links or copies it (README). The motivation reads
// exactly as the cards read it (./npc-excerpt.ts): a `[[slug]]` inside reads
// as the current name.

import type { Npc } from "@grimoire/shared/npc";
import type { ReactNode } from "react";

import { Title } from "@/components/ArticleHeader";
import { useT } from "@/i18n";
import { useRefs } from "@/markdown/refs";
import { Markdown } from "@/markdown/Markdown";

import { npcExcerpt } from "./npc-excerpt";
import { npcStatusLabel } from "./npc-status";

export function NpcArticle({
  npc,
  actions,
  body,
}: {
  npc: Npc;
  /** The header's quiet action slot — the route owns the actions. */
  actions?: ReactNode;
  /** Replaces the rendered text — edit mode puts its editor here. */
  body?: ReactNode;
}) {
  const t = useT();
  const { resolve } = useRefs();
  const { role, voice, will, quickstats } = npcExcerpt(npc, (slug) => resolve(slug)?.name);
  return (
    <article className="w-full min-w-0">
      <header className="mb-7 border-b border-border pb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <Title>{npc.name === "" ? npc.id : npc.name}</Title>
          <span className="flex-none rounded-full border border-input px-[9px] py-px text-[11.5px] text-dim">
            {npcStatusLabel(npc.status, t)}
          </span>
          {actions !== undefined && (
            <span className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</span>
          )}
        </div>
        {role !== undefined && (
          <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">{role}</p>
        )}
        {voice !== undefined && (
          <p className="mt-3 text-[14px] leading-[1.6] text-body italic">{voice}</p>
        )}
        {npc.appearance !== undefined && npc.appearance !== "" && (
          <p className="mt-1 text-[14px] leading-[1.6] text-body-secondary italic">
            {npc.appearance}
          </p>
        )}
        {will !== undefined && (
          <p className="mt-3 text-[14px] leading-[1.6] text-body">
            <span className="text-muted-foreground">{t("npcCard.will.inline")}</span> {will}
          </p>
        )}
        {quickstats.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-1.5">
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
        {npc.statblock !== undefined && npc.statblock !== "" && (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            {t("entity.npc.statblock", { value: npc.statblock })}
          </p>
        )}
      </header>
      {body ?? <Markdown>{npc.body}</Markdown>}
    </article>
  );
}
