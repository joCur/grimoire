// The raw-markdown editor: a mono textarea and the rendered preview of the
// SAME markdown pipeline a real file gets, switched by one quiet toggle.
//
// It grew in the generator review (issues #12/#21, one toggle per draft card)
// and is now also the reading view's edit mode (issue #15) — same surface, so
// "Bearbeiten" feels identical wherever the DM meets it.
//
// Two granularities on purpose:
//
//   MarkdownEditorToggle / MarkdownEditorSurface — the two halves separately,
//   for the generator cards where the toggle rides in the card header and the
//   surface sits below the chip row (they are not siblings).
//   MarkdownEditor — the composed block (toolbar + surface) for callers that
//   own the whole editing area, with an `actions` slot for their own buttons.
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
 * Toolbar plus surface as one block: the toggle on the left, the caller's
 * `actions` (Speichern/Abbrechen in the reading view) on the right. Wraps at
 * narrow widths so the actions drop below the toggle instead of shrinking.
 */
export function MarkdownEditor({
  value,
  onChange,
  editing,
  onToggleEditing,
  id,
  label,
  preview,
  actions,
}: MarkdownEditorSurfaceProps & {
  onToggleEditing: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-[color-mix(in_srgb,var(--card)_60%,var(--background))] px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <MarkdownEditorToggle
          editing={editing}
          onToggleEditing={onToggleEditing}
          controlsId={id}
        />
        {actions !== undefined && (
          <span className="ml-auto flex flex-wrap items-center gap-2">{actions}</span>
        )}
      </div>
      <MarkdownEditorSurface
        value={value}
        onChange={onChange}
        editing={editing}
        id={id}
        label={label}
        preview={preview}
      />
    </div>
  );
}
