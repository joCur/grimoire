// A field that holds ONE id: a free-text input that offers the existing ids
// through a native <datalist> — a list that SUGGESTS but never closes the
// field, so an id stays typeable whatever the list holds (README: the format
// degrades). Under it stands a note on what the typed id resolves to; the
// caller decides what that note says.

import type { ReactNode } from "react";

import { INPUT_CLASS } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import { FieldRow, type FieldCopy } from "./FieldRow";
import type { FieldOption } from "./SelectField";

/** The known name of an id, or undefined — a label equal to the id is no name. */
export function referenceLabel(
  options: readonly FieldOption[],
  value: string,
): string | undefined {
  const hit = options.find((option) => option.value === value);
  return hit === undefined || hit.label === value ? undefined : hit.label;
}

/** The suggestion list of a reference input — ids with their names. */
export function ReferenceOptions({ id, options }: { id: string; options: readonly FieldOption[] }) {
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
 * The usual note under a reference: nothing while the field is empty, the
 * name when the id is known, nothing for a known id without a name, and
 * `unknown` when no option has the id.
 */
export function ReferenceNote({
  options,
  value,
  unknown,
}: {
  options: readonly FieldOption[];
  value: string;
  unknown: string;
}) {
  const id = value.trim();
  if (id === "") return null;
  const name = referenceLabel(options, id);
  if (name !== undefined) return <p className="text-[11.5px] text-faint">{name}</p>;
  if (options.some((option) => option.value === id)) return null;
  return <p className="text-[11.5px] text-faint">{unknown}</p>;
}

export function ReferenceField({
  id,
  value,
  options,
  note,
  onChange,
  placeholder,
  ...copy
}: FieldCopy & {
  id: string;
  value: string;
  options: readonly FieldOption[];
  /** What the typed text resolves to, under the input. */
  note: ReactNode;
  onChange: (text: string) => void;
  placeholder?: string;
}) {
  return (
    <FieldRow {...copy} labelFor={id}>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        list={`${id}-options`}
        className={cn(INPUT_CLASS, "font-mono text-[13px]")}
      />
      <ReferenceOptions id={`${id}-options`} options={options} />
      {note}
    </FieldRow>
  );
}
