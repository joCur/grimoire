// An npc the campaign already has, as a scene run's row for the changes it
// proposes to it (decisions/generator): the shared proposal row
// (components/ProposalRow.tsx) with the npc's marker, its label, and the link
// to its reading view — the row exists, so the link stands from the start.

import { User } from "lucide-react";
import type { ReactNode } from "react";

import { ProposalRow } from "@/components/ProposalRow";
import type { PartState } from "@/components/ProposalRow";

import { npcHref, npcLabel } from "./npc-links";

export function NpcExtensionRow({
  campaign,
  npc,
  state,
  ...row
}: {
  campaign: string;
  npc: { id: string; name: string };
  state: PartState;
  reason: string;
  busy: boolean;
  cardRef?: (el: HTMLElement | null) => void;
  testId?: string;
  /** The changes, under the name. */
  notes?: ReactNode;
  acceptLabel: string;
  acceptDisabled: boolean;
  onReject: () => void;
  onAccept: () => void;
}) {
  return (
    <ProposalRow
      {...row}
      icon={User}
      name={npc.name}
      label={npcLabel(npc.id)}
      state={state}
      writtenHref={npcHref(campaign, npc.id)}
      writtenLabel={npcLabel(npc.id)}
    />
  );
}
