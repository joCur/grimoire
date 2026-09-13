// `/settings` — the one place instance-wide choices live (issue #69, PO
// feedback on PR #83).
//
// WHY A PAGE, not the campaign switcher's menu. Scheibe 1 put the language
// into that menu: cheap, always on screen, no new chrome. The PO's objection
// is about MEANING, not pixels — the switcher is where you pick a CAMPAIGN,
// and an instance-wide setting hidden in it is both hard to find and wrong by
// category. A settings page is where anyone looks for a setting, and it is the
// surface that can GROW: the campaign knowledge and the glossary (issue #53)
// land here as further sections.
//
// TWO LEVELS, one page, and the structure says which is which:
//
//   * INSTANCE sections apply to the whole installation and are always shown —
//     today exactly one, the UI language.
//   * CAMPAIGN sections apply to the campaign that is currently open and are
//     shown only then, under a heading that names it. Issue #53 adds its
//     sections by appending to `CAMPAIGN_SECTIONS` below; nothing else on this
//     page has to change, and the route stays reachable with no campaign at
//     all (a fresh instance has none).
//
// The page is deliberately QUIET (docs/UI-BRIEF.md): the DM comes here once,
// so nothing here competes with the pool. Section headings follow the pool's
// hairline-under-a-small-heading pattern rather than inventing a card style.
//
// WHICH CAMPAIGN is "currently open" cannot be the PATH — `/settings` is
// campaign-independent on purpose, so the gear works from the cold start too.
// It is the campaign the DM CAME FROM: the gear carries it in `?from=`
// (components/Topbar.tsx). That is the only honest answer — guessing with the
// "/" heuristic instead sent the DM back to a different campaign than the one
// they had open, and would label a future campaign section with the wrong
// name (PO feedback on PR #83).
//
// `?from=` is checked against the campaign LIST rather than trusted: a stale
// bookmark or a renamed campaign must not produce a back row into nothing.
// Only with no origin at all (the gear from "/" on a fresh instance, or a
// hand-typed `/settings`) does the old heuristic stand in — `pickLastCampaign`
// (lib/campaign.ts), the same one "/" uses. No localStorage (quality floor).

import { useQuery } from "@tanstack/react-query";
import { useId, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { fetchCampaigns } from "@/api";
import { GlossarySection, KnowledgeSection } from "@/components/CampaignListSections";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { MobileBackRow } from "@/components/MobileBackRow";
import { useT } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { campaignLabel, settingsCampaign } from "@/lib/campaign";
import { useCampaignVersion } from "@/lib/use-campaign-version";

/**
 * The campaign-scoped sections — filled by issue #53. Kept as a list rather
 * than as inline JSX so adding one is a single entry and the empty case stays
 * honest: with no sections there is no campaign heading either, instead of a
 * heading over nothing.
 *
 * THE ORDER IS AN ARGUMENT. „Kampagnenwissen" comes first because it is the
 * stronger statement — it overrides the source material and is what the DM
 * comes here to fix after a generator run went wrong — and because that is
 * the order the PROMPT puts them in (server/src/llm-provider.ts). The page
 * and the prompt reading the same way is one less thing to hold in your head.
 */
const CAMPAIGN_SECTIONS: ReadonlyArray<{
  key: string;
  heading: MessageKey;
  hint?: MessageKey;
  render: (campaign: string) => ReactNode;
}> = [
  {
    key: "knowledge",
    heading: "settings.knowledge.heading",
    hint: "settings.knowledge.hint",
    render: (campaign) => <KnowledgeSection campaign={campaign} />,
  },
  {
    key: "glossary",
    heading: "settings.glossary.heading",
    hint: "settings.glossary.hint",
    render: (campaign) => <GlossarySection campaign={campaign} />,
  },
];

export function SettingsRoute() {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
  });
  const campaigns = data ?? [];
  const [search] = useSearchParams();
  const campaign = settingsCampaign(search.get("from"), campaigns);
  // The chrome above this page is that campaign's chrome (components/Topbar.tsx,
  // PO feedback on PR #83) — session chip included. It has to stay LIVE here,
  // so this route mounts the version polling CampaignScope mounts for every
  // campaign-scoped view; `/settings` sits outside that layout because it must
  // also work with no campaign at all, and then the hook stays idle ("").
  useCampaignVersion(campaign ?? "");
  const label =
    campaign === undefined
      ? undefined
      : campaignLabel(
          campaigns.find((c) => c.id === campaign),
          campaign,
        );

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

        {/* The campaign half — only with a campaign AND a section to show. */}
        {campaign !== undefined &&
          label !== undefined &&
          CAMPAIGN_SECTIONS.length > 0 && (
            <>
              <h2 className="mt-10 mb-1 text-[13px] font-medium text-soft">
                {t("settings.campaign.heading", { name: label })}
              </h2>
              <p className="mb-5 text-[12.5px] text-muted-foreground">
                {t("settings.campaign.hint")}
              </p>
              {CAMPAIGN_SECTIONS.map((section) => (
                <Section
                  key={section.key}
                  heading={t(section.heading)}
                  hint={section.hint === undefined ? undefined : t(section.hint)}
                >
                  {section.render(campaign)}
                </Section>
              ))}
            </>
          )}
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
