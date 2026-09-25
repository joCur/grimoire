// A list field as chips: added with Enter (or a comma), removed with their
// own button or Backspace in an empty add-input. With `options` the chips are
// ids — mono, the known name beside each, the existing ids suggested through
// a <datalist>; without them they are free text.
//
// Enter NEVER submits the form from here — a half-typed chip must not be what
// saves the dialog — and every Enter/Backspace handler steps aside while an
// IME composition is running.
//
// The text still standing in the add-input is `pending`, owned by the caller
// so a save can fold it in instead of losing it.

import { X } from "lucide-react";

import { INPUT_CLASS } from "@/components/ui/field";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { FieldRow, type FieldCopy } from "./FieldRow";
import { ReferenceOptions, referenceLabel } from "./ReferenceField";
import type { FieldOption } from "./SelectField";

export function ChipsField({
  id,
  items,
  options,
  pending,
  onChange,
  onPendingChange,
  ...copy
}: FieldCopy & {
  id: string;
  items: readonly string[];
  /** The known ids, when the chips are ids. */
  options?: readonly FieldOption[];
  pending: string;
  onChange: (items: string[]) => void;
  onPendingChange: (text: string) => void;
}) {
  const t = useT();
  const isReference = options !== undefined;
  const add = () => {
    const entry = pending.trim();
    onPendingChange("");
    if (entry === "" || items.includes(entry)) return;
    onChange([...items, entry]);
  };

  return (
    <FieldRow {...copy} labelFor={id}>
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
                aria-label={t("properties.field.remove.aria", { item })}
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
        placeholder={t("properties.field.chipsPlaceholder")}
        className={cn(INPUT_CLASS, isReference && "font-mono text-[13px]")}
      />
      {isReference && <ReferenceOptions id={`${id}-options`} options={options} />}
    </FieldRow>
  );
}
