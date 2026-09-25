// What the hover preview of a `[[slug]]` reference to an npc says: the kind
// and the npc's status, then the rows of the compact card. The name is known
// before anything loads — the tree that resolved the reference has it — so
// the card opens labelled. The rest comes with the npc's own query (the key
// its cards and drawer share); while it loads, static bars stand in, and if
// it fails the card simply keeps kind and name.

import type { NpcStatus } from "@grimoire/shared/types";
import { useQuery } from "@tanstack/react-query";
import { Skull } from "lucide-react";

import {
  CompactHead,
  CompactName,
  CompactPlaceholder,
  type CompactStatus,
} from "@/components/Compact";
import { useT, type Translate } from "@/i18n";

import { NpcCompact } from "./NpcCompact";
import { npcExcerpt } from "./npc-excerpt";
import { npcQuery } from "./npc-query";
import { npcStatusLabel } from "./npc-status";

/** How loud a status is: alive is good news, dead the one warning. */
function npcStatusLine(status: NpcStatus, t: Translate): CompactStatus {
  const label = npcStatusLabel(status, t);
  if (status === "alive") return { label, tone: "good" };
  if (status === "dead") return { label, tone: "warning", icon: Skull };
  return { label, tone: "quiet" };
}

export function NpcPreview({
  campaign,
  id,
  name,
  nameOf,
}: {
  campaign: string;
  id: string;
  name: string;
  /** Display name of a slug — references inside the motivation read as names. */
  nameOf: (slug: string) => string | undefined;
}) {
  const t = useT();
  const npc = useQuery({
    ...npcQuery(campaign, id),
    retry: false,
    retryOnMount: false,
    staleTime: Infinity,
  });
  const excerpt = npc.data === undefined ? undefined : npcExcerpt(npc.data, nameOf);
  return (
    <>
      <CompactHead
        kind={t("kind.npc")}
        status={excerpt === undefined ? undefined : npcStatusLine(excerpt.status, t)}
      />
      {excerpt === undefined ? (
        <>
          <CompactName name={name} />
          {npc.isPending && (
            <CompactPlaceholder widths={["w-[60%]", "w-[95%]", "w-[85%]"]} chips={3} />
          )}
        </>
      ) : (
        <NpcCompact name={name} excerpt={excerpt} clamp />
      )}
    </>
  );
}
