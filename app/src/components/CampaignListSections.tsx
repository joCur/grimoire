// The two campaign sections of `/settings` (issue #53): „Glossar" and
// „Kampagnenwissen".
//
// Both are the same editor (./SettingsListEditor) with a different ROW, and
// that is the whole difference between them — which is the point: the DM
// meets them one under the other and should not have to learn two
// interactions for two lists the server treats identically.
//
// GLOSSAR: term → explanation. Two fields, side by side from `md` up.
//
// KAMPAGNENWISSEN: the kind decides the fields. A naming convention is the
// „Alt → Neu" PAIR the ticket asks for (and the only kind the server can
// check after a run); a fact and a style rule are one sentence each.
//
// Switching the kind MOVES what was typed into the new form and empties the
// old kind's columns (lib/settings-list.ts switchKnowledgeKind) — the first
// version only hid them, which meant a mis-picked kind left text in the
// database that nothing on screen explained. Nothing is lost and nothing is
// hidden: what is stored is what is visible.

import { fetchGlossary, fetchKnowledge, putGlossary, putKnowledge } from "@/api";
import { SettingsListEditor, type RowApi } from "@/components/SettingsListEditor";
import { INPUT_CLASS } from "@/components/ui/field";
import { KNOWLEDGE_KINDS, type GlossaryEntry, type KnowledgeEntry } from "@grimoire/shared/types";
import type { MessageKey } from "@/i18n";
import {
  emptyGlossaryEntry,
  emptyKnowledgeEntry,
  isIncompleteNamingEntry,
  isSendableGlossaryEntry,
  isSendableKnowledgeEntry,
  switchKnowledgeKind,
  type Row,
} from "@/lib/settings-list";
import { cn } from "@/lib/utils";

/** The catalog label of one knowledge kind. Exhaustive by type (issue #69). */
const KIND_LABEL: Record<KnowledgeEntry["kind"], MessageKey> = {
  naming: "settings.knowledge.kind.naming",
  fact: "settings.knowledge.kind.fact",
  style: "settings.knowledge.kind.style",
};

export function GlossarySection({ campaign }: { campaign: string }) {
  return (
    <SettingsListEditor<GlossaryEntry>
      queryKey={["glossary", campaign]}
      load={() => fetchGlossary(campaign)}
      save={(entries, rev) => putGlossary(campaign, entries, rev)}
      isSendable={isSendableGlossaryEntry}
      emptyEntry={emptyGlossaryEntry}
      emptyMessage="settings.glossary.empty"
      addLabel="settings.glossary.add"
      renderRow={(row, api) => <GlossaryRow row={row} api={api} />}
    />
  );
}

function GlossaryRow({ row, api }: { row: Row<GlossaryEntry>; api: RowApi<GlossaryEntry> }) {
  const { t } = api;
  return (
    <div className="flex flex-col gap-2 md:flex-row">
      <input
        value={row.value.term}
        onChange={(e) => api.patch({ term: e.target.value })}
        placeholder={t("settings.glossary.term")}
        aria-label={t("settings.glossary.term")}
        className={cn(INPUT_CLASS, "md:w-[38%]")}
      />
      <input
        value={row.value.explanation}
        onChange={(e) => api.patch({ explanation: e.target.value })}
        placeholder={t("settings.glossary.explanation")}
        aria-label={t("settings.glossary.explanation")}
        className={cn(INPUT_CLASS, "md:flex-1")}
      />
    </div>
  );
}

export function KnowledgeSection({ campaign }: { campaign: string }) {
  return (
    <SettingsListEditor<KnowledgeEntry>
      queryKey={["knowledge", campaign]}
      load={() => fetchKnowledge(campaign)}
      save={(entries, rev) => putKnowledge(campaign, entries, rev)}
      isSendable={isSendableKnowledgeEntry}
      emptyEntry={() => emptyKnowledgeEntry()}
      emptyMessage="settings.knowledge.empty"
      addLabel="settings.knowledge.add"
      renderRow={(row, api) => <KnowledgeRow row={row} api={api} />}
    />
  );
}

function KnowledgeRow({ row, api }: { row: Row<KnowledgeEntry>; api: RowApi<KnowledgeEntry> }) {
  const { t } = api;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <select
          value={row.value.kind}
          onChange={(e) =>
            // A full entry as the patch: the switch decides all four columns
            // at once, so patching one of them would leave the others stale.
            api.patch(switchKnowledgeKind(row.value, e.target.value as KnowledgeEntry["kind"]))
          }
          aria-label={t("settings.knowledge.kindLabel")}
          className={cn(INPUT_CLASS, "md:w-[150px]")}
        >
          {KNOWLEDGE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(KIND_LABEL[kind])}
            </option>
          ))}
        </select>

        {row.value.kind === "naming" ? (
          // „Alt → Neu": the arrow is the whole explanation of the pair, so
          // the two fields need no labels of their own on screen (they carry
          // placeholders and aria-labels for everyone who is not looking).
          <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
            <input
              value={row.value.from}
              onChange={(e) => api.patch({ from: e.target.value })}
              placeholder={t("settings.knowledge.from")}
              aria-label={t("settings.knowledge.from")}
              className={cn(INPUT_CLASS, "md:flex-1")}
            />
            <span aria-hidden className="hidden text-muted-foreground md:inline">
              →
            </span>
            <input
              value={row.value.to}
              onChange={(e) => api.patch({ to: e.target.value })}
              placeholder={t("settings.knowledge.to")}
              aria-label={t("settings.knowledge.to")}
              className={cn(INPUT_CLASS, "md:flex-1")}
            />
          </div>
        ) : (
          <input
            value={row.value.text}
            onChange={(e) => api.patch({ text: e.target.value })}
            placeholder={t(
              row.value.kind === "fact"
                ? "settings.knowledge.factText"
                : "settings.knowledge.styleText",
            )}
            aria-label={t(
              row.value.kind === "fact"
                ? "settings.knowledge.factText"
                : "settings.knowledge.styleText",
            )}
            className={cn(INPUT_CLASS, "md:flex-1")}
          />
        )}
      </div>

      {/* A half-typed convention is SAVED (the DM may be mid-sentence) but the
          prompt skips it, so the row says so quietly rather than looking like
          a rule that is in force. Not an error — there is nothing to fix yet. */}
      {isIncompleteNamingEntry(row.value) && (
        <p className="text-[11.5px] text-muted-foreground">
          {t("settings.knowledge.incomplete")}
        </p>
      )}
    </div>
  );
}
