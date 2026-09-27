// The pieces a review of a proposed change is built from, whatever the change
// is about: a word diff of a text, the badge that names what kind of change a
// row is, and the take ⇄ keep pair that decides it. The augment review and
// the patch round of a generator run use them alike; neither knows an entity.

import { Button } from "@/components/ui/button";
import type { Translate } from "@/i18n";
import type { BlockChangeKind, DiffToken, FieldProposal } from "@/lib/augment";
import { cn } from "@/lib/utils";

/**
 * Word-level diff: only what moved is highlighted, the rest is neutral.
 *
 * Colour is never the only cue — a removed run is struck through and an added
 * one is announced, so "added"/"removed" reaches a reader who sees no
 * highlight at all.
 */
export function WordDiffText({ tokens, t }: { tokens: DiffToken[]; t: Translate }) {
  return (
    <p className="font-serif text-[13.5px] leading-[1.6] whitespace-pre-wrap text-body-secondary">
      {tokens.map((token, index) => (
        <span
          key={index}
          className={cn(
            token.kind === "removed" &&
              "bg-destructive/15 text-muted-foreground line-through decoration-1",
            token.kind === "added" && "bg-primary/15 text-foreground",
          )}
        >
          {token.kind !== "same" && (
            <span className="sr-only">
              {t(token.kind === "added" ? "augment.diff.added" : "augment.diff.removed")}{" "}
            </span>
          )}
          {token.text}
        </span>
      ))}
    </p>
  );
}

/** What kind of change a row is: new, changed or dropped. */
export function StateBadge({
  state,
  t,
}: {
  state: FieldProposal["state"] | Exclude<BlockChangeKind, "same">;
  t: Translate;
}) {
  const key =
    state === "new" || state === "added"
      ? "augment.state.new"
      : state === "removed"
        ? "augment.state.removed"
        : "augment.state.changed";
  return (
    <span className="rounded-full border border-input px-2 py-px text-[11px] text-muted-foreground">
      {t(key)}
    </span>
  );
}

/**
 * Take ⇄ keep — two real buttons with aria-pressed, no select. Without
 * `accepted` neither is pressed: the change is still undecided.
 *
 * The VISIBLE word stays the screen's vocabulary, but the accessible name
 * carries the unit it decides on: a review of a dozen decisions plus the
 * footer button otherwise offers a dozen identically named controls to a
 * screen reader, and the footer's is the one that writes.
 */
export function DecisionToggle({
  accepted,
  onDecide,
  unit,
  disabled = false,
  t,
}: {
  accepted?: boolean;
  onDecide: (take: boolean) => void;
  unit: string;
  disabled?: boolean;
  t: Translate;
}) {
  return (
    <div
      role="group"
      aria-label={t("augment.decision.aria")}
      className="ml-auto flex items-center gap-px rounded-md border border-input p-px"
    >
      {([true, false] as const).map((take) => (
        <Button
          key={String(take)}
          type="button"
          variant="ghost"
          aria-pressed={accepted === take}
          aria-label={t(take ? "augment.decision.takeUnit" : "augment.decision.keepUnit", {
            label: unit,
          })}
          data-testid={take ? "decision-take" : "decision-keep"}
          disabled={disabled}
          onClick={() => onDecide(take)}
          className={cn(
            "h-auto rounded-[5px] px-2 py-[3px] text-[11.5px] font-normal",
            accepted === take
              ? "bg-secondary text-foreground hover:bg-secondary"
              : "text-body-secondary hover:bg-transparent hover:text-foreground",
          )}
        >
          {t(take ? "augment.decision.take" : "augment.decision.keep")}
        </Button>
      ))}
    </div>
  );
}
