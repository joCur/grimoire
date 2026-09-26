// An npc a generator run proposes, as its row in the run's review: the shared
// proposal row (components/ProposalRow.tsx) with the npc's marker, its label,
// and — once written — the link to its reading view.

import type { NpcProposal } from "@grimoire/shared/types";
import type { GenerateReviewDecision } from "@grimoire/shared/generator-job";
import { User } from "lucide-react";

import { ProposalRow } from "@/components/ProposalRow";
import type { PartState } from "@/components/ProposalRow";

import { npcHref, npcLabel } from "./npc-links";

export function NpcProposalRow({
  campaign,
  npc,
  state,
  ...row
}: {
  campaign: string;
  npc: NpcProposal;
  state: PartState;
  reason: string;
  decision: GenerateReviewDecision | undefined;
  busy: boolean;
  cardRef?: (el: HTMLElement | null) => void;
  onDecide: (decision: GenerateReviewDecision | undefined) => void;
  onAccept: () => void;
}) {
  const written = state === "written";
  return (
    <ProposalRow
      {...row}
      icon={User}
      name={npc.name}
      label={npcLabel(npc.id)}
      state={state}
      writtenHref={written ? npcHref(campaign, npc.id) : undefined}
      writtenLabel={written ? npcLabel(npc.id) : undefined}
    />
  );
}
