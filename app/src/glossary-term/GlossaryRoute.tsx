// „/campaigns/:campaign/glossary" — the campaign's glossary terms.
//
// A glossary is a REFERENCE: term → wording. So the page reads like one —
// alphabetical, one line per term, a filter above it — and not like a form.
// The order of creation carries no meaning here, which is why the list has no
// up/down. Each term is its own resource (ADR #31): a save writes that one
// term against its own `rev`.
//
// The fields follow what goes in them: the term is one line, the explanation
// is a sentence and gets a textarea that grows.

import type { GlossaryTerm } from "@grimoire/shared/glossary-term";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";

import { EditableList, LineField, SentenceField, SummaryLine } from "@/components/EditableList";

import { createGlossaryTerm, deleteGlossaryTerm, patchGlossaryTerm } from "./glossary-term-api";
import {
  emptyGlossaryTermDraft,
  glossaryTermChange,
  glossaryTermDraft,
  isSendableGlossaryTerm,
  visibleGlossaryTerms,
  type GlossaryTermDraft,
} from "./glossary-term-draft";
import { glossaryTermsKey, glossaryTermsQuery } from "./glossary-term-query";

export function GlossaryRoute() {
  const { campaign = "" } = useParams();
  const queryClient = useQueryClient();
  return (
    <EditableList<GlossaryTerm, GlossaryTermDraft>
      campaign={campaign}
      query={glossaryTermsQuery(campaign)}
      copy={{
        title: "glossary.title",
        lead: "glossary.lead",
        filter: "glossary.filter",
        empty: "glossary.empty",
        noMatch: "glossary.noMatch",
        add: "glossary.add",
      }}
      visible={visibleGlossaryTerms}
      rowTitle={(term) => term.term}
      formHeading={(term) => term.term}
      renderSummary={(term, t) => (
        <SummaryLine
          lead={term.term}
          rest={term.explanation.trim()}
          placeholder={t("glossary.noExplanation")}
        />
      )}
      renderForm={(value, patch, t) => (
        <>
          <LineField
            label={t("glossary.term")}
            value={value.term}
            onChange={(term) => patch({ ...value, term })}
          />
          <SentenceField
            label={t("glossary.explanation")}
            value={value.explanation}
            onChange={(explanation) => patch({ ...value, explanation })}
          />
        </>
      )}
      valueOf={glossaryTermDraft}
      emptyValue={emptyGlossaryTermDraft}
      isSendable={isSendableGlossaryTerm}
      create={(draft) => createGlossaryTerm(campaign, draft)}
      write={(term, original, draft, force) =>
        patchGlossaryTerm(campaign, term.id, term.rev, glossaryTermChange(original, draft), force)
      }
      remove={(term) => deleteGlossaryTerm(campaign, term.id, term.rev)}
      reload={() => queryClient.invalidateQueries({ queryKey: glossaryTermsKey(campaign) })}
    />
  );
}
