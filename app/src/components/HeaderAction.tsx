// The quiet trigger next to an entity/campaign header (issue #38): one shape
// for „Bearbeiten" (body editor, #15), „Eigenschaften" (#42) and „Bearbeiten"
// of the campaign metadata (#34). They sit next to each other in the same
// header, so they must be one component — copies of the class list is how they
// drift apart.
//
// Deliberately plain: no variants, no size prop. It is the header vocabulary
// of the reading view, not a general button (that is components/ui/button).

import type { LucideIcon } from "lucide-react";

export function HeaderAction({
  icon: Icon,
  label,
  onClick,
}: {
  /** Lucide glyph, rendered decorative — the label carries the meaning. */
  icon: LucideIcon;
  /** German, as it stands in the header („Bearbeiten", „Eigenschaften"). */
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-none items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <Icon aria-hidden size={12.5} className="flex-none" />
      {label}
    </button>
  );
}
