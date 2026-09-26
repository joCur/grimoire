// A markdown text shown on a few lines under a title — the chapter overview
// shows a chapter's text in its accordion and the campaign's text in the
// header this way.
//
// The WHOLE text is rendered, through the one markdown renderer: callouts,
// `## If:` branches, `[[id]]` references and tables look and degrade exactly
// as everywhere else. Nothing is picked out of it by a heading (decisions/data-shape); the
// only thing the view decides is how much of it stands on screen at first.
//
// How the clamp works: the box is cut at a height of `lines` lines of its own
// line height and fades out over the last one. CSS `line-clamp` is not an
// option — it only clamps inline content, and a rendered text is paragraphs,
// lists and callouts. Whether the text is actually longer than that is
// MEASURED (a ResizeObserver on the rendered text, so a font that loads late,
// a resized window or a changed text re-decide), and the toggle exists only
// then: a short text is simply shown, with nothing to press.
//
// Keyboard: a link that sits in the cut-off part still takes the focus, so
// focusing anything that is not fully visible opens the text — the focus
// never lands on something the DM cannot see. There is no animation, so there
// is nothing for `prefers-reduced-motion` to turn off.

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Markdown } from "@/markdown/Markdown";

/** How many lines the text shows before the toggle opens it. */
export const CLAMP_LINES = 4;

/**
 * Does a text of `contentHeight` pixels need the toggle at this line height?
 * One pixel of slack: sub-pixel line heights must not turn a text that fits
 * exactly into one with a show-more toggle under it.
 */
export function textOverflows(contentHeight: number, lineHeight: number, lines: number): boolean {
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return false;
  return contentHeight > lines * lineHeight + 1;
}

export function ClampedText({
  children,
  lines = CLAMP_LINES,
  className,
}: {
  /** The markdown text. Blank renders nothing at all. */
  children: string;
  lines?: number;
  className?: string;
}) {
  const t = useT();
  const id = useId();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const text = textRef.current?.querySelector<HTMLElement>(".md-body");
    if (text === null || text === undefined) return;
    const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
    setOverflows(textOverflows(text.offsetHeight, lineHeight, lines));
  }, [lines]);

  const blank = children.trim() === "";
  // Before paint, so a long text never flashes at full height first. Keyed on
  // `blank` because a blank text renders no box to observe: a lazily read
  // text arrives a render later.
  useLayoutEffect(() => {
    const text = textRef.current?.querySelector<HTMLElement>(".md-body");
    if (text === null || text === undefined) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => {
      observer.disconnect();
    };
  }, [measure, blank]);

  if (blank) return null;
  const clamped = overflows && !expanded;

  return (
    <div className={className}>
      <div
        id={id}
        ref={boxRef}
        data-clamped={clamped ? "" : undefined}
        // The box is 4px wider than the text on every side (and pulled back by
        // the same margin), so the focus ring of a link at its edge is not cut
        // off by the clip.
        className="md-compact -m-1 p-1"
        style={clamped ? { maxHeight: `calc(${lines * 1.6}em + 0.5rem)` } : undefined}
        onFocus={(event) => {
          if (!clamped) return;
          const box = boxRef.current?.getBoundingClientRect();
          const target = event.target.getBoundingClientRect();
          // The last visible line is the faded one, so it counts as cut off.
          const lineHeight = box === undefined ? 0 : (box.height - 8) / lines;
          if (box !== undefined && target.bottom > box.bottom - lineHeight) setExpanded(true);
        }}
      >
        <div ref={textRef}>
          <Markdown>{children}</Markdown>
        </div>
      </div>
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((open) => !open)}
          className={cn(
            "mt-1 -mx-0.5 rounded px-0.5 text-[12.5px] text-body-secondary hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          )}
        >
          {expanded ? t("common.showLess") : t("common.showMore")}
        </button>
      )}
    </div>
  );
}
