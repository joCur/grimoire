// The augment action of a location's reading view. It joins two slices: the
// generator job's augment dialog and review (generator-job/AugmentAction.tsx)
// over the run that starts on the location's own resource (ADR #31), and the
// location's own editing session as the accepting write. App.tsx hands it to
// the location's route as its augment slot.

import { locationChangeSchema, type Location } from "@grimoire/shared/location";
import type { GeneratorJob } from "@grimoire/shared/generator-job";

import {
  AugmentDialog,
  AugmentReview,
  AugmentTrigger,
  staleAfterApply,
  useAugmentReviewState,
  type ProposalView,
} from "@/generator-job/AugmentAction";

import { applyLocationAugment, startLocationAugmentJob } from "@/location/location-api";
import { locationFieldProposals } from "@/location/location-augment";
import { locationsKey } from "@/location/location-query";
import { useLocationEdit } from "@/location/use-location-edit";

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
  job: GeneratorJob;
  proposal: ProposalView;
  onDone: () => void;
}) {
  const state = useAugmentReviewState(campaign, job, proposal);
  const apply = useLocationEdit(campaign, location, {
    write: ({ force: _force, id: _id, ...request }) =>
      applyLocationAugment(campaign, location.id, { ...request, jobId: job.id }),
    canForce: false,
    invalidateOnSuccess: [...staleAfterApply(campaign), locationsKey(campaign)],
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
