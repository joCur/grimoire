// The state of an edit mode's form: the values it opened with and the typed
// ones. Knows no fields of its own — each entity's form (<entity>-form.ts)
// says what a change is.

import { useState } from "react";

/** The form's state: the values it opened with and the typed ones. */
export interface FieldsForm<T> {
  /**
   * What the change is measured against, taken when the form opened — NOT
   * the row behind it, or a write landing in the cache would silently swallow
   * the DM's change. It moves only when the DM adopts the stored row after a
   * conflict.
   */
  initial: T;
  values: T;
  setValues: (next: T) => void;
  /** Refill the form from a stored row: nothing typed any more. */
  reseed: (values: T) => void;
}

export function useFieldsForm<T>(seed: T): FieldsForm<T> {
  const [initial, setInitial] = useState<T>(seed);
  const [values, setValues] = useState<T>(initial);
  return {
    initial,
    values,
    setValues,
    reseed: (refilled) => {
      setInitial(refilled);
      setValues(refilled);
    },
  };
}
