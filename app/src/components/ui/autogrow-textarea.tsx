// A textarea that is exactly as tall as its text.
//
// The campaign-content forms hold sentences, not words: a glossary explanation
// runs to a line or three, a style rule to a paragraph. A fixed `rows={2}` box
// makes the DM scroll inside a 40px window to re-read what they just wrote,
// and a fixed `rows={8}` leaves a hole under every one-line term. Growing with
// the content is the only size that is right for both.
//
// HOW: reset to `auto`, then take the content height — the standard trick, and
// the only one that also SHRINKS when text is deleted (measuring without the
// reset only ever grows).
//
// WHEN: on every value change, in a layout effect, so the height is right in
// the same frame the character appears in (an `onChange` handler would miss
// the programmatic changes — opening a text, a reload after a conflict) —
// AND on every change of the field's own WIDTH. The second one is not
// optional: the number of lines a paragraph takes depends on how wide the box
// is, so rotating a phone, opening a sidebar or dragging a window narrower
// re-wraps the text inside a box that was measured for the old width, and the
// bottom lines end up clipped. A ResizeObserver on the
// element sees all of those, including the ones no window event reports; the
// `window.resize` fallback is for engines without it (jsdom-style test
// environments, mostly).
//
// `min-h` keeps an empty field a legible target. The CEILING is 60vh: past
// that the field pushes its own save button off the screen, so a rule that
// long scrolls inside itself instead of scrolling the form away.

import { useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

import { INPUT_CLASS } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  value: string;
  /** Smallest height in lines. Two: enough to show that it is a text field. */
  minRows?: number;
};

export function AutoGrowTextarea({ value, className, minRows = 2, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Last width measured for. Re-measuring only on a WIDTH change keeps the
   *  observer from answering its own height write (the classic RO loop). */
  const measuredWidth = useRef<number>(-1);

  const measure = useCallback(() => {
    const node = ref.current;
    if (node === null) return;
    measuredWidth.current = node.clientWidth;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, value]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === measuredWidth.current) return;
      measure();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={cn(
        INPUT_CLASS,
        // `overflow-y-auto` and not `hidden`: with a ceiling there is now a
        // state in which the content does not fit, and a hidden overflow at
        // that point would make the rest of the paragraph unreachable.
        "max-h-[60vh] resize-none overflow-y-auto leading-[1.55]",
        className,
      )}
      {...rest}
    />
  );
}
