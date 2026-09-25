// Editing ONE proposed scene of a generator review: its fields in the form of
// the properties dialog, its body on the surfaces of the body editor. The two
// sections are exported on their own, so a proposal of another kind builds
// its editor from them with its own fields.
//
// A proposal is not written yet, so this component brings none of the write
// plumbing along — no version guard, no save action, no conflict line. It
// reports every change upwards and the review keeps it on the job, debounced
// (lib/use-job-review.ts). What it DOES bring is the vocabulary:
//
//   fields  propertiesFieldsFor + PropertiesFieldControl — the same field
//           list, labels, controls and per-field notes as the dialog. The id
//           stays read-only there and here (ADR #21).
//   body    the mode toggle of the block composer over the same two surfaces
//           the body editor offers: the block cards, or the raw textarea with
//           its preview.
//
// The fields and the body are reported SEPARATELY, because that is how they
// are stored: each is a whole replacement of what the run produced, and an
// untouched one is never sent (shared, DraftEdit).
//
// The form's state is seeded ONCE, so this is mounted per address (`key`) the
// way the dialog is mounted per row: re-reading the fields out of the props
// would fight the keystroke that produced them.
//
// Nothing here blocks anything. What an unfinished field blocks in the dialog
// is said under that field and no more — the draft is written by the accept,
// and the server validates it then.

import type { CampaignTree, EntityKind } from "@grimoire/shared/types";
import { useState, type ReactNode } from "react";

import { BlockComposer, ComposerModeToggle } from "@/components/BlockComposer";
import { MarkdownEditorSurface, MarkdownEditorToggle } from "@/components/MarkdownEditor";
import { PropertiesFieldControl } from "@/components/PropertiesFields";
import { useT } from "@/i18n";
import {
  composerDraft,
  draftBody,
  withDraftBlocks,
  withDraftMode,
  withDraftText,
} from "@/lib/composer";
import {
  applyPropertiesPatch,
  commitPendingText,
  propertiesFieldsFor,
  propertiesFormIssues,
  propertiesFormValues,
  propertiesPatch,
  type FormValues,
} from "@/lib/properties-form";

const OVERLINE = "text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground";

/** No block of the list can block a save here — there is no save. */
const NO_BLOCK_NOTES: Record<string, string> = {};

/**
 * A DOM id that survives any address (same rule as the body editor): the
 * textarea's id on the raw surface, the prefix of the block forms' ids on the
 * block one.
 */
function idFor(path: string): string {
  return `gen-draft-${path.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

export function DraftEditor({
  path,
  kind,
  properties,
  body,
  tree,
  onPropertiesChange,
  onBodyChange,
  onFlush,
}: {
  /** The address the proposal would be written to — the read-only id line. */
  path: string;
  /** Which field list the proposal gets; a kind without a form shows none. */
  kind: EntityKind;
  /** The proposal's fields as the review holds them when the editor opens. */
  properties: Record<string, unknown>;
  /** The proposal's body as the review holds it when the editor opens. */
  body: string;
  /** For the reference fields — the ids that already have a row. */
  tree: CampaignTree | undefined;
  onPropertiesChange: (properties: Record<string, unknown>) => void;
  onBodyChange: (body: string) => void;
  /** Send what is pending now — the text surface calls it on blur. */
  onFlush: () => void;
}) {
  const t = useT();
  const fields = propertiesFieldsFor(kind, t) ?? [];
  // Seeded once (see the note above): the object the diff is folded back into,
  // the values it is measured against, and the chip text that is not part of
  // a list yet.
  const [base] = useState(properties);
  const [initial] = useState<FormValues>(() => propertiesFormValues(fields, properties));
  const [values, setValues] = useState<FormValues>(initial);
  const [pending, setPending] = useState<Record<string, string>>({});

  const effective = commitPendingText(fields, values, pending);
  const issues = propertiesFormIssues(fields, effective, initial, t);

  /** Report the whole properties object the form stands for right now. */
  const emit = (nextValues: FormValues, nextPending: Record<string, string>): void => {
    const next = commitPendingText(fields, nextValues, nextPending);
    onPropertiesChange(applyPropertiesPatch(base, propertiesPatch(fields, initial, next)));
  };

  return (
    <div className="mt-3 flex flex-col gap-4">
      {fields.length > 0 && (
        <DraftFieldsSection path={path}>
          {fields.map((field) => {
            const value = values[field.key];
            if (value === undefined) return null;
            return (
              <PropertiesFieldControl
                key={field.key}
                field={field}
                value={value}
                tree={tree}
                pending={pending[field.key] ?? ""}
                issue={issues[field.key]}
                onChange={(next) => {
                  const nextValues = { ...values, [field.key]: next };
                  setValues(nextValues);
                  emit(nextValues, pending);
                }}
                onPendingChange={(text) => {
                  const nextPending = { ...pending, [field.key]: text };
                  setPending(nextPending);
                  emit(values, nextPending);
                }}
              />
            );
          })}
        </DraftFieldsSection>
      )}
      <DraftBodySection path={path} body={body} onBodyChange={onBodyChange} onFlush={onFlush} />
    </div>
  );
}

/** The fields of a proposal: the heading, its address as read-only id, the controls. */
export function DraftFieldsSection({ path, children }: { path: string; children: ReactNode }) {
  const t = useT();
  return (
    <section aria-label={t("generate.review.propertiesHeading")}>
      <div className={OVERLINE}>{t("generate.review.propertiesHeading")}</div>
      {/* The value the form does not own — shown, not editable, exactly as
          in the dialog. */}
      <p className="mt-1.5 text-[12px] text-body-secondary">
        {t("properties.id")} <span className="font-mono text-[12px] text-soft">{path}</span>
      </p>
      <div className="mt-2.5 flex flex-col gap-3.5">{children}</div>
    </section>
  );
}

/**
 * The body of a proposal on the two surfaces, and — above them, as on the
 * body editor — the prose fields its caller edits beside the text.
 */
export function DraftBodySection({
  path,
  body,
  beside,
  onBodyChange,
  onFlush,
}: {
  path: string;
  /** The body as the review holds it when the editor opens. */
  body: string;
  beside?: ReactNode;
  onBodyChange: (body: string) => void;
  /** Send what is pending now — the text surface calls it on blur. */
  onFlush: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(() => composerDraft(body));
  // Textarea (true) or rendered preview (false) — the raw surface's own
  // toggle. The block surface needs none: every card shows its content.
  const [editing, setEditing] = useState(true);
  const id = idFor(path);
  return (
    <section aria-label={t("generate.review.bodyHeading")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className={OVERLINE}>{t("generate.review.bodyHeading")}</div>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <ComposerModeToggle
            mode={draft.mode}
            onModeChange={(mode) => setDraft(withDraftMode(draft, mode))}
          />
          {draft.mode === "markdown" && (
            <MarkdownEditorToggle
              editing={editing}
              onToggleEditing={() => setEditing((wasEditing) => !wasEditing)}
              controlsId={id}
            />
          )}
        </span>
      </div>
      {beside !== undefined && <div className="mt-2.5 flex flex-col gap-3.5">{beside}</div>}
      {draft.mode === "blocks" ? (
        <BlockComposer
          blocks={draft.blocks}
          onChange={(blocks) => {
            const next = withDraftBlocks(blocks);
            setDraft(next);
            onBodyChange(draftBody(next));
          }}
          idPrefix={id}
          label={path}
          issues={NO_BLOCK_NOTES}
        />
      ) : (
        <MarkdownEditorSurface
          value={draft.text}
          onChange={(text) => {
            const next = withDraftText(text);
            setDraft(next);
            onBodyChange(draftBody(next));
          }}
          editing={editing}
          id={id}
          label={t("generate.review.bodyLabel", { path })}
          onBlur={onFlush}
        />
      )}
    </section>
  );
}
