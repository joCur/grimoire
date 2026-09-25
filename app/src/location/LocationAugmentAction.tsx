// The augment action of a location's reading view: the shared augment dialog
// and review (components/AugmentAction.tsx) over the run that starts on the
// location's own resource (ADR #31), and the location's own editing session
// as the accepting write.

import { locationChangeSchema } from "@grimoire/shared/location";
import type { GenerateJob, Location } from "@grimoire/shared/types";

import { applyLocationAugment, startLocationAugmentJob } from "@/api";
import {
  AugmentDialog,
  AugmentReview,
  AugmentTrigger,
  staleAfterApply,
  useAugmentReviewState,
  type ProposalView,
} from "@/components/AugmentAction";

import { locationFieldProposals } from "./location-augment";
import { useLocationEdit } from "./use-location-edit";

export function LocationAugmentAction({
  campaign,
  location,
}: {
  campaign: string;
  location: Location;
}) {
  return (
    <AugmentTrigger openKey={`${campaign}/location/${location.id}`}>
      {(onClose) => (
        <AugmentDialog
          campaign={campaign}
          name={location.name}
          isMine={(job) => job.kind === "location-augment" && job.location === location.id}
          start={(input) => startLocationAugmentJob(campaign, location.id, input)}
          review={(job) => {
            const result = job.locationAugmentResult;
            if (result === undefined) return undefined;
            return (
              <LocationAugmentReview
                campaign={campaign}
                location={location}
                job={job}
                proposal={{
                  fields: locationFieldProposals(result.current, result.proposed),
                  currentBody: result.current.body,
                  proposedBody: result.proposed.body,
                  warnings: result.warnings,
                  namingHints: result.namingHints,
                }}
                onDone={onClose}
              />
            );
          }}
          onClose={onClose}
        />
      )}
    </AugmentTrigger>
  );
}

/**
 * The review over the location's own editing session, handed the accept
 * endpoint of the location's resource (it discards the job in the same
 * transaction and has no force).
 */
function LocationAugmentReview({
  campaign,
  location,
  job,
  proposal,
  onDone,
}: {
  campaign: string;
  location: Location;
  job: GenerateJob;
  proposal: ProposalView;
  onDone: () => void;
}) {
  const state = useAugmentReviewState(campaign, job, proposal);
  const apply = useLocationEdit(campaign, location, {
    write: ({ force: _force, id: _id, ...request }) =>
      applyLocationAugment(campaign, location.id, { ...request, jobId: job.id }),
    canForce: false,
    invalidateOnSuccess: [...staleAfterApply(campaign), ["locations", campaign]],
    onSaved: onDone,
    onReload: (stored) => state.recut(stored.body),
  });
  return (
    <AugmentReview
      campaign={campaign}
      proposal={proposal}
      state={state}
      session={{
        ...apply,
        save: (change) =>
          apply.save(
            locationChangeSchema.parse({
              ...change.fields,
              ...(change.body === undefined ? {} : { body: change.body }),
            }),
          ),
      }}
      onDone={onDone}
    />
  );
}
