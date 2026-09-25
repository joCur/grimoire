// The hover preview of a resolved `[[slug]]` reference: WHEN it shows, WHERE
// it sits and how it leaves. What it says is components/EntityPreview.tsx.
//
// Timing, in one place:
//
//   * hover or KEYBOARD focus opens it after OPEN_DELAY_MS; the target is
//     requested at once, so on a local server it is usually there before the
//     card is;
//   * moving on to another reference while one is open — or within
//     SWITCH_WINDOW_MS after it closed — opens the next one at once, like a
//     tooltip group; there is only ever ONE preview open (module state below);
//   * leaving the reference AND the card closes it after CLOSE_DELAY_MS (the
//     card is a hover bridge, though nothing on it is clickable); blur, Esc,
//     any click and any scroll close it at once.
//
// Focus only counts when it is keyboard focus (`:focus-visible`): a mouse
// click focuses the button too, and focus handed BACK to a reference — the
// live drawer closing — must not pop a card under a pointer that has moved on.
//
// Placement: below the reference, 8px off, flush with its left edge; flipped
// above when there is no room below; shifted sideways to stay 12px inside the
// TEXT COLUMN, vertically inside the column's scroll container. That is what
// keeps a preview in the session view off the NPC aside, the log and the quick
// note. A column narrower than the card plus its margins (the draft review)
// hands the job to the viewport, and the card may reach past the column.
//
// The Radix hover card is used for its popover parts — portal, positioning,
// dismissal, presence — while the timing above is this module's own: its
// trigger is an empty anchor at the START of the reference (a reference that
// wraps is aligned with its first fragment, not with the box around both
// lines), and the content's own hover handlers are pre-empted.
//
// Touch devices get no preview and no listeners: a tap navigates, as before.

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { EntityPreview } from "@/components/EntityPreview";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { locationQuery } from "@/location/location-query";
import { npcQuery } from "@/npc/npc-query";
import { sceneQuery } from "@/scene/scene-query";

import type { ResolvedEntityRef } from "./entity-refs";

/** The query the preview of a target reads — its own, from its slice (ADR #31). */
function previewQuery(
  campaign: string,
  target: ResolvedEntityRef,
): { queryKey: QueryKey; queryFn: () => Promise<unknown> } {
  switch (target.kind) {
    case "npc":
      return npcQuery(campaign, target.slug);
    case "location":
      return locationQuery(campaign, target.slug);
    case "scene":
      return sceneQuery(campaign, target.slug);
  }
}

const OPEN_DELAY_MS = 250;
const CLOSE_DELAY_MS = 120;
const SWITCH_WINDOW_MS = 300;

/** The card's fixed width and the margin it keeps inside its boundary. */
const CARD_WIDTH_PX = 320;
const EDGE_PX = 12;

/**
 * Marks the element a preview must stay inside when it is not the text body
 * itself — the live drawer, whose whole width is the reading column.
 */
export const PREVIEW_BOUNDARY_ATTR = "data-ref-preview-boundary";

// --- one open preview at a time ---------------------------------------------

let openKey: string | null = null;
let lastClosedAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<() => void>();

function subscribeOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setOpenKey(next: string | null): void {
  if (openKey === next) return;
  if (openKey !== null) lastClosedAt = Date.now();
  openKey = next;
  for (const listener of listeners) listener();
}

function closeKey(key: string): void {
  if (openKey === key) setOpenKey(null);
}

/** Another preview is open, or just closed: the next one skips the delay. */
function opensAtOnce(): boolean {
  return openKey !== null || Date.now() - lastClosedAt < SWITCH_WINDOW_MS;
}

// --- hover capability ---------------------------------------------------------

const NO_HOVER_QUERY = "(hover: none), (pointer: coarse)";

function subscribeHover(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(NO_HOVER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function canHoverNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia(NO_HOVER_QUERY).matches;
}

/** False on touch devices — and on the server render, which has no pointer. */
export function useCanHover(): boolean {
  return useSyncExternalStore(subscribeHover, canHoverNow, () => false);
}

// --- placement boundary -------------------------------------------------------

function scrollContainer(element: Element): Element | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) return null;
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * The area the card has to stay in, measured when it opens: the text column
 * horizontally, the column's scroll container vertically. Empty means "the
 * viewport" — no column found, or one too narrow for the card.
 *
 * It is handed over as a RECT, not an element: Floating UI (under Radix'
 * popper) takes a client rect as a boundary, and no single element spans
 * exactly this area. A preview never outlives a scroll, so the rect cannot
 * go stale while the card is up.
 */
function previewBoundary(anchor: Element | null): Element[] {
  if (anchor === null) return [];
  const column = anchor.closest(`[${PREVIEW_BOUNDARY_ATTR}]`) ?? anchor.closest(".md-body");
  if (column === null) return [];
  const columnRect = column.getBoundingClientRect();
  if (columnRect.width < CARD_WIDTH_PX + 2 * EDGE_PX) return [];
  const scroller = scrollContainer(anchor);
  const scrollerRect = scroller?.getBoundingClientRect();
  const rect = {
    x: columnRect.left,
    y: scrollerRect?.top ?? 0,
    width: columnRect.width,
    height: scrollerRect?.height ?? window.innerHeight,
  };
  return [rect as unknown as Element];
}

// --- the preview ----------------------------------------------------------------

/** What the reference element needs to carry the preview. */
export interface RefPreviewTrigger {
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  /** `aria-describedby` — the card's id while it is open. */
  "aria-describedby": string | undefined;
}

export function RefPreview({
  campaign,
  target,
  nameOf,
  children,
}: {
  campaign: string;
  target: ResolvedEntityRef;
  /** Display name of a slug — references inside a short form read as names. */
  nameOf: (slug: string) => string | undefined;
  /**
   * Renders the reference element: spread `trigger` onto it and put `anchor`
   * first inside it, before the name.
   */
  children: (trigger: RefPreviewTrigger, anchor: ReactNode) => ReactNode;
}) {
  const key = useId();
  const contentId = `${key}-preview`;
  const open = useSyncExternalStore(
    subscribeOpen,
    () => openKey === key,
    () => false,
  );
  const queryClient = useQueryClient();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const [boundary, setBoundary] = useState<Element[]>([]);

  const clearTimers = (): void => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  const openNow = (): void => {
    setBoundary(previewBoundary(anchorRef.current));
    setOpenKey(key);
  };
  const show = (): void => {
    clearTimers();
    // The SAME query the card reads; `staleTime: Infinity` leaves what is
    // already cached alone.
    void queryClient.prefetchQuery({
      ...previewQuery(campaign, target),
      retry: false,
      staleTime: Infinity,
    });
    if (openKey === key) return;
    if (opensAtOnce()) openNow();
    else openTimer.current = window.setTimeout(openNow, OPEN_DELAY_MS);
  };
  const hideSoon = (): void => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => closeKey(key), CLOSE_DELAY_MS);
  };
  const hideNow = (): void => {
    clearTimers();
    closeKey(key);
  };

  // Unmounting (a navigation, a re-render of the text) takes its card along.
  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      closeKey(key);
    },
    [key],
  );

  // Any scroll closes the card — the text moved away from under it.
  useEffect(() => {
    if (!open) return;
    const onScroll = (): void => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      closeKey(key);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [open, key]);

  const trigger: RefPreviewTrigger = {
    onPointerEnter: (event) => {
      if (event.pointerType !== "touch") show();
    },
    onPointerLeave: (event) => {
      if (event.pointerType !== "touch") hideSoon();
    },
    onPointerDown: hideNow,
    onFocus: (event) => {
      if (event.currentTarget.matches(":focus-visible")) show();
    },
    onBlur: hideNow,
    "aria-describedby": open ? contentId : undefined,
  };
  const anchor = (
    <HoverCardTrigger asChild>
      <span ref={anchorRef} aria-hidden />
    </HoverCardTrigger>
  );

  return (
    <HoverCard
      open={open}
      // Radix reports its own dismissals here: Esc and a press outside.
      onOpenChange={(next) => {
        if (!next) hideNow();
      }}
    >
      {children(trigger, anchor)}
      <HoverCardContent
        id={contentId}
        role="tooltip"
        side="bottom"
        collisionPadding={EDGE_PX}
        collisionBoundary={boundary}
        className="w-[320px] max-w-[calc(100vw-32px)] p-3.5 text-left [&>:last-child]:mb-0"
        // `preventDefault` keeps Radix' own delayed open/close out of it —
        // the timers above are the only ones.
        onPointerEnter={(event) => {
          event.preventDefault();
          if (event.pointerType !== "touch") window.clearTimeout(closeTimer.current);
        }}
        onPointerLeave={(event) => {
          event.preventDefault();
          if (event.pointerType !== "touch") hideSoon();
        }}
        onPointerDown={hideNow}
      >
        <EntityPreview campaign={campaign} target={target} nameOf={nameOf} />
      </HoverCardContent>
    </HoverCard>
  );
}
