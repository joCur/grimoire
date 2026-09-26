// The quiet trigger next to an entity or campaign header: one shape for the
// edit action of a reading view, the augment run and the edit action of the
// campaign. They sit next to each other in the same header, so they must be
// one component — copies of the class list is how they drift apart.
//
// Deliberately plain: no variants, no size prop. It is the header vocabulary
// of the reading view, not a general button (that is components/ui/button).

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function HeaderAction({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  /** Lucide glyph, rendered decorative — the label carries the meaning. */
  icon: LucideIcon;
  /** The label as it stands in the header, from the catalog. */
  label: string;
  onClick: () => void;
  /**
   * The ONE thing a caller may vary: WHERE the action appears. The augment
   * action is desktop-only — mobile is the reading surface, not a diff
   * review — and that is a placement rule, not a new variant.
   */
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex flex-none items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <Icon aria-hidden size={12.5} className="flex-none" />
      {label}
    </button>
  );
}
