// One part of a pipelined run while it has no draft to show: waiting, being
// written, or failed — with the retry of a failed part.

import type { GeneratorJobPart } from "@grimoire/shared/generator-job";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * One part of a pipelined run that has no draft to show yet:
 * waiting, being written, or failed.
 *
 * It is deliberately the SAME footprint as a draft card, in the same place in
 * the list — the review is laid out in outline order, and a part that moves
 * from being written to a finished scene must not make everything below
 * it jump. Quieter than a draft: a hairline card, the title the outline gave
 * the part, and one line saying what is going on.
 *
 * A failed part is the only one with a button. WHY it failed is said in this
 * language (the raw server sentence about failed mechanical validation is
 * English and is the DM's only headline otherwise), with
 * the mechanical error list unchanged below it and the raw reply behind the
 * same disclosure the whole-run failure uses — the DM decides from it whether
 * to retry or to drop the run.
 *
 * `mismatch` is the third failure there is: a part the server calls `done`
 * whose draft is not in the result.
 */
export function GeneratorJobPartCard({
  part,
  busy,
  error,
  mismatch = false,
  cardRef,
  onRetry,
}: {
  part: GeneratorJobPart;
  busy: boolean;
  /** This part's own retry error, already translated (never a global one). */
  error?: string;
  mismatch?: boolean;
  cardRef?: (el: HTMLElement | null) => void;
  onRetry: () => void;
}) {
  const t = useT();
  const failed = part.status === "failed" || mismatch;
  const validationErrors = part.validationErrors ?? [];
  return (
    <section
      ref={cardRef}
      // Focusable only programmatically: the retry action unmounts its own
      // button, so the retry hands the focus to the card instead of letting
      // it fall to `body`. Not a live region — the review
      // has exactly one, on its progress line.
      tabIndex={-1}
      className={cn(
        "mb-3 rounded-lg border bg-card px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        failed ? "border-destructive/40" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-[16px] leading-[1.3] font-semibold text-foreground">
          {part.title}
        </h2>
        <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          {part.status === "running" && (
            <>
              {/* Motion is optional — a static ring stands in for it. */}
              <span
                aria-hidden
                className="size-[13px] flex-none animate-spin rounded-full border-2 border-input border-t-primary motion-reduce:hidden"
              />
              <span
                aria-hidden
                className="hidden size-[13px] flex-none rounded-full border-2 border-primary motion-reduce:block"
              />
            </>
          )}
          {t(
            failed
              ? "generate.pipeline.partFailed"
              : part.status === "running"
                ? "generate.pipeline.partRunning"
                : "generate.pipeline.partPending",
          )}
        </span>
      </div>
      {failed && (
        <>
          {/* The headline: this language's sentence when the failure IS the
              form check (its server message is English), the server's own
              text otherwise — a restart, a provider outage and a 500 all say
              something the DM needs verbatim. */}
          {mismatch ? (
            <p className="mt-2 text-[13px] leading-[1.55] text-body-secondary">
              {t("generate.pipeline.partMissing")}
            </p>
          ) : validationErrors.length > 0 ? (
            <p className="mt-2 text-[13px] leading-[1.55] text-body-secondary">
              {t("generate.pipeline.partInvalid")}
            </p>
          ) : (
            part.error !== undefined && (
              <p className="mt-2 text-[13px] leading-[1.55] text-body-secondary">{part.error}</p>
            )
          )}
          {validationErrors.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {validationErrors.map((message) => (
                <li
                  key={message}
                  className="font-mono text-[11.5px] leading-[1.5] text-body-secondary"
                >
                  {message}
                </li>
              ))}
            </ul>
          )}
          {/* WHAT came back — the same disclosure the whole-run failure uses. The part carries its own last raw reply. */}
          {part.rawReply !== undefined && part.rawReply !== "" && (
            <details className="mt-2.5">
              <summary className="cursor-pointer text-[12.5px] text-body-secondary hover:text-foreground">
                {t("generate.error.rawReply")}
              </summary>
              <pre className="mt-2 max-h-[260px] overflow-auto rounded-md border border-input bg-background px-3 py-2.5 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap text-body-secondary">
                {part.rawReply}
              </pre>
            </details>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onRetry}
            className="mt-3 h-auto gap-2 border-input bg-transparent px-3.5 py-2 text-[13px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground [&_svg]:size-[14px]"
          >
            <RotateCcw aria-hidden />
            {t("generate.pipeline.retry")}
          </Button>
          {/* The retry's own failure, next to the button that caused it. */}
          {error !== undefined && (
            <p className="mt-2 text-[13px] text-destructive">{error}</p>
          )}
        </>
      )}
    </section>
  );
}
