// The controls of the „Eigenschaften" form (issue #42) — one row per
// frontmatter field, chosen by the field's control. Kept apart from the dialog
// so the dialog stays the save/409 shell and this file stays plain rendering:
// every row gets its value and gives back a new one, no queries, no writes.
//
// Keyboard first (quality floor): every control is a native input/select/
// button, chips are added with Enter and removed with their own button (or
// Backspace in an empty add-input), and the reference inputs offer the existing
// ids through a native <datalist> — a list that SUGGESTS but never closes the
// field, because a reference to a file that does not exist yet must stay
// typeable (README: the format degrades).
//
// Two keyboard details that only look like details: Enter NEVER submits from
// inside this form (chips take it, the quickstat cells swallow it — a save
// closing the dialog mid-edit is the bug it prevents), and every Enter/
// Backspace handler steps aside while an IME composition is running.

import type { CampaignTree } from "@grimoire/shared/types";
import { ChevronDown, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  referenceLabel,
  referenceOptions,
  selectOptions,
  type FieldOption,
  type FieldValue,
  type FrontmatterField,
} from "@/lib/frontmatter-form";
import { cn } from "@/lib/utils";

/** The input vocabulary of the two existing dialogs (issues #30/#34). */
const INPUT_CLASS =
  "w-full rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground max-md:text-[16px]";

/** Stable per-field DOM id — one dialog is on screen at a time. */
function fieldId(key: string): string {
  return `fm-${key.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

/** Label, control, hint — the same three lines for every field. */
function FieldRow({
  field,
  labelFor,
  issue,
  children,
}: {
  field: FrontmatterField;
  /** Set when ONE input carries the field; unset for the group controls. */
  labelFor?: string;
  /** What blocks the save in THIS field (frontmatterFormIssues), in German. */
  issue?: string;
  children: ReactNode;
}) {
  const label = (
    <span className="text-[12px] text-body-secondary">
      {field.label}
      {field.required === true && <span className="text-faint"> · nötig</span>}
    </span>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {labelFor === undefined ? (
        label
      ) : (
        <label htmlFor={labelFor} className="flex flex-col">
          {label}
        </label>
      )}
      {children}
      {field.hint !== undefined && <p className="text-[11.5px] text-faint">{field.hint}</p>}
      {issue !== undefined && (
        <p aria-live="polite" className="text-[11.5px] text-destructive">
          {issue}
        </p>
      )}
    </div>
  );
}

/**
 * One field of the form. `pending` is the text still standing in a chip input
 * — it lives in the dialog so „Speichern" can fold it in instead of losing it.
 */
export function FrontmatterFieldControl({
  field,
  value,
  initialValue,
  tree,
  pending,
  issue,
  onChange,
  onPendingChange,
}: {
  field: FrontmatterField;
  value: FieldValue;
  /**
   * What the field held when the dialog OPENED. A select derives its extra
   * option from this and not from `value`, so a hand-written unknown value
   * (`status: onhold`) stays selectable even after the DM clicked away from it.
   */
  initialValue?: FieldValue;
  /** Reference options come from the campaign tree; undefined = none yet. */
  tree: CampaignTree | undefined;
  pending: string;
  /** The German line that says why the save is blocked in this field. */
  issue?: string;
  onChange: (value: FieldValue) => void;
  onPendingChange: (text: string) => void;
}) {
  const options = field.source === undefined ? [] : referenceOptions(tree, field.source);

  if (value.kind === "list") {
    return (
      <ChipsField
        field={field}
        items={value.items}
        options={options}
        pending={pending}
        issue={issue}
        onChange={(items) => onChange({ kind: "list", items })}
        onPendingChange={onPendingChange}
      />
    );
  }
  if (value.kind === "pairs") {
    return (
      <PairsField
        field={field}
        entries={value.entries}
        issue={issue}
        onChange={(entries) => onChange({ kind: "pairs", entries })}
      />
    );
  }

  const id = fieldId(field.key);
  const setText = (text: string) => onChange({ kind: "text", text });

  if (field.control === "select") {
    const initialText = initialValue?.kind === "text" ? initialValue.text : value.text;
    return (
      <FieldRow field={field} labelFor={id} issue={issue}>
        <div className="relative">
          <select
            id={id}
            value={value.text}
            onChange={(e) => setText(e.target.value)}
            className={cn(INPUT_CLASS, "appearance-none pr-9")}
          >
            {/* Clearing is a real choice: it deletes the key. */}
            <option value="">— nicht gesetzt —</option>
            {selectOptions(field.options ?? [], value.text, initialText).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            size={14}
            className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </FieldRow>
    );
  }

  if (field.control === "textarea") {
    return (
      <FieldRow field={field} labelFor={id} issue={issue}>
        <textarea
          id={id}
          rows={2}
          value={value.text}
          onChange={(e) => setText(e.target.value)}
          placeholder={field.placeholder}
          className={cn(INPUT_CLASS, "resize-y leading-[1.55]")}
        />
      </FieldRow>
    );
  }

  const isReference = field.control === "reference";
  return (
    <FieldRow field={field} labelFor={id} issue={issue}>
      <input
        id={id}
        value={value.text}
        onChange={(e) => setText(e.target.value)}
        placeholder={field.placeholder}
        autoComplete="off"
        spellCheck={!isReference}
        list={isReference ? `${id}-options` : undefined}
        className={cn(INPUT_CLASS, isReference && "font-mono text-[13px]")}
      />
      {isReference && <ReferenceOptions id={`${id}-options`} options={options} />}
      {isReference && <ReferenceHint options={options} value={value.text} />}
    </FieldRow>
  );
}

/** The suggestion list of a reference input — ids with their names. */
function ReferenceOptions({ id, options }: { id: string; options: readonly FieldOption[] }) {
  return (
    <datalist id={id}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </datalist>
  );
}

/**
 * What the typed id resolves to. Says nothing while the field is empty, names
 * the entity when the id is known, and says so quietly when it is not — an
 * unknown id is allowed (it may get its file later), it should just not look
 * like a typo went unnoticed.
 */
function ReferenceHint({ options, value }: { options: readonly FieldOption[]; value: string }) {
  const id = value.trim();
  if (id === "") return null;
  const name = referenceLabel(options, id);
  if (name !== undefined) return <p className="text-[11.5px] text-faint">{name}</p>;
  if (options.some((option) => option.value === id)) return null;
  return <p className="text-[11.5px] text-faint">Noch keine Datei mit dieser id.</p>;
}

/** Chips for a string list (`tags`, `handouts`) or an id list (`npcs`). */
function ChipsField({
  field,
  items,
  options,
  pending,
  issue,
  onChange,
  onPendingChange,
}: {
  field: FrontmatterField;
  items: readonly string[];
  options: readonly FieldOption[];
  pending: string;
  issue?: string;
  onChange: (items: string[]) => void;
  onPendingChange: (text: string) => void;
}) {
  const id = fieldId(field.key);
  const isReference = field.control === "references";
  const add = () => {
    const entry = pending.trim();
    onPendingChange("");
    if (entry === "" || items.includes(entry)) return;
    onChange([...items, entry]);
  };

  return (
    <FieldRow field={field} labelFor={id} issue={issue}>
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {/* Keyed and removed BY INDEX: a hand-edited `tags: [social, social]`
              has to render twice and lose exactly the chip that was clicked —
              removing by value would delete both (README: format degrades). */}
          {items.map((item, index) => (
            <li
              key={index}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-3 text-[12.5px] text-body-secondary"
            >
              <span className={isReference ? "font-mono text-[12px]" : undefined}>{item}</span>
              {isReference && referenceLabel(options, item) !== undefined && (
                <span className="text-faint">{referenceLabel(options, item)}</span>
              )}
              <button
                type="button"
                aria-label={`${item} entfernen`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X aria-hidden size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        value={pending}
        onChange={(e) => onPendingChange(e.target.value)}
        onKeyDown={(e) => {
          // While an IME composition runs, these keys belong to the
          // composition (Enter confirms a candidate, Backspace deletes a
          // syllable) — making a chip or dropping one there eats the input.
          const composing = e.nativeEvent.isComposing;
          if (e.key === "Enter") {
            // Enter belongs to the chip, not to the form — a half-typed tag
            // must never be what submits the dialog. That holds mid-composition
            // too, so the default is stopped before the IME guard.
            e.preventDefault();
            if (!composing) add();
            return;
          }
          if (composing) return;
          if (e.key === ",") {
            e.preventDefault();
            add();
            return;
          }
          if (e.key === "Backspace" && pending === "" && items.length > 0) {
            onChange(items.slice(0, -1));
          }
        }}
        autoComplete="off"
        spellCheck={!isReference}
        list={isReference ? `${id}-options` : undefined}
        placeholder="hinzufügen, Enter"
        className={cn(INPUT_CLASS, isReference && "font-mono text-[13px]")}
      />
      {isReference && <ReferenceOptions id={`${id}-options`} options={options} />}
    </FieldRow>
  );
}

/**
 * Free key/value rows (`quickstats`) — a row without a value deletes its key,
 * a row without a name blocks the save (frontmatterFormIssues) instead of
 * disappearing quietly.
 */
function PairsField({
  field,
  entries,
  issue,
  onChange,
}: {
  field: FrontmatterField;
  entries: readonly { key: string; value: string }[];
  issue?: string;
  onChange: (entries: { key: string; value: string }[]) => void;
}) {
  const replace = (index: number, entry: { key: string; value: string }) =>
    onChange(entries.map((existing, i) => (i === index ? entry : existing)));
  // These two inputs are the only ones in the form where Enter would hit the
  // form's implicit submit — the dialog would save and close in the middle of
  // typing a stat. Enter here means „done with this cell", i.e. nothing.
  const swallowEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.preventDefault();
  };

  return (
    <FieldRow field={field} issue={issue}>
      {entries.map((entry, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            value={entry.key}
            onChange={(e) => replace(index, { ...entry, key: e.target.value })}
            onKeyDown={swallowEnter}
            aria-label={`${field.label}, Zeile ${index + 1}: Name`}
            autoComplete="off"
            spellCheck={false}
            placeholder="insight"
            className={cn(INPUT_CLASS, "flex-1 font-mono text-[13px]")}
          />
          <input
            value={entry.value}
            onChange={(e) => replace(index, { ...entry, value: e.target.value })}
            onKeyDown={swallowEnter}
            aria-label={`${field.label}, Zeile ${index + 1}: Wert`}
            autoComplete="off"
            spellCheck={false}
            placeholder="+2"
            className={cn(INPUT_CLASS, "w-[84px] flex-none font-mono text-[13px]")}
          />
          <button
            type="button"
            aria-label={`${entry.key === "" ? `Zeile ${index + 1}` : entry.key} entfernen`}
            onClick={() => onChange(entries.filter((_, i) => i !== index))}
            className="flex-none rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X aria-hidden size={13} />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange([...entries, { key: "", value: "" }])}
        className="h-auto self-start border-input bg-transparent px-2.5 py-1 text-[12px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
      >
        Zeile hinzufügen
      </Button>
    </FieldRow>
  );
}
