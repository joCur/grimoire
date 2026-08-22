// The raw-markdown editor: a mono textarea and the rendered preview of the
// SAME markdown pipeline a real file gets, switched by one quiet toggle.
//
// It grew in the generator review (issues #12/#21, one toggle per draft card)
// and is now also the reading view's edit mode (issue #15) — same surface, so
// "Bearbeiten" feels identical wherever the DM meets it.
//
// Three parts, and every caller composes them itself: the TOGGLE, the SURFACE
// and the framed EditorShell around them. Nothing here is a composed
// „whole editor" — the generator cards put the toggle in the card header and
// the surface below the chip row (they are not siblings), and the reading view
// puts a mode switch and its Speichern/Abbrechen into the same toolbar. A
// pre-composed block would fit neither, and the one that used to sit here fit
// nobody: it had no caller left.
//
// No local state: the caller owns `value` and `editing`, because both outlive
// this component (the generator mirrors edits into its server job, the reading
// view has to keep the text through a save conflict).

import { PenLine } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/markdown/Markdown";

/**
 * Bearbeiten ⇄ Vorschau. `controlsId` is the textarea's id — announced as the
 * controlled region only while it exists (in preview mode there is no
 * textarea to point at).
 */
export function MarkdownEditorToggle({
  editing,
  onToggleEditing,
  controlsId,
}: {
  editing: boolean;
  onToggleEditing: () => void;
  controlsId: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-expanded={editing}
      aria-controls={editing ? controlsId : undefined}
      onClick={onToggleEditing}
      className="h-auto flex-none gap-1.5 border-input bg-transparent px-2.5 py-[5px] text-[12px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground [&_svg]:size-[13px]"
    >
      <PenLine aria-hidden />
      {editing ? "Vorschau" : "Bearbeiten"}
    </Button>
  );
}

export interface MarkdownEditorSurfaceProps {
  /** The raw markdown in the textarea — the caller's state. */
  value: string;
  onChange: (value: string) => void;
  editing: boolean;
  /** id of the textarea; the toggle's aria-controls target. */
  id: string;
  /** aria-label of the textarea; include the file/draft name so labels stay unique. */
  label: string;
  /**
   * What the preview renders when it must differ from `value`: the generator
   * strips the frontmatter block off its drafts (lib/generate.ts markdownBody)
   * because a draft is a whole FILE. Defaults to `value`, which is what the
   * reading view needs — GET /file already hands out a body without it.
   */
  preview?: string;
}

/** Either the mono textarea or the rendered body — never both. */
export function MarkdownEditorSurface({
  value,
  onChange,
  editing,
  id,
  label,
  preview,
}: MarkdownEditorSurfaceProps) {
  return editing ? (
    <textarea
      id={id}
      rows={22}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-4 py-3.5 font-mono text-[12.5px] leading-[1.6] text-body outline-none focus-visible:border-border-hover"
    />
  ) : (
    <Markdown>{preview ?? value}</Markdown>
  );
}

/**
 * The framed editing card: a wrapping toolbar row (mode controls left, the
 * caller's actions right) over whatever surface is on screen. Wraps at narrow
 * widths so the actions drop below the controls instead of shrinking.
 *
 * Shared with the block composer (issue #43), which puts its own controls in
 * the toolbar and its block list below — one frame, so „Bearbeiten" looks the
 * same whichever surface the DM is on.
 */
export function EditorShell({
  controls,
  actions,
  children,
}: {
  controls: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-[color-mix(in_srgb,var(--card)_60%,var(--background))] px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-center gap-2">
        {controls}
        {actions !== undefined && (
          <span className="ml-auto flex flex-wrap items-center gap-2">{actions}</span>
        )}
      </div>
      {children}
    </div>
  );
}
