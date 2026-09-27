// The phone's start of a campaign — the chapter overview route below the md
// breakpoint per design/Grimoire-Mobil.dc.html: wordmark row with the
// campaign menu, tappable search field (opens the ⌘K palette, touch-first)
// and the idea capture card (idea/IdeaCapture.tsx) above the chapter
// overview itself, and the language switch at the very end. The areas of the
// campaign are in the campaign menu (lib/areas.ts), as on the desktop. The
// prototype's recently-viewed section is deliberately left out: recents would
// need server-side persistence (no localStorage — the server is the truth)
// and there is no recents endpoint yet.

import { Search } from "lucide-react";
import { useState } from "react";

import { CampaignMenu } from "@/components/CampaignMenu";
import { CommandPalette } from "@/components/CommandPalette";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { IconLogo } from "@/icons";
import { useT } from "@/i18n";
import { IdeaCapture } from "@/idea/IdeaCapture";

/** What the phone shows above the chapter overview. Hidden from md up. */
export function MobileStartTop({ campaign }: { campaign: string }) {
  const t = useT();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-[560px] flex-col px-5 pt-3 md:hidden">
      {/* Below md the topbar is not on screen, so the campaign menu sits
          here, next to the wordmark: the same menu, as a sheet. */}
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <IconLogo size={20} className="flex-none text-primary" />
        <span className="flex-none font-serif text-[22px] leading-[1.2] font-semibold text-foreground">
          {t("topbar.brand")}
        </span>
        <CampaignMenu campaign={campaign} />
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
    </div>
  );
}

/**
 * The language switch, at the very end of the phone's start. The topbar —
 * whose gear leads to the settings, where the switch otherwise lives — is not
 * on screen below md, and a phone would have no way to change the language.
 */
export function MobileStartBottom() {
  return (
    <footer className="mx-auto max-w-[560px] px-5 pb-16 md:hidden">
      <div className="border-t border-divider pt-3.5">
        <LanguageSwitch />
      </div>
    </footer>
  );
}
