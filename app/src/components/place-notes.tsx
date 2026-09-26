// Notes that belong to a PLACE of what a card shows: one of its fields, or the
// block of its body a line sits in. What a note says is the business of the
// page that composes the card; a field or a body only knows where it is, and
// shows the notes that name it right there — bound to it with
// `aria-describedby`, never announced on their own.
//
// A note is handed over rendered, with the DOM id its element carries, so the
// place can point at it. Without a provider there are no notes, and every
// field and body renders exactly as it does anywhere else.

import { createContext, Fragment, useContext, type ReactNode } from "react";

import { fieldId } from "@/components/fields/FieldRow";
import { cn } from "@/lib/utils";

/** One rendered note and the id of the element it renders. */
export interface PlaceNote {
  id: string;
  node: ReactNode;
}

/** The notes of one card, by where they stand. */
export interface PlaceNotes {
  /** By the name of the field on its entity (`title`, `role`, …). */
  fields: Readonly<Record<string, readonly PlaceNote[]>>;
  /** By the 1-based line of the body they were found in. */
  lines: ReadonlyArray<{ line: number; note: PlaceNote }>;
}

export const NO_PLACE_NOTES: PlaceNotes = { fields: {}, lines: [] };

const PlaceNotesContext = createContext<PlaceNotes>(NO_PLACE_NOTES);

export function PlaceNotesProvider({
  notes,
  children,
}: {
  notes: PlaceNotes;
  children: ReactNode;
}) {
  return <PlaceNotesContext.Provider value={notes}>{children}</PlaceNotesContext.Provider>;
}

/** Every note of the card this renders in. */
export function usePlaceNotes(): PlaceNotes {
  return useContext(PlaceNotesContext);
}

const NONE: readonly PlaceNote[] = [];

/** The notes at one field, by its name. */
export function useFieldNotes(field: string): readonly PlaceNote[] {
  return usePlaceNotes().fields[field] ?? NONE;
}

/**
 * The notes at the form control with this DOM id — a field's control carries
 * `fieldId(name)`, which is how a form field finds its notes without knowing
 * whose field it is.
 */
export function useControlNotes(id: string): readonly PlaceNote[] {
  const { fields } = usePlaceNotes();
  const name = Object.keys(fields).find((field) => fieldId(field) === id);
  return name === undefined ? NONE : (fields[name] ?? NONE);
}

/** The value of `aria-describedby` for these notes; undefined for none. */
export function describedBy(notes: readonly PlaceNote[]): string | undefined {
  return notes.length === 0 ? undefined : notes.map((note) => note.id).join(" ");
}

/** The notes of one place, stacked under it. Nothing for none. */
export function PlaceNoteList({
  notes,
  className,
}: {
  notes: readonly PlaceNote[];
  className?: string;
}) {
  if (notes.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {notes.map((note) => (
        <Fragment key={note.id}>{note.node}</Fragment>
      ))}
    </div>
  );
}

/** The notes at fields, except the ones the caller shows at their field itself. */
export function FieldNotesExcept({
  shown,
  className,
}: {
  /** The fields whose notes stand elsewhere. */
  shown: readonly string[];
  className?: string;
}) {
  const { fields } = usePlaceNotes();
  const notes = Object.entries(fields)
    .filter(([field]) => !shown.includes(field))
    .flatMap(([, list]) => list);
  return <PlaceNoteList notes={notes} {...(className === undefined ? {} : { className })} />;
}

/** Every note of the card — for a card that shows neither its fields nor its body. */
export function AllPlaceNotes({ className }: { className?: string }) {
  const { fields, lines } = usePlaceNotes();
  const notes = [...Object.values(fields).flat(), ...lines.map((entry) => entry.note)];
  return <PlaceNoteList notes={notes} {...(className === undefined ? {} : { className })} />;
}
