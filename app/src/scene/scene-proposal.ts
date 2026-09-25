// A scene a generator run proposes, as the review shows it: the scene the run
// proposed with every change laid on top, in order — the job's stored change
// first, the buffer the DM is typing in last (`withSceneChange`). Pure, so
// the rule is unit-testable.

import { withSceneChange } from "@grimoire/shared/scene";
import type { SceneChange, SceneProposal } from "@grimoire/shared/types";

export function sceneOf(
  proposed: SceneProposal,
  ...changes: Array<SceneChange | undefined>
): SceneProposal {
  let out = proposed;
  for (const change of changes) {
    if (change === undefined) continue;
    out = withSceneChange(out, change) as SceneProposal;
  }
  return out;
}
