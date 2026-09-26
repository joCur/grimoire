// The id line under the name field — one component for all six create
// surfaces (the five CreateDialog kinds and the cold-start page).
//
// It previews the id a typed name yields, shown before anything is written,
// because an id is the permanent reference key. ADR #21 names the create
// dialog as the ONE place where it may be personalised, so the line carries a
// pencil: pressing it turns the line into a field prefilled with the id that
// is on screen anyway.
//
// The label in front of the id ("ID: ") is context, not something to type
// over, so it sits outside the input.
//
// The state machine behind this (who owns the id, and how it goes back to
// following the name) is lib/id-field.ts; this file only renders it and owns
// the one side effect it has: entering the editable state moves focus into
// the field, so the pencil is usable from the keyboard alone.

import { Pencil } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { useT } from "@/i18n";

interface IdFieldProps {
  /** The id as it stands — derived from the name, or the one that was typed. */
  id: string;
  /** Editable field instead of the quiet line. */
  editing: boolean;
  /** Set while `id` breaks the slug rule; the field names the rule and blocks the create. */
  invalid: boolean;
  /** The pencil. */
  onToggle: () => void;
  /** A keystroke in the field — the raw text, corrected by nobody. */
  onChange: (value: string) => void;
}

export function IdField({ id, editing, invalid, onToggle, onChange }: IdFieldProps) {
  const t = useT();
  const prefix = t("idField.prefix");
  const ruleId = useId();
  const input = useRef<HTMLInputElement>(null);

  // Toggling moves focus into the field: a pencil that opens something the
  // keyboard then has to hunt for is not reachable, only present.
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  // Nothing to preview and nothing opened — the empty line keeps its height so
  // the fields below do not jump once a name is typed, and the pencil stays
  // away until there is an id to change.
  if (!editing && id === "") {
    return <span className="min-h-[16px] font-mono text-[11.5px] text-muted-foreground" />;
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex min-h-[16px] flex-wrap items-center gap-1">
        {editing ? (
          <>
            <span className="font-mono text-[11.5px] text-muted-foreground">{prefix}</span>
            <input
              ref={input}
              value={id}
              onChange={(event) => onChange(event.target.value)}
              aria-label={t("idField.label")}
              aria-invalid={invalid}
              aria-describedby={invalid ? ruleId : undefined}
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded border border-input bg-panel-deep px-1.5 py-0.5 font-mono text-[11.5px] text-foreground aria-invalid:border-destructive max-md:text-[16px]"
            />
          </>
        ) : (
          <span className="font-mono text-[11.5px] text-muted-foreground">{`${prefix}${id}`}</span>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={editing}
          aria-label={t("idField.edit")}
          className="inline-flex flex-none items-center rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground aria-pressed:text-foreground"
        >
          <Pencil aria-hidden size={11.5} />
        </button>
      </span>
      {invalid && (
        <span id={ruleId} className="text-[11.5px] text-destructive">
          {t("idField.invalid")}
        </span>
      )}
    </span>
  );
}
