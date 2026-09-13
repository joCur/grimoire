// A textarea that is exactly as tall as its text (issue #53, PO feedback on
// PR #87).
//
// The campaign-content forms hold sentences, not words: a glossary explanation
// runs to a line or three, a style rule to a paragraph. A fixed `rows={2}` box
// makes the DM scroll inside a 40px window to re-read what they just wrote,
// and a fixed `rows={8}` leaves a hole under every one-line term. Growing with
// the content is the only size that is right for both.
//
// HOW: reset to `auto`, then take the content height — the standard trick, and
// the only one that also SHRINKS when text is deleted (measuring without the
// reset only ever grows). It runs in a layout effect on every value change, so
// the height is right in the same frame the character appears in; doing it in
// an `onChange` handler instead misses the programmatic value changes (opening
// an entry for editing, a reload after a conflict).
//
// `min-h` keeps an empty field a legible target; there is no max — the page
// scrolls, and a rule long enough to need its own scrollbar is a rule the DM
// should be able to see whole.

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

import { INPUT_CLASS } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  value: string;
  /** Smallest height in lines. Two: enough to show that it is a text field. */
  minRows?: number;
};

export function AutoGrowTextarea({ value, className, minRows = 2, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={cn(INPUT_CLASS, "resize-none overflow-hidden leading-[1.55]", className)}
      {...rest}
    />
  );
}
