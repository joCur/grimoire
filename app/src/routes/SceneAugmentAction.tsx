// The augment action of a scene's reading view. It joins two slices: the
// generator job's augment dialog and review (generator-job/AugmentAction.tsx)
// over the run that starts on the scene's own resource (ADR #31), and the
// scene's own editing session as the accepting write. App.tsx hands it to the
// scene's route as its augment slot.

import { sceneChangeSchema } from "@grimoire/shared/scene";
import type { Scene } from "@grimoire/shared/types";
import type { GeneratorJob } from "@grimoire/shared/generator-job";

import {
  AugmentDialog,
  AugmentReview,
  AugmentTrigger,
  staleAfterApply,
  useAugmentReviewState,
  type ProposalView,
} from "@/generator-job/AugmentAction";

import { applySceneAugment, startSceneAugmentJob } from "@/scene/scene-api";
import { sceneFieldProposals } from "@/scene/scene-augment";
import { useSceneEdit } from "@/scene/use-scene-edit";

export function SceneAugmentAction({
  campaign,
  scene,
}: {
  campaign: string;
  scene: Scene;
}) {
  return (
    <AugmentTrigger openKey={`${campaign}/scene/${scene.id}`}>
      {(onClose) => (
        <AugmentDialog
          campaign={campaign}
          name={scene.title === "" ? scene.id : scene.title}
          isMine={(job) => job.kind === "scene-augment" && job.scene === scene.id}
          start={(input) => startSceneAugmentJob(campaign, scene.id, input)}
          review={(job) => {
            const result = job.sceneAugmentResult;
            if (result === undefined) return undefined;
            return (
              <SceneAugmentReview
                campaign={campaign}
                scene={scene}
                job={job}
                proposal={{
                  fields: sceneFieldProposals(result.current, result.proposed),
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
 * The review over the scene's own editing session, handed the accept
 * endpoint of the scene's resource (it discards the job in the same
 * transaction and has no force).
 */
function SceneAugmentReview({
  campaign,
  scene,
  job,
  proposal,
  onDone,
}: {
  campaign: string;
  scene: Scene;
  job: GeneratorJob;
  proposal: ProposalView;
  onDone: () => void;
}) {
  const state = useAugmentReviewState(campaign, job, proposal);
  const apply = useSceneEdit(campaign, scene, {
    write: ({ force: _force, id: _id, ...request }) =>
      applySceneAugment(campaign, scene.id, { ...request, jobId: job.id }),
    canForce: false,
    invalidateOnSuccess: staleAfterApply(campaign),
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
            sceneChangeSchema.parse({
              ...change.fields,
              ...(change.body === undefined ? {} : { body: change.body }),
            }),
          ),
      }}
      onDone={onDone}
    />
  );
}
