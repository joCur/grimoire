// One proposal row of a generator review: marker, name, mono label, italic
// reason, and the decision — accept (which writes it), reject, or accept a
// rejected one after all. What the row proposes is the caller's; the row
// knows only its state, and shows what the caller notes about it under its
// name.
//
// The decision stands BELOW the content, behind a rule, like the footer of a
// proposed scene's card: what the caller notes can carry controls of its own
// (a patch round takes or discards single changes), and the row's decision
// must never read as one of them.

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
  acceptLabel,
  acceptDisabled = false,
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
  /** What the accept action says, when the row writes something else than a new proposal. */
  acceptLabel?: string;
  /** Nothing to write yet: the accept action is off. */
  acceptDisabled?: boolean;
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
        "mb-[18px] rounded-lg border border-border bg-card px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        state === "rejected" && "opacity-55",
      )}
    >
      <div className="flex items-start gap-3">
        <Icon aria-hidden size={16} className="mt-[3px] flex-none text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[14px] text-foreground">{name}</span>
            <span className="font-mono text-[11px] break-all text-faint">{label}</span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground italic">{reason}</p>
          {notes !== undefined && <div className="mt-2.5 empty:hidden">{notes}</div>}
        </div>
      </div>
      <div
        data-testid="proposal-row-decision"
        className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
      >
        {state === "written" ? (
          <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
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
          <>
            <span className="py-1 pr-1.5 text-[12.5px] text-muted-foreground">
              {t("generate.stub.rejected")}
            </span>
            <Button
              type="button"
              variant="outline"
              data-testid="proposal-row-accept"
              disabled={busy || acceptDisabled}
              onClick={onAccept}
              className={QUIET}
            >
              {t("generate.stub.acceptAnyway")}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              data-testid="proposal-row-accept"
              disabled={busy || acceptDisabled}
              onClick={onAccept}
              className={ACCEPT}
            >
              {acceptLabel ?? t("generate.stub.accept")}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="proposal-row-reject"
              disabled={busy}
              onClick={onReject}
              className={QUIET}
            >
              {t("generate.stub.reject")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
