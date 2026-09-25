// The compact short form of a location — the rows of its live aside card, and
// the same rows inside the hover preview of a `[[slug]]` reference. Two
// surfaces, one rendering: the preview is this card seen from the text.
//
// `clamp` is the preview's: there the atmosphere is a glimpse, never the
// whole paragraph, so it stops after four lines with an ellipsis. The aside
// card shows it in full.

import { CompactName } from "@/components/Compact";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import type { LocationExcerpt } from "./location-excerpt";

export function LocationCompact({
  name,
  excerpt,
  clamp = false,
}: {
  name: string;
  excerpt: LocationExcerpt;
  clamp?: boolean;
}) {
  const t = useT();
  const { mood, page } = excerpt;
  return (
    <>
      <CompactName name={name} />
      {mood !== undefined && (
        <p
          className={cn(
            "mt-1.5 text-[12.5px] leading-[1.5] text-body-secondary",
            clamp && "line-clamp-4",
          )}
        >
          {mood}
        </p>
      )}
      {mood === undefined && page !== undefined && (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          {t("locationCard.roll20", { value: page })}
        </p>
      )}
    </>
  );
}
