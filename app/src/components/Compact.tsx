// The parts every compact short form is built from — the rows of a live aside
// card and of the hover preview of a `[[slug]]` reference: the serif name, the
// head line with a kind and a status, and the static bars that stand in while
// the rows load. Presentation only; what the rows say is the caller's.

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Serif display name, the first row of every short form. */
export function CompactName({ name }: { name: string }) {
  return <p className="mb-px font-serif text-[15px] font-semibold text-foreground">{name}</p>;
}

/** How loud a status is: good news, a warning, or quiet. */
export interface CompactStatus {
  label: string;
  tone: "good" | "warning" | "quiet";
  /** A mark in front of the label — only a warning carries one. */
  icon?: LucideIcon;
}

/** The head line of a preview: what the target is, and its status. */
export function CompactHead({ kind, status }: { kind: string; status?: CompactStatus | undefined }) {
  return (
    <p className="mb-1 flex items-center gap-1.5 text-[11px] tracking-[.06em] uppercase text-muted-foreground">
      <span>{kind}</span>
      {status !== undefined && (
        <>
          <span aria-hidden className="text-faint">
            ·
          </span>
          <StatusLabel status={status} />
        </>
      )}
    </p>
  );
}

function StatusLabel({ status }: { status: CompactStatus }) {
  const Icon = status.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11.5px] tracking-normal normal-case",
        status.tone === "good" && "text-success-text",
        status.tone === "warning" && "text-destructive",
        status.tone === "quiet" && "text-dim",
      )}
    >
      {Icon !== undefined && <Icon aria-hidden size={12} className="flex-none" />}
      {status.label}
    </span>
  );
}

const BAR = "my-[7px] block h-[9px] rounded-[4px] bg-secondary";

/**
 * Static bars where the rows will be — no shimmer, nothing that moves.
 * `widths` are the bars' width classes, `chips` the number of small boxes
 * under them.
 */
export function CompactPlaceholder({
  widths,
  chips = 0,
}: {
  widths: readonly string[];
  chips?: number;
}) {
  return (
    <div aria-hidden className="mt-1.5">
      {widths.map((width, index) => (
        <span key={index} className={cn(BAR, width)} />
      ))}
      {chips > 0 && (
        <div className="mt-2.5 flex gap-[5px]">
          {Array.from({ length: chips }, (_, index) => (
            <span
              key={index}
              className="h-[18px] w-[58px] rounded-[4px] border border-border bg-secondary"
            />
          ))}
        </div>
      )}
    </div>
  );
}
