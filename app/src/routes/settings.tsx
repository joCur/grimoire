// `/settings` — the one place instance-wide choices live.
//
// WHY A PAGE, not the campaign switcher's menu. The switcher is where you
// pick a CAMPAIGN, and an instance-wide setting hidden in it is both hard to
// find and wrong by category. A settings page is where anyone looks for a
// setting.
//
// INSTANCE ONLY — today exactly one section, the UI language.
//
// The campaign's knowledge and glossary are campaign CONTENT, the same kind
// of thing as the NPCs and the locations, and they belong on list pages of
// their own (`/campaigns/:campaign/knowledge`,
// `/campaigns/:campaign/glossary`) — not in a settings page, and not as 30
// inline text fields under one global save button. What is left here is what
// is true of the INSTALLATION, which is also why the route stays reachable
// with no campaign at all (a fresh instance has none).
//
// The page is deliberately QUIET (docs/UI-BRIEF.md): the DM comes here once,
// so nothing here competes with the pool. Section headings follow the pool's
// hairline-under-a-small-heading pattern rather than inventing a card style.
//
// WHICH CAMPAIGN is "currently open" cannot be the PATH — `/settings` is
// campaign-independent on purpose, so the gear works from the cold start too.
// It is the campaign the DM CAME FROM: the gear carries it in `?from=`
// (components/Topbar.tsx). That is the only honest answer — guessing with the
// "/" heuristic instead sends the DM back to a different campaign than the
// one they had open, and would label a future campaign section with the wrong
// name.
//
// `?from=` is checked against the campaign LIST rather than trusted: a stale
// bookmark or a campaign that is gone must not produce a back row into
// nothing. Only with no origin at all (the gear from "/" on a fresh instance,
// or a hand-typed `/settings`) does the heuristic stand in —
// `pickLastCampaign` (lib/campaign.ts), the same one "/" uses. No
// localStorage (quality floor). It is still needed with no campaign section
// on the page: the topbar above and the mobile „‹ Pool" row both have to lead
// back where the DM came from.

import { useQuery } from "@tanstack/react-query";
import { useId, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { fetchCampaigns } from "@/api";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { MobileBackRow } from "@/components/MobileBackRow";
import { useT } from "@/i18n";
import { settingsCampaign } from "@/lib/campaign";
import { useCampaignVersion } from "@/lib/use-campaign-version";

export function SettingsRoute() {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
  });
  const campaigns = data ?? [];
  const [search] = useSearchParams();
  const campaign = settingsCampaign(search.get("from"), campaigns);
  // The chrome above this page is that campaign's chrome
  // (components/Topbar.tsx) — session chip included. It has to stay LIVE here,
  // so this route mounts the version polling CampaignScope mounts for every
  // campaign-scoped view; `/settings` sits outside that layout because it must
  // also work with no campaign at all, and then the hook stays idle ("").
  useCampaignVersion(campaign ?? "");

  return (
    <>
      {/* Below md the topbar (and with it the gear) is not the chrome — the
          same "‹ Pool" row every other campaign view carries is the way back.
          Only with a campaign: on a fresh instance there is no pool to go
          back to. */}
      {campaign !== undefined && <MobileBackRow campaign={campaign} />}
      <div className="mx-auto max-w-[640px] px-5 pt-8 pb-24 md:px-7 md:pt-10">
        <h1 className="mb-1.5 font-serif text-[26px] leading-[1.25] font-semibold text-foreground">
          {t("settings.title")}
        </h1>
        <p className="mb-8 max-w-[58ch] text-[13.5px] leading-[1.6] text-body-secondary">
          {t("settings.lead")}
        </p>

        <LanguageSection />
      </div>
    </>
  );
}

/**
 * The instance language. Its own component only because the radio group has to
 * be labelled BY the section heading (there is exactly one word for both, and
 * announcing „Sprache, Sprache" is what happens otherwise).
 */
function LanguageSection() {
  const t = useT();
  const headingId = useId();
  return (
    <Section
      heading={t("settings.language.heading")}
      headingId={headingId}
      hint={t("settings.language.hint")}
    >
      <LanguageSwitch labelledBy={headingId} />
    </Section>
  );
}

/**
 * One section: a small heading over a hairline, an optional quiet hint, the
 * control below. The pool's grouping pattern, so the page reads like the rest
 * of the app rather than like a preferences dialog.
 */
function Section({
  heading,
  headingId,
  hint,
  children,
}: {
  heading: string;
  /** Set when a control inside is labelled by this heading (see above). */
  headingId?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2
        id={headingId}
        className="border-b border-border pb-2 text-[13px] font-medium text-soft"
      >
        {heading}
      </h2>
      {hint !== undefined && (
        <p className="mt-2.5 max-w-[58ch] text-[12.5px] leading-[1.55] text-muted-foreground">
          {hint}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}
