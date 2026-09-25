// „/campaigns/:campaign/knowledge" — the campaign knowledge: the naming
// conventions, facts and style rules that travel with every generator run and
// hold even when the source material says otherwise.
//
// Each knowledge item is its own resource (ADR #31): a save writes that one
// item against its own `rev`. The ORDER is the order of the prompt
// (server/src/store/knowledge-items.ts), so it is the DM's to arrange — this
// is the list with up/down, and a move writes the whole order against the
// order's own guard. The kind decides the fields: a naming convention is the
// „Alt → Neu" pair, a fact and a style rule are one sentence each.
//
// Switching the kind MOVES what was typed into the new form and empties the
// old kind's fields (knowledge-item-draft.ts switchKnowledgeKind): what is
// stored is what is visible.

import { KNOWLEDGE_KINDS, type KnowledgeItem } from "@grimoire/shared/knowledge-item";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { useParams } from "react-router";

import { EditableList, LineField, SentenceField, SummaryLine } from "@/components/EditableList";
import { INPUT_CLASS } from "@/components/ui/field";
import type { MessageKey, Translate } from "@/i18n";

import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  patchKnowledgeItem,
  putKnowledgeItemOrder,
} from "./knowledge-item-api";
import {
  emptyKnowledgeItemDraft,
  isIncompleteNaming,
  isSendableKnowledgeItem,
  knowledgeItemChange,
  knowledgeItemDraft,
  knowledgeSummary,
  switchKnowledgeKind,
  visibleKnowledgeItems,
  type KnowledgeItemDraft,
} from "./knowledge-item-draft";
import {
  knowledgeItemOrderKey,
  knowledgeItemOrderQuery,
  knowledgeItemsKey,
  knowledgeItemsQuery,
} from "./knowledge-item-query";

/** The catalog label of one knowledge kind. Exhaustive by type. */
const KIND_LABEL: Record<KnowledgeItem["kind"], MessageKey> = {
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
  const queryClient = useQueryClient();
  // The order's guard as the DM saw it: a move writes against it, so an
  // order somebody else changed in between is a conflict, not an overwrite.
  const order = useQuery(knowledgeItemOrderQuery(campaign));
  // A new or removed item changes the order too, and moves its guard.
  const refreshOrder = () => queryClient.invalidateQueries({ queryKey: knowledgeItemOrderKey(campaign) });

  return (
    <EditableList<KnowledgeItem, KnowledgeItemDraft>
      campaign={campaign}
      query={knowledgeItemsQuery(campaign)}
      copy={{
        title: "knowledge.title",
        lead: "knowledge.lead",
        filter: "knowledge.filter",
        empty: "knowledge.empty",
        noMatch: "knowledge.noMatch",
        add: "knowledge.add",
      }}
      visible={visibleKnowledgeItems}
      rowTitle={knowledgeSummary}
      formHeading={(item, t) => t(KIND_LABEL[item.kind])}
      renderSummary={(item, t) => (
        <SummaryLine
          badge={t(KIND_LABEL[item.kind])}
          rest={knowledgeSummary(item)}
          placeholder={t("knowledge.blank")}
        />
      )}
      renderForm={(value, patch, t) => <KnowledgeItemForm value={value} patch={patch} t={t} />}
      valueOf={knowledgeItemDraft}
      emptyValue={() => emptyKnowledgeItemDraft()}
      isSendable={isSendableKnowledgeItem}
      create={async (draft) => {
        const item = await createKnowledgeItem(campaign, draft);
        await refreshOrder();
        return item;
      }}
      write={(item, original, draft, force) =>
        patchKnowledgeItem(campaign, item.id, item.rev, knowledgeItemChange(original, draft), force)
      }
      remove={async (item) => {
        await deleteKnowledgeItem(campaign, item.id, item.rev);
        await refreshOrder();
      }}
      reorder={async (items) => {
        const written = await putKnowledgeItemOrder(campaign, { items, rev: order.data?.rev ?? 0 });
        queryClient.setQueryData(knowledgeItemOrderKey(campaign), written);
      }}
      reload={async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: knowledgeItemsKey(campaign) }),
          refreshOrder(),
        ]);
      }}
    />
  );
}

function KnowledgeItemForm({
  value,
  patch,
  t,
}: {
  value: KnowledgeItemDraft;
  patch: (next: KnowledgeItemDraft) => void;
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
            // A whole value, not a field patch: the switch decides all four
            // fields at once, so patching one would leave the others stale.
            patch(switchKnowledgeKind(value, e.target.value as KnowledgeItem["kind"]))
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
          <LineField
            label={t("knowledge.from")}
            value={value.from}
            onChange={(from) => patch({ ...value, from })}
          />
          <LineField
            label={t("knowledge.to")}
            value={value.to}
            onChange={(to) => patch({ ...value, to })}
          />
          {/* A half-typed convention is SAVED (the DM may be mid-sentence) but
              the prompt skips it, so the form says so quietly rather than
              letting a rule look like it is in force. Not an error — there is
              nothing to fix yet. */}
          {isIncompleteNaming(value) && (
            <p className="text-[11.5px] text-muted-foreground">{t("knowledge.incomplete")}</p>
          )}
        </>
      ) : (
        <SentenceField
          label={t(TEXT_LABEL[value.kind])}
          value={value.text}
          onChange={(text) => patch({ ...value, text })}
        />
      )}
    </>
  );
}
