// A free-text field: one line, or — `multiline` — the fields that hold a
// sentence. Plain rendering: the value comes in, a new one goes out. The notes
// a page has about the field (components/place-notes.tsx) stand under the
// control and describe it.

import { describedBy, PlaceNoteList, useControlNotes } from "@/components/place-notes";
import { INPUT_CLASS } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import { FieldRow, type FieldCopy } from "./FieldRow";

export function TextField({
  id,
  value,
  onChange,
  placeholder,
  multiline = false,
  ...copy
}: FieldCopy & {
  id: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const notes = useControlNotes(id);
  return (
    <FieldRow {...copy} labelFor={id} notes={<PlaceNoteList notes={notes} />}>
      {multiline ? (
        <textarea
          id={id}
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-describedby={describedBy(notes)}
          className={cn(INPUT_CLASS, "resize-y leading-[1.55]")}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck
          aria-describedby={describedBy(notes)}
          className={INPUT_CLASS}
        />
      )}
    </FieldRow>
  );
}
