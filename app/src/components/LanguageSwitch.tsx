// The language switch as a STANDALONE control (issue #69).
//
// Scheibe 1 put the switch into the campaign switcher's MENU. The PO's
// rework of PR #83 took it out of there: that menu is where you pick a
// CAMPAIGN, and an instance-wide setting hidden inside it is both hard to find
// and wrong by category. The switch's home is now the settings page
// (routes/settings.tsx), which the topbar's gear opens from everywhere.
//
// This component IS that switch, and it is mounted on three surfaces, all of
// which want the same control:
//
//   1. THE SETTINGS PAGE — its „Sprache" section.
//   2. THE COLD START, which has no topbar content of its own beyond the gear:
//      a fresh instance has no campaign, and the very first screen of a new
//      installation should not require a detour to change its language.
//   3. THE MOBILE START surface, which REPLACES the topbar below `md` — so the
//      gear is not on screen there at all. The switch stays inline in its
//      footer rather than becoming a link to /settings: the mobile surface is
//      for looking things up and throwing notes in (docs/UI-BRIEF.md), and the
//      reading language is the one instance setting a phone plausibly needs —
//      while the page's other sections (campaign knowledge, glossary, issue
//      #53) are prep work the mobile brief deliberately excludes. One footer
//      row costs nothing; a link would send the DM into a surface built for a
//      desk.
//
// SEMANTICS: a radio group with exactly one current value, not two commands —
// with native `<input type="radio">`, which is what gives keyboard arrow
// navigation, the focus ring and the grouping for free. It reads and writes the
// same server setting through `useI18n`, so there is no second source of truth.
//
// The language NAMES stay endonyms („Deutsch", "English"): the one kind of
// copy that is never translated, because it is read by someone who does not
// yet speak the language the UI is in.

import { useId } from "react";

import { LOCALES, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * A quiet row: the word „Sprache" and the two language names. Quiet enough for
 * a FOOTER — on the cold start and the mobile surface it must not read like a
 * setting the DM has to deal with before starting.
 */
export function LanguageSwitch({
  className,
  labelledBy,
}: {
  className?: string;
  /**
   * Id of a heading that ALREADY names this group — the settings page's
   * „Sprache" section heading. Passed there so the group is not announced
   * („Sprache") under a heading that says the same word; the cold start and
   * the mobile footer have no such heading and get the inline label below.
   */
  labelledBy?: string;
}) {
  const { t, locale, setLocale, isSwitching } = useI18n();
  // One radio NAME per instance: the cold start and the mobile surface never
  // render both at once, but two groups sharing a name would fight.
  const group = useId();
  const ownHeadingId = useId();
  const headingId = labelledBy ?? ownHeadingId;

  return (
    <div
      role="radiogroup"
      aria-labelledby={headingId}
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}
    >
      {labelledBy === undefined && (
        <span id={headingId} className="text-[11.5px] text-muted-foreground">
          {t("language.heading")}
        </span>
      )}
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
