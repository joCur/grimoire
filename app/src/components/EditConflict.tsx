// The one conflict line of every editing surface.
//
// A refused write is not an error the DM has to decode: nothing was written,
// the draft is still on screen, and there are exactly two honest answers. So
// the line states what happened and offers both as controls rather than as
// advice — the surface's own save button stays available, but retrying it
// unchanged would just be refused again.
//
//   reload   drop the draft and continue from what is stored.
//   force    write the same fields on top of what is stored.
//
// Force is optional: the generator's accept step posts to its own endpoint,
// which has no force, so there the line offers reloading only. One component
// for all of them is the point — a second conflict line is how the wording and
// the two answers drift apart.
//
// Quiet and inline, never a toast (the DM is looking right at the thing they
// just tried to save), and `role="alert"` so a screen reader hears it without
// the focus moving.

import { useT } from "@/i18n";

const ACTION =
  "rounded px-0.5 underline decoration-dotted underline-offset-2 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function EditConflict({
  onReload,
  onForce,
  busy = false,
}: {
  onReload: () => void;
  /** Omitted for a write path without force — then there is one action. */
  onForce?: (() => void) | undefined;
  /** True while a write runs: both answers would race it. */
  busy?: boolean;
}) {
  const t = useT();
  return (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-destructive"
    >
      {t("editConflict.line")}
      <button type="button" disabled={busy} onClick={onReload} className={ACTION}>
        {t("editConflict.reload")}
      </button>
      {onForce !== undefined && (
        <button type="button" disabled={busy} onClick={onForce} className={ACTION}>
          {t("editConflict.force")}
        </button>
      )}
    </p>
  );
}
