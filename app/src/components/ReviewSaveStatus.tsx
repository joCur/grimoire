// The quiet „Gespeichert" line of a review (issue #97).
//
// Shared by the generator review and the „Mit KI ergänzen" dialog, because
// both write their state to the same place and the DM must read the same
// three words in both.

import { useT } from "@/i18n";
import type { ReviewSaveStatus as ReviewSaveStatusValue } from "@/lib/use-job-review";
import { cn } from "@/lib/utils";

/**
 * The quiet save line of the review (issue #97): „Gespeichert" /
 * „Speichern …" / the conflict or error sentence. A live region, because
 * it is the only feedback that the DM's decision arrived — and silent while
 * nothing has happened yet, so an untouched review carries no chrome.
 */
export function ReviewSaveStatus({ status }: { status: ReviewSaveStatusValue }) {
  const t = useT();
  if (status === "idle") return null;
  return (
    <span
      aria-live="polite"
      className={cn(
        "text-[12px]",
        status === "conflict" || status === "error" ? "text-destructive" : "text-faint",
      )}
    >
      {t(
        status === "saving"
          ? "generate.review.saving"
          : status === "saved"
            ? "generate.review.saved"
            : status === "conflict"
              ? "generate.review.saveConflict"
              : "generate.review.saveFailed",
      )}
    </span>
  );
}
