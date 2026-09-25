// The npc an NPC run proposes, as a card: the generator's own card chrome
// (name, status pill, edit toggle, mono resource label) with the lines of the
// npc's reading view above the text — role, voice, appearance, motivation,
// quick stats chips, statblock reference, read with the same helper the
// reading view and the cards use (`npcExcerpt`). Rebuilt here rather than
// reusing the reading view's article on purpose: that one reads an npc that
// EXISTS, with a guard, and nothing is written yet.
//
// Same two views as a proposed scene: the rendered text through the normal
// markdown pipeline, or the editor over the npc's fields and its text. What
// the editor changes is reported as the npc's change (`npcEdits`): the form
// fields together, the text on its own.

import type { CampaignTree, NpcChange, NpcProposal } from "@grimoire/shared/types";
import { useState } from "react";

import { DraftBodySection, DraftFieldsSection } from "@/components/DraftEditor";
import { MarkdownEditorToggle } from "@/components/MarkdownEditor";
import { useT } from "@/i18n";
import { useEntityRefs } from "@/markdown/entity-refs";
import { Markdown } from "@/markdown/Markdown";

import { NpcFields, NpcMotivationField } from "./NpcFields";
import { npcExcerpt } from "./npc-excerpt";
import { npcFormIssues, npcFormValues, npcProposalChange, type NpcFormValues } from "./npc-form";
import { npcLabel } from "./npc-links";
import { npcStatusLabel } from "./npc-status";

export function NpcProposalCard({
  npc,
  tree,
  editing,
  onToggleEditing,
  onChange,
  onFlush,
}: {
  npc: NpcProposal;
  tree: CampaignTree | undefined;
  editing: boolean;
  onToggleEditing: () => void;
  onChange: (change: NpcChange) => void;
  onFlush: () => void;
}) {
  const t = useT();
  const { resolve } = useEntityRefs();
  const { role, voice, will, quickstats } = npcExcerpt(npc, (slug) => resolve(slug)?.name);
  const label = npcLabel(npc.id);
  const editorId = `gen-draft-${label.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  return (
    <div className="my-4 rounded-[10px] border border-border bg-[color-mix(in_srgb,var(--card)_60%,var(--background))] px-5 py-5 md:px-6">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <h2 className="flex-1 font-serif text-[20px] leading-[1.3] font-semibold text-foreground">
          {npc.name === "" ? npc.id : npc.name}
        </h2>
        <span className="flex-none rounded-full border border-input px-[9px] py-px text-[11.5px] text-dim">
          {npcStatusLabel(npc.status, t)}
        </span>
        <MarkdownEditorToggle
          editing={editing}
          onToggleEditing={onToggleEditing}
          controlsId={editorId}
        />
      </div>
      <p className="mb-3.5 font-mono text-[11.5px] text-faint">{label}</p>
      <div className="mb-2 border-b border-border pb-4">
        {role !== undefined && (
          <p className="text-[13.5px] leading-[1.5] text-muted-foreground">{role}</p>
        )}
        {voice !== undefined && (
          <p className="mt-2 text-[14px] leading-[1.6] text-body italic">{voice}</p>
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
          <div className="mt-3 flex flex-wrap gap-1.5">
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
            {t("generate.review.statblock", { statblock: npc.statblock })}
          </p>
        )}
      </div>
      {editing ? (
        <NpcProposalEditor npc={npc} tree={tree} onChange={onChange} onFlush={onFlush} />
      ) : (
        <Markdown>{npc.body}</Markdown>
      )}
    </div>
  );
}

/**
 * The editor of a proposed npc: its fields as in the dialog, its text on the
 * body editor's surfaces with the `motivation` beside it. Seeded ONCE, so it
 * is mounted per proposal: re-reading the npc out of the props would fight
 * the keystroke that produced it.
 */
function NpcProposalEditor({
  npc,
  tree,
  onChange,
  onFlush,
}: {
  npc: NpcProposal;
  tree: CampaignTree | undefined;
  onChange: (change: NpcChange) => void;
  onFlush: () => void;
}) {
  const t = useT();
  const label = npcLabel(npc.id);
  const [values, setValues] = useState<NpcFormValues>(() => npcFormValues(npc));
  const edit = (next: NpcFormValues): void => {
    setValues(next);
    onChange(npcProposalChange(next));
  };
  return (
    <div className="mt-3 flex flex-col gap-4">
      <DraftFieldsSection label={label}>
        <NpcFields values={values} issues={npcFormIssues(values, t)} tree={tree} onChange={edit} />
      </DraftFieldsSection>
      <DraftBodySection
        label={label}
        body={npc.body}
        beside={
          <NpcMotivationField
            value={values.motivation}
            onChange={(motivation) => edit({ ...values, motivation })}
          />
        }
        onBodyChange={(body) => onChange({ body })}
        onFlush={onFlush}
      />
    </div>
  );
}
