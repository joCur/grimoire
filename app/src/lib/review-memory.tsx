// Cosmetic memory of the review sitting (issue #10). The server stores only
// WHETHER an entry was harvested (`reviewed` hash / `- [x]`), not WHICH
// action it got — the specific done label ("Als Faden übernommen" …) and the
// "neu" chip on freshly adopted threads therefore live in the browser for
// as long as the app is open. Nothing here is persisted (no localStorage —
// the server is the truth); after a reload the neutral label is shown.
//
// It sits above the router (App's Layout) because the topbar's progress and
// the review page must count the same cards.

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ReviewActionKind = "thread" | "npc" | "dismiss";

interface ReviewMemoryValue {
  /** `${campaign}|${entryKey}` → the action taken in this browser session. */
  acted: Readonly<Record<string, ReviewActionKind>>;
  /** campaign → thread texts adopted in this browser session. */
  adopted: Readonly<Record<string, string[]>>;
  remember: (
    campaign: string,
    entryKey: string,
    action: ReviewActionKind,
    threadText?: string,
  ) => void;
}

const ReviewMemoryContext = createContext<ReviewMemoryValue>({
  acted: {},
  adopted: {},
  remember: () => {},
});

export function ReviewMemoryProvider({ children }: { children: React.ReactNode }) {
  const [acted, setActed] = useState<Record<string, ReviewActionKind>>({});
  const [adopted, setAdopted] = useState<Record<string, string[]>>({});

  const remember = useCallback(
    (campaign: string, entryKey: string, action: ReviewActionKind, threadText?: string) => {
      setActed((current) => ({ ...current, [`${campaign}|${entryKey}`]: action }));
      if (threadText !== undefined) {
        setAdopted((current) => ({
          ...current,
          [campaign]: [...(current[campaign] ?? []), threadText],
        }));
      }
    },
    [],
  );

  const value = useMemo<ReviewMemoryValue>(
    () => ({ acted, adopted, remember }),
    [acted, adopted, remember],
  );
  return <ReviewMemoryContext.Provider value={value}>{children}</ReviewMemoryContext.Provider>;
}

export function useReviewMemory(): ReviewMemoryValue {
  return useContext(ReviewMemoryContext);
}

/** The entry keys of one campaign that were acted on in this session. */
export function useActedKeys(campaign: string): ReadonlyMap<string, ReviewActionKind> {
  const { acted } = useReviewMemory();
  return useMemo(() => {
    const prefix = `${campaign}|`;
    const map = new Map<string, ReviewActionKind>();
    for (const [key, action] of Object.entries(acted)) {
      if (key.startsWith(prefix)) map.set(key.slice(prefix.length), action);
    }
    return map;
  }, [acted, campaign]);
}
