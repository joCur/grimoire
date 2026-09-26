// The locations of a campaign as a list page's rows, read from their own
// resource list (already sorted by name): each row its name, the chapter it
// belongs to, and a link to its reading view.

import type { CampaignTree } from "@grimoire/shared/campaign-tree";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";

import { ListRow } from "@/components/ListRow";
import { useT } from "@/i18n";

import { locationHref } from "./location-links";
import { locationsQuery } from "./location-query";

export function LocationList({ campaign, tree }: { campaign: string; tree: CampaignTree }) {
  const t = useT();
  const { data: locations } = useQuery(locationsQuery(campaign));
  if (locations === undefined) return null;
  if (locations.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">{t("browse.empty.locations")}</p>;
  }
  return (
    <>
      {locations.map((location) => (
        <ListRow
          key={location.id}
          to={locationHref(campaign, location.id)}
          icon={MapPin}
          title={location.name}
          meta={tree.chapters.find((ch) => ch.id === location.chapter)?.title}
        />
      ))}
    </>
  );
}
