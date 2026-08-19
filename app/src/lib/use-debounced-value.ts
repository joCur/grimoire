// Trailing-edge debounce for fast-changing values (the ⌘K search input).

import { useEffect, useState } from "react";

/**
 * Returns `value`, updated only after it has been stable for `delayMs`.
 * The first render returns the value immediately (nothing to debounce yet).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
