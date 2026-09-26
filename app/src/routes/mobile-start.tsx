// The mobile start surface — rendered by the chapter overview route below
// the md breakpoint per design/Grimoire-Mobil.dc.html: wordmark row, tappable
// search field (opens the ⌘K palette, touch-first), the idea capture card
// (idea/IdeaCapture.tsx) and the lookup rows into the mobile
// list pages. The prototype's recently-viewed section is deliberately
// left out: recents would need server-side persistence (no localStorage —
// the server is the truth) and there is no recents endpoint yet.

import { useQuery } from "@tanstack/react-query";
import { BookA, Bookmark, ChevronRight, Lightbulb, MapPin, Search, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { fetchTree } from "@/api";
import { CommandPalette } from "@/components/CommandPalette";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { IconLogo } from "@/icons";
import { useT, type MessageKey } from "@/i18n";
import { IdeaCapture } from "@/idea/IdeaCapture";
import { locationsHref } from "@/location/location-links";
import { npcsHref } from "@/npc/npc-links";
import { useCampaignMeta } from "@/lib/use-campaign";

export function MobileStart({ campaign }: { campaign: string }) {
  const t = useT();
  const [searchOpen, setSearchOpen] = useState(false);
  const { data: tree } = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: campaign !== "",
  });
  // Display name from campaign, id as the fallback.
  const { label: campaignName } = useCampaignMeta(campaign);
  const sceneCount = tree?.chapters.reduce((n, ch) => n + ch.scenes.length, 0);
  // The row's count, or nothing while the tree is still loading. The plural
  // form comes from the catalog (ICU), not from concatenation here.
  const countLabel = (count: number | undefined, key: MessageKey) =>
    count === undefined ? undefined : t(key, { count });

  return (
    <div className="mx-auto flex max-w-[560px] flex-col px-5 pt-5 pb-16">
      <div className="mb-5 flex items-center gap-2.5">
        <IconLogo size={20} className="text-primary" />
        <span className="font-serif text-[22px] leading-[1.2] font-semibold text-foreground">
          {t("topbar.brand")}
        </span>
        <span className="min-w-0 truncate text-[13px] text-muted-foreground">
          {t("campaign.switcher.current", { name: campaignName })}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="mb-3.5 flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-input bg-card px-4 py-3 text-left text-[15px] text-muted-foreground"
      >
        <Search aria-hidden size={17} className="flex-none" />
        {t("mobileStart.search")}
      </button>
      {/* Second palette instance next to the topbar's — without the global
          ⌘K listener, so the shortcut only ever toggles one of them. */}
      <CommandPalette
        campaign={campaign}
        open={searchOpen}
        onOpenChange={setSearchOpen}
        hotkey={false}
      />

      <IdeaCapture campaign={campaign} />

      <nav aria-label={t("lookup.heading")} className="mt-8">
        <p className="mb-1 text-[11px] font-semibold tracking-[.08em] uppercase text-muted-foreground">
          {t("lookup.heading")}
        </p>
        <BrowseRow
          to={`/campaigns/${campaign}/scenes`}
          icon={Bookmark}
          label={t("browse.title.scenes")}
          meta={countLabel(sceneCount, "mobileStart.count.scenes")}
        />
        <BrowseRow
          to={npcsHref(campaign)}
          icon={User}
          label={t("browse.title.npcs")}
          meta={countLabel(tree?.npcs.length, "mobileStart.count.npcs")}
        />
        <BrowseRow
          to={locationsHref(campaign)}
          icon={MapPin}
          label={t("browse.title.locations")}
          meta={countLabel(tree?.locations.length, "mobileStart.count.locations")}
        />
        {/* The two pages the DM MAINTAINS. They sit after the three read-only lists — content you read before
            content you edit (lib/lookup.ts) — and carry no count: a glossary
            of 12 terms is not a number anyone acts on, and the counts above
            come free with the tree query these two do not share. */}
        <BrowseRow to={`/campaigns/${campaign}/glossary`} icon={BookA} label={t("glossary.title")} />
        <BrowseRow to={`/campaigns/${campaign}/knowledge`} icon={Lightbulb} label={t("knowledge.title")} />
      </nav>

      {/* The language switch. This surface REPLACES the topbar below `md`, so
          the campaign switcher's menu — where the switch otherwise lives — is
          not on screen at all, and a phone would have no way to change the
          language. It goes at the very end, after the reference-page rows, in
          the smallest fitting place rather than in a settings screen of its
          own that this surface has no room for. */}
      <footer className="mt-8 border-t border-divider pt-3.5">
        <LanguageSwitch />
      </footer>
    </div>
  );
}

function BrowseRow({
  to,
  icon: Icon,
  label,
  meta,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  /** A count when the surface has one for free; a plain row otherwise. */
  meta?: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[52px] items-center gap-3 rounded-md border-b border-divider px-1 hover:bg-card"
    >
      <Icon aria-hidden size={16} className="flex-none text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{label}</span>
      {meta !== undefined && (
        <span className="flex-none text-[12.5px] text-muted-foreground">{meta}</span>
      )}
      <ChevronRight aria-hidden size={15} className="flex-none text-faint" />
    </Link>
  );
}
