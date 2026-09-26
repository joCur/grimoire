// Does a CSS media query match right now — for the few places where the
// breakpoint decides WHICH component renders, not just how it looks (a
// popover on the desktop, a sheet from the bottom on the phone). Everything a
// class can decide stays a class.

import { useCallback, useSyncExternalStore } from "react";

/** Tailwind's `md` breakpoint (48rem): the desktop layout starts here. */
export const DESKTOP_QUERY = "(min-width: 48rem)";

function supported(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/** False where there is no window to ask — a render without a browser. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!supported()) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => supported() && window.matchMedia(query).matches,
    () => false,
  );
}
