// The augment action of an npc's reading view: the shared augment dialog and
// review (components/AugmentAction.tsx) over the run that starts on the npc's
// own resource (ADR #31), and the npc's own editing session as the accepting
// write.

import { npcChangeSchema } from "@grimoire/shared/npc";
import type { GenerateJob, Npc } from "@grimoire/shared/types";

import { applyNpcAugment, startNpcAugmentJob } from "@/api";
import {
  AugmentDialog,
  AugmentReview,
  AugmentTrigger,
  staleAfterApply,
  useAugmentReviewState,
  type ProposalView,
} from "@/components/AugmentAction";

import { npcFieldProposals } from "./npc-augment";
import { useNpcEdit } from "./use-npc-edit";

export function NpcAugmentAction({ campaign, npc }: { campaign: string; npc: Npc }) {
  return (
    <AugmentTrigger openKey={`${campaign}/npc/${npc.id}`}>
      {(onClose) => (
        <AugmentDialog
          campaign={campaign}
          name={npc.name}
          isMine={(job) => job.kind === "npc-augment" && job.npc === npc.id}
          start={(input) => startNpcAugmentJob(campaign, npc.id, input)}
          review={(job) => {
            const result = job.npcAugmentResult;
            if (result === undefined) return undefined;
            return (
              <NpcAugmentReview
                campaign={campaign}
                npc={npc}
                job={job}
                proposal={{
                  fields: npcFieldProposals(result.current, result.proposed),
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
 * The review over the npc's own editing session, handed the accept endpoint
 * of the npc's resource (it discards the job in the same transaction and has
 * no force).
 */
function NpcAugmentReview({
  campaign,
  npc,
  job,
  proposal,
  onDone,
}: {
  campaign: string;
  npc: Npc;
  job: GenerateJob;
  proposal: ProposalView;
  onDone: () => void;
}) {
  const state = useAugmentReviewState(campaign, job, proposal);
  const apply = useNpcEdit(campaign, npc, {
    write: ({ force: _force, id: _id, ...request }) =>
      applyNpcAugment(campaign, npc.id, { ...request, jobId: job.id }),
    canForce: false,
    invalidateOnSuccess: [...staleAfterApply(campaign), ["npcs", campaign]],
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
            npcChangeSchema.parse({
              ...change.fields,
              ...(change.body === undefined ? {} : { body: change.body }),
            }),
          ),
      }}
      onDone={onDone}
    />
  );
}
