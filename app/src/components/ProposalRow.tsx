// One proposal row of a generator review: marker, name, mono label, italic
// reason, and the decision — accept (which writes it), reject, or accept a
// rejected one after all. What the row proposes is the caller's; the row
// knows only its state, and shows what the caller notes about it under its
// name.

import { Check, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** What became of one part of a run — what a proposal row shows. */
export type PartState = "open" | "written" | "dropped" | "rejected";

const ACCEPT =
  "h-auto rounded-md border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-3 py-1.5 text-[12.5px] font-normal text-primary-hover hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] hover:text-primary-hover";
const QUIET =
  "h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground";

export function ProposalRow({
  icon: Icon,
  name,
  label,
  reason,
  state,
  writtenHref,
  writtenLabel,
  busy,
  cardRef,
  testId,
  notes,
  onAccept,
  onReject,
}: {
  icon: LucideIcon;
  name: string;
  /** What the row names, in mono beside the name. */
  label: string;
  reason: string;
  state: PartState;
  /** Where the written row lives, once it is written. */
  writtenHref: string | undefined;
  writtenLabel: string | undefined;
  busy: boolean;
  /** The retry's focus follows the part here too. */
  cardRef?: (el: HTMLElement | null) => void;
  testId?: string;
  /** What the caller notes about the proposal, under its name. */
  notes?: ReactNode;
  /** Write the proposal — a rejected one after all. */
  onAccept: () => void;
  onReject: () => void;
}) {
  const t = useT();
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      data-testid={testId}
      data-state={state}
      className={cn(
        "mb-[18px] flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        state === "rejected" && "opacity-55",
      )}
    >
      <Icon aria-hidden size={16} className="flex-none text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[14px] text-foreground">{name}</span>
          <span className="font-mono text-[11px] text-faint">{label}</span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground italic">{reason}</p>
        {notes !== undefined && <div className="mt-2.5">{notes}</div>}
      </div>
      {state === "written" ? (
        <p className="flex flex-none items-center gap-2 text-[12.5px] text-muted-foreground">
          <Check aria-hidden size={14} className="flex-none text-success-text" />
          {t("generate.review.partWritten")}
          {writtenHref !== undefined && (
            <Link
              to={writtenHref}
              className="rounded font-mono text-[11px] underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {writtenLabel}
            </Link>
          )}
        </p>
      ) : state === "rejected" ? (
        <div className="flex flex-none items-center gap-2">
          <span className="px-1.5 py-1 text-[12.5px] text-muted-foreground">
            {t("generate.stub.rejected")}
          </span>
          <Button type="button" variant="outline" disabled={busy} onClick={onAccept} className={QUIET}>
            {t("generate.stub.acceptAnyway")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-none gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onAccept} className={ACCEPT}>
            {t("generate.stub.accept")}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={onReject} className={QUIET}>
            {t("generate.stub.reject")}
          </Button>
        </div>
      )}
    </div>
  );
}
