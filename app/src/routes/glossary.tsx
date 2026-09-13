// „/:campaign/glossary" — the campaign's glossary (issue #53, PO feedback on
// PR #87).
//
// A glossary is a REFERENCE: term → wording. So the page reads like one —
// alphabetical, one line per term, a filter above it — and not like a form.
// The stored order carries no meaning here, which is why this is the list
// without up/down (components/EntryListPage.tsx explains the split).
//
// The fields follow what goes in them: the term is one line, the explanation
// is a sentence and gets a textarea that grows.

import type { GlossaryEntry } from "@grimoire/shared/types";
import { useParams } from "react-router";

import { fetchGlossary, putGlossary } from "@/api";
import {
  EntryField,
  EntryListPage,
  EntryTextField,
  SummaryLine,
} from "@/components/EntryListPage";
import {
  emptyGlossaryEntry,
  glossaryRows,
  isSendableGlossaryEntry,
} from "@/lib/entry-list";

export function GlossaryRoute() {
  const { campaign = "" } = useParams();
  return (
    <EntryListPage<GlossaryEntry>
      campaign={campaign}
      queryKey={["glossary", campaign]}
      load={() => fetchGlossary(campaign)}
      save={(entries, rev) => putGlossary(campaign, entries, rev)}
      title="glossary.title"
      lead="glossary.lead"
      filterLabel="glossary.filter"
      emptyMessage="glossary.empty"
      noMatchMessage="glossary.noMatch"
      addLabel="glossary.add"
      rowsOf={glossaryRows}
      isSendable={isSendableGlossaryEntry}
      emptyEntry={emptyGlossaryEntry}
      rowTitle={(entry) => entry.term}
      rowLabel={(entry, t) => (entry.term.trim() === "" ? t("glossary.add") : entry.term)}
      renderSummary={(entry, t) => (
        <SummaryLine
          lead={entry.term}
          rest={entry.explanation.trim()}
          placeholder={t("glossary.noExplanation")}
        />
      )}
      renderForm={(value, patch, t) => (
        <>
          <EntryField
            label={t("glossary.term")}
            value={value.term}
            onChange={(term) => patch({ ...value, term })}
          />
          <EntryTextField
            label={t("glossary.explanation")}
            value={value.explanation}
            onChange={(explanation) => patch({ ...value, explanation })}
          />
        </>
      )}
    />
  );
}
