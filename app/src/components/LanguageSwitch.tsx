// The language switch as a STANDALONE control (issue #69 follow-up).
//
// Scheibe 1 put the switch into the campaign switcher's menu, which is the
// right home for it — it costs the topbar no pixel and that menu is where the
// instance is configured anyway. It has two blind spots, and both are the
// moments where the switch matters most:
//
//   1. THE COLD START has no topbar content at all: a fresh instance has no
//      campaign, so there is no switcher and therefore no way to change the
//      language of the very first screen a new installation shows.
//   2. THE MOBILE START surface replaces the topbar below `md`, so the phone
//      had no reachable switch either.
//
// The menu version stays where it is — it is the right control on every
// campaign-scoped desktop route. This component is the same switch for the two
// surfaces that have no menu, mounted in a quiet footer. Same SEMANTICS as the
// menu version (a radio group with exactly one current value, not two
// commands), but with native `<input type="radio">`: outside a Radix menu that
// is what gives keyboard arrow navigation, the focus ring and the grouping for
// free. Both read and write the same server setting through `useI18n`, so
// there is no second source of truth to keep in sync.
//
// The language NAMES stay endonyms („Deutsch", "English"): the one kind of
// copy that is never translated, because it is read by someone who does not
// yet speak the language the UI is in.

import { useId } from "react";

import { LOCALES, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * A quiet row: the word „Sprache" and the two language names. Meant for the
 * FOOTER of a surface that has no campaign switcher — it must not read like a
 * setting the DM has to deal with before starting.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, locale, setLocale, isSwitching } = useI18n();
  // One radio NAME per instance: the cold start and the mobile surface never
  // render both at once, but two groups sharing a name would fight.
  const group = useId();
  const headingId = useId();

  return (
    <div
      role="radiogroup"
      aria-labelledby={headingId}
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}
    >
      <span id={headingId} className="text-[11.5px] text-muted-foreground">
        {t("language.heading")}
      </span>
      {LOCALES.map((value) => (
        <label
          key={value}
          className={cn(
            "flex min-h-8 cursor-pointer items-center gap-1.5 text-[12.5px]",
            value === locale ? "text-foreground" : "text-body-secondary hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name={group}
            value={value}
            checked={value === locale}
            disabled={isSwitching}
            // A change event only ever fires for the row being selected, so
            // there is nothing to guard against here.
            onChange={() => setLocale(value)}
            className="size-3.5 accent-primary"
          />
          {t(value === "de" ? "language.de" : "language.en")}
        </label>
      ))}
    </div>
  );
}
