// A location a generator run proposes, as its row in the run's review: the
// shared proposal row (components/ProposalRow.tsx) with the location's marker,
// its label, and — once written — the link to its reading view.

import type { LocationProposal } from "@grimoire/shared/location";
import { MapPin } from "lucide-react";
import type { ReactNode } from "react";

import { ProposalRow } from "@/components/ProposalRow";
import type { PartState } from "@/components/ProposalRow";

import { locationHref, locationLabel } from "./location-links";

export function LocationProposalRow({
  campaign,
  location,
  state,
  ...row
}: {
  campaign: string;
  location: LocationProposal;
  state: PartState;
  reason: string;
  busy: boolean;
  cardRef?: (el: HTMLElement | null) => void;
  testId?: string;
  /** What the page notes about the proposal, under its name. */
  notes?: ReactNode;
  onReject: () => void;
  onAccept: () => void;
}) {
  const written = state === "written";
  return (
    <ProposalRow
      {...row}
      icon={MapPin}
      name={location.name}
      label={locationLabel(location.id)}
      state={state}
      writtenHref={written ? locationHref(campaign, location.id) : undefined}
      writtenLabel={written ? locationLabel(location.id) : undefined}
    />
  );
}
