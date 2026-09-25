// The npcs of a campaign as a list page's rows, read from their own resource
// list (already sorted by name): each row its name, its role, and a link to
// its reading view.

import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";

import { ListRow } from "@/components/ListRow";
import { useT } from "@/i18n";

import { npcHref } from "./npc-links";
import { npcsQuery } from "./npc-query";

export function NpcList({ campaign }: { campaign: string }) {
  const t = useT();
  const { data: npcs } = useQuery(npcsQuery(campaign));
  if (npcs === undefined) return null;
  if (npcs.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">{t("browse.empty.npcs")}</p>;
  }
  return (
    <>
      {npcs.map((npc) => (
        <ListRow
          key={npc.id}
          to={npcHref(campaign, npc.id)}
          icon={User}
          title={npc.name === "" ? npc.id : npc.name}
          meta={npc.role}
        />
      ))}
    </>
  );
}
