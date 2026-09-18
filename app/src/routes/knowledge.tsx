// „/campaigns/:campaign/knowledge" — the campaign knowledge (PO decision):
// the naming conventions, facts and style rules that travel with
// every generator run and hold even when the source material says otherwise.
//
// The ORDER is the order of the prompt (server/src/store/knowledge.ts), so it is
// the DM's to arrange — this is the list with up/down. The kind decides the
// fields: a naming convention is the „Alt → Neu" pair, a fact and a style rule
// are one sentence each, in a textarea that grows with it.
//
// Switching the kind MOVES what was typed into the new form and empties the
// old kind's columns (lib/entry-list.ts switchKnowledgeKind): what is stored
// is what is visible.

import { KNOWLEDGE_KINDS, type KnowledgeEntry } from "@grimoire/shared/types";
import { useParams } from "react-router";
import { useId } from "react";

import { fetchKnowledge, putKnowledge } from "@/api";
import {
  EntryField,
  EntryListPage,
  EntryTextField,
  SummaryLine,
} from "@/components/EntryListPage";
import { INPUT_CLASS } from "@/components/ui/field";
import type { MessageKey, Translate } from "@/i18n";
import {
  emptyKnowledgeEntry,
  isIncompleteNamingEntry,
  isSendableKnowledgeEntry,
  knowledgeRows,
  knowledgeSummary,
  switchKnowledgeKind,
} from "@/lib/entry-list";

/** The catalog label of one knowledge kind. Exhaustive by type. */
const KIND_LABEL: Record<KnowledgeEntry["kind"], MessageKey> = {
  naming: "knowledge.kind.naming",
  fact: "knowledge.kind.fact",
  style: "knowledge.kind.style",
};

/** The one label a fact's / style rule's sentence field carries. */
const TEXT_LABEL: Record<"fact" | "style", MessageKey> = {
  fact: "knowledge.factText",
  style: "knowledge.styleText",
};

export function KnowledgeRoute() {
  const { campaign = "" } = useParams();
  return (
    <EntryListPage<KnowledgeEntry>
      campaign={campaign}
      queryKey={["knowledge", campaign]}
      load={() => fetchKnowledge(campaign)}
      save={(entries, rev) => putKnowledge(campaign, entries, rev)}
      title="knowledge.title"
      lead="knowledge.lead"
      filterLabel="knowledge.filter"
      emptyMessage="knowledge.empty"
      noMatchMessage="knowledge.noMatch"
      addLabel="knowledge.add"
      rowsOf={knowledgeRows}
      isSendable={isSendableKnowledgeEntry}
      emptyEntry={() => emptyKnowledgeEntry()}
      reorderable
      rowTitle={(entry) => knowledgeSummary(entry)}
      rowLabel={(entry, t) => t(KIND_LABEL[entry.kind])}
      renderSummary={(entry, t) => (
        <SummaryLine
          badge={t(KIND_LABEL[entry.kind])}
          rest={knowledgeSummary(entry)}
          placeholder={t("knowledge.blank")}
        />
      )}
      renderForm={(value, patch, t) => <KnowledgeForm value={value} patch={patch} t={t} />}
    />
  );
}

function KnowledgeForm({
  value,
  patch,
  t,
}: {
  value: KnowledgeEntry;
  patch: (next: KnowledgeEntry) => void;
  t: Translate;
}) {
  const kindId = useId();
  return (
    <>
      <div>
        <label htmlFor={kindId} className="mb-1 block text-[11.5px] text-muted-foreground">
          {t("knowledge.kindLabel")}
        </label>
        <select
          id={kindId}
          value={value.kind}
          onChange={(e) =>
            // A full entry, not a field patch: the switch decides all four
            // columns at once, so patching one would leave the others stale.
            patch(switchKnowledgeKind(value, e.target.value as KnowledgeEntry["kind"]))
          }
          className={`${INPUT_CLASS} md:w-[220px]`}
        >
          {KNOWLEDGE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(KIND_LABEL[kind])}
            </option>
          ))}
        </select>
      </div>

      {value.kind === "naming" ? (
        // „Alt → Neu": two single-line fields, each on its own full-width
        // row. Side by side they would be two half-width boxes for names
        // that are routinely longer than that.
        <>
          <EntryField
            label={t("knowledge.from")}
            value={value.from}
            onChange={(from) => patch({ ...value, from })}
          />
          <EntryField
            label={t("knowledge.to")}
            value={value.to}
            onChange={(to) => patch({ ...value, to })}
          />
          {/* A half-typed convention is SAVED (the DM may be mid-sentence) but
              the prompt skips it, so the form says so quietly rather than
              letting a rule look like it is in force. Not an error — there is
              nothing to fix yet. */}
          {isIncompleteNamingEntry(value) && (
            <p className="text-[11.5px] text-muted-foreground">{t("knowledge.incomplete")}</p>
          )}
        </>
      ) : (
        <EntryTextField
          label={t(TEXT_LABEL[value.kind])}
          value={value.text}
          onChange={(text) => patch({ ...value, text })}
        />
      )}
    </>
  );
}
