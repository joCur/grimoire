// A scene the campaign already has, as a chapter check's row for the fixes it
// proposes to it (decisions/generator): the shared proposal row
// (components/ProposalRow.tsx) with the scene's marker, its label, and the
// link to its reading view — the row exists, so the link stands from the
// start.

import { Bookmark } from "lucide-react";
import type { ReactNode } from "react";

import { ProposalRow } from "@/components/ProposalRow";
import type { PartState } from "@/components/ProposalRow";

import { sceneHref, sceneLabel } from "./scene-links";

export function SceneExtensionRow({
  campaign,
  scene,
  state,
  ...row
}: {
  campaign: string;
  scene: { id: string; title: string };
  state: PartState;
  reason: string;
  busy: boolean;
  cardRef?: (el: HTMLElement | null) => void;
  testId?: string;
  /** The changes, under the title. */
  notes?: ReactNode;
  acceptLabel: string;
  acceptDisabled: boolean;
  onReject: () => void;
  onAccept: () => void;
}) {
  return (
    <ProposalRow
      {...row}
      icon={Bookmark}
      name={scene.title === "" ? scene.id : scene.title}
      label={sceneLabel(scene.id)}
      // A fix the DM dropped reads like a rejected proposal: it can be
      // taken after all.
      state={state === "dropped" ? "rejected" : state}
      writtenHref={sceneHref(campaign, scene.id)}
      writtenLabel={sceneLabel(scene.id)}
    />
  );
}
