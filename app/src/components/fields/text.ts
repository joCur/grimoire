// The rule of a free-text field once it is written: whitespace around a value
// is not part of it, and a field left blank clears the value (`null`) instead
// of writing an empty one.

/** The value a text field writes: trimmed, or `null` when nothing is left. */
export function textValue(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}
