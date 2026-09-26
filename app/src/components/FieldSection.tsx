// A collapsible group of longer fields in an edit mode — the prose lines that
// are too long for a chip (an npc's profile). Collapsed it is ONE line: the
// chevron, the section's name, what its fields hold as a single cut-off line,
// and the count of changes with the dot every changed field carries. Open, the
// fields stand below it, each with its own dot when it changed.
//
// Knows nothing about which fields exist: the caller hands it the translated
// title, the one-line summary and the fields.

import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** The dot of a changed field — the same one a changed chip carries. */
export function ChangedDot() {
  return <span aria-hidden className="size-1.5 flex-none rounded-full bg-primary" />;
}

/** One field of a section, with its dot at the left edge when it changed. */
export function SectionField({ changed, children }: { changed: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      {changed && (
        <span className="absolute top-[7px] -left-3 flex">
          <ChangedDot />
        </span>
      )}
      {children}
    </div>
  );
}

export function FieldSection({
  title,
  summary,
  changes,
  defaultOpen = false,
  testId,
  children,
}: {
  title: string;
  /** What the fields hold, as one line — shown while the section is collapsed. */
  summary: string;
  /** How many of its fields changed. */
  changes: number;
  defaultOpen?: boolean;
  /** The toggle's test id. */
  testId?: string;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  return (
    <section className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        data-testid={testId}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full min-w-0 items-center gap-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ChevronRight
          aria-hidden
          size={14}
          className={cn(
            "flex-none text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <span className="flex-none text-[11px] font-semibold tracking-[.09em] text-muted-foreground uppercase">
          {title}
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-[13px] text-dim", open && "invisible")}>
          {summary}
        </span>
        {changes > 0 && (
          <span className="flex flex-none items-center gap-1.5 text-[12px] font-semibold text-primary">
            <ChangedDot />
            {t("editMode.changes", { count: changes })}
          </span>
        )}
      </button>
      {open && (
        <div id={regionId} role="group" aria-label={title} className="flex flex-col gap-3.5 pt-1 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
