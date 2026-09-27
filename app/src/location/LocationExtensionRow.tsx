// A location the campaign already has, as a scene run's row for the changes it
// proposes to it (decisions/generator): the shared proposal row
// (components/ProposalRow.tsx) with the location's marker, its label, and the link
// to its reading view — the row exists, so the link stands from the start.

import { MapPin } from "lucide-react";
import type { ReactNode } from "react";

import { ProposalRow } from "@/components/ProposalRow";
import type { PartState } from "@/components/ProposalRow";

import { locationHref, locationLabel } from "./location-links";

export function LocationExtensionRow({
  campaign,
  location,
  state,
  ...row
}: {
  campaign: string;
  location: { id: string; name: string };
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
      icon={MapPin}
      name={location.name}
      label={locationLabel(location.id)}
      state={state}
      writtenHref={locationHref(campaign, location.id)}
      writtenLabel={locationLabel(location.id)}
    />
  );
}
