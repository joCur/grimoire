// The campaign menu's row on the phone's views (design/Grimoire-Mobil): below
// md the topbar is not on screen, so this row carries the same campaign menu
// (components/CampaignMenu.tsx), opening as a sheet — the way to the start of
// the campaign and to every other area. Hidden at md+, where the topbar has
// the menu.

import { CampaignMenu } from "@/components/CampaignMenu";

export function MobileMenuRow({ campaign }: { campaign: string }) {
  return (
    <div className="flex min-w-0 border-b border-border px-3 py-0.5 md:hidden">
      <CampaignMenu campaign={campaign} />
    </div>
  );
}
