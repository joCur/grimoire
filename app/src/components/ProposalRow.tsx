// One proposal row of a generator review: marker, name, mono label, italic
// reason, and the decision — take, reject, write it on its own, or undo.
// What the row proposes is the caller's; the row knows only its state.

import type { GenerateReviewDecision } from "@grimoire/shared/types";
import { Check, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import type { PartState } from "@/lib/generate";
import { cn } from "@/lib/utils";

export function ProposalRow({
  icon: Icon,
  name,
  label,
  reason,
  decision,
  state,
  writtenHref,
  writtenLabel,
  busy,
  cardRef,
  onDecide,
  onAccept,
}: {
  icon: LucideIcon;
  name: string;
  /** What the row names, in mono beside the name. */
  label: string;
  reason: string;
  decision: GenerateReviewDecision | undefined;
  state: PartState;
  /** Where the written row lives, once it is written. */
  writtenHref: string | undefined;
  writtenLabel: string | undefined;
  busy: boolean;
  /** The retry's focus follows the part here too. */
  cardRef?: (el: HTMLElement | null) => void;
  onDecide: (decision: GenerateReviewDecision | undefined) => void;
  onAccept: () => void;
}) {
  const t = useT();
  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      className={cn(
        "mb-[18px] flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        (decision === "rejected" || state === "rejected") && "opacity-55",
      )}
    >
      <Icon aria-hidden size={16} className="flex-none text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[14px] text-foreground">{name}</span>
          <span className="font-mono text-[11px] text-faint">{label}</span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground italic">{reason}</p>
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
      ) : decision === undefined ? (
        <div className="flex flex-none gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecide("accepted")}
            className="h-auto rounded-md border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-3 py-1.5 text-[12.5px] font-normal text-primary-hover hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] hover:text-primary-hover"
          >
            {t("generate.stub.accept")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onDecide("rejected")}
            className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
          >
            {t("generate.stub.reject")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-none items-center gap-2">
          {/* An ACCEPTED proposal can be written on its own — the
              rest of the run stays reviewable. */}
          {decision === "accepted" && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onAccept}
              className="h-auto border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground"
            >
              {t("generate.review.acceptOne")}
            </Button>
          )}
          {/* The decided row stays a control so a wrong decision is
              reversible (the prototype shows a label; a click puts the
              buttons back). */}
          <button
            type="button"
            onClick={() => onDecide(undefined)}
            title={t("generate.stub.undo")}
            className={cn(
              "flex-none rounded-md px-1.5 py-1 text-[12.5px]",
              decision === "accepted" ? "text-primary-hover" : "text-muted-foreground",
            )}
          >
            {t(decision === "accepted" ? "generate.stub.accepted" : "generate.stub.rejected")}
          </button>
        </div>
      )}
    </div>
  );
}
