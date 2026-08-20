// Reload banner for a stale bundle (issue #24).
//
// Sits in the app shell ABOVE the topbar, so it shows on every view — desktop
// chrome and the mobile surfaces alike, where the topbar itself is hidden
// (issue #11). Slim, quiet, brass-tinted; there is no dismiss control, because
// a dismissed banner is exactly the state the incident produced: a tab running
// code the server no longer speaks to. Reloading is the user's call though —
// nothing here reloads on its own (open live-log input beats freshness).

import { RotateCw } from "lucide-react";

import { useStaleBuild } from "@/lib/build-id";

export function UpdateBanner() {
  const stale = useStaleBuild();
  if (!stale) return null;

  return (
    <div
      role="status"
      className="flex flex-none flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] px-4 py-2 text-[12.5px] text-body"
    >
      <span className="text-center">Neue Version verfügbar — neu laden</span>
      <button
        type="button"
        onClick={() => location.reload()}
        className="inline-flex flex-none items-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1 text-[12.5px] font-medium text-soft transition-colors hover:border-primary hover:text-primary-hover"
      >
        <RotateCw aria-hidden size={13} />
        Neu laden
      </button>
    </div>
  );
}
