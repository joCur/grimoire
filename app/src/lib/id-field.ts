// The id line of the create surfaces: derived from the name, or set by hand.
//
// An id is permanent (decisions/constraints — there is no endpoint that changes one), and
// that decision names exactly one moment where it may be personalised: the create
// dialog. So the quiet preview line under the name field is not read-only:
// it carries a pencil; pressing it turns the line into a field prefilled
// with the id the name currently yields.
//
// The state worth naming is WHOSE id is on screen. Two answers, and the pure
// half of the whole feature:
//
//   derived  the id follows the name, character by character, as before.
//   manual   the DM typed something, so the name stops feeding it — anything
//            else would silently discard what was typed on the next keystroke
//            in the name field.
//
// Back to derived happens two ways, both of them "I did not mean to": pressing
// the pencil again, and emptying the field. An empty id is never a legal one,
// so treating the empty field as "never mind" beats showing a rule violation
// for a field the DM just cleared.
//
// No react here — the surfaces hold the state, this module answers what it
// means (components/IdField.tsx renders it, lib/create.ts derives the id).

import { isEntityId } from "@grimoire/shared/slug";

import { derivedId } from "@/lib/create";

/** The id line's state — one per create surface. */
export interface IdFieldState {
  /** A text field rather than the quiet preview line (the pencil is pressed). */
  editing: boolean;
  /**
   * What the DM typed. `undefined` means the id still follows the name, which
   * is the state a surface starts in and returns to.
   */
  manual?: string;
}

/** A fresh create surface: the line follows the name and is not editable yet. */
export const ID_FIELD_START: IdFieldState = { editing: false };

/** The id that will be created — what the DM typed, else what the name yields. */
export function resolvedId(state: IdFieldState, name: string): string {
  return state.manual ?? derivedId(name);
}

/** True while the id follows the name instead of a typed one. */
export function followsName(state: IdFieldState): boolean {
  return state.manual === undefined;
}

/**
 * Is this id one the format accepts? The rule is the shared one
 * (`ENTITY_SLUG`), so the field rejects exactly what the store would.
 * The empty id is not legal — a name that yields none is the create's own
 * precondition (`canCreate`), not this field's error.
 */
export function idAllowed(id: string): boolean {
  return isEntityId(id);
}

/**
 * Only send an explicit id when the DM actually set one. A derived id is left
 * out of the request so the server derives it itself — the same body as before
 * the pencil existed, and one less chance for the two derivations to disagree.
 */
export function submittedId(state: IdFieldState): string | undefined {
  return state.manual;
}

/**
 * The pencil. Opening prefills nothing — the field shows `resolvedId` either
 * way — and closing drops the typed id, which is the "never mind" of an id
 * that is already wrong.
 */
export function toggleIdField(state: IdFieldState): IdFieldState {
  return state.editing ? ID_FIELD_START : { editing: true };
}

/**
 * A keystroke in the id field. The typed text is taken verbatim, including
 * text the rule rejects: correcting a character while typing would fight the
 * DM, so the invalid id stands on screen, named, and blocks the submit.
 * Emptying the field hands the id back to the name.
 */
export function typeIdField(state: IdFieldState, typed: string): IdFieldState {
  return typed === "" ? { editing: state.editing } : { editing: state.editing, manual: typed };
}

/**
 * Taking the 409 proposal (`slug_taken`) settles the id as a typed one: it is
 * the DM's explicit choice, and the field has to show it rather than jumping
 * back to the name's derivation while the create runs.
 */
export function takeIdSuggestion(state: IdFieldState, suggestion: string): IdFieldState {
  return { editing: state.editing, manual: suggestion };
}
