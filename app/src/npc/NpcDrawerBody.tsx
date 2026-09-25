// An npc in the live drawer: the same article its reading view shows, read
// through its own query, inside the shared drawer frame.

import { useQuery } from "@tanstack/react-query";

import { DrawerFrame } from "@/components/DrawerFrame";

import { NpcArticle } from "./NpcArticle";
import { npcHref } from "./npc-links";
import { npcQuery } from "./npc-query";

export function NpcDrawerBody({ campaign, id }: { campaign: string; id: string }) {
  const { data, isPending, isError } = useQuery({ ...npcQuery(campaign, id), retry: false });
  return (
    <DrawerFrame
      href={npcHref(campaign, id)}
      shown={id}
      name={data === undefined || data.name === "" ? id : data.name}
      isPending={isPending}
      isError={isError}
    >
      {data !== undefined && <NpcArticle npc={data} />}
    </DrawerFrame>
  );
}
