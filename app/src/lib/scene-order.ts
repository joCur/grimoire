// The scene order of a chapter, as the two views read and write it (ADR #27).
//
// `ChapterNode.scenes` arrives in the order the DM arranged — a flat list, not
// groups. Everything both views derive from that order lives here: which of
// the two displayed blocks a scene belongs to, what one up/down step writes,
// which scene the session view opens with, and where its "next scene" step
// leads.
//
// Pure on purpose — no react, no query client, no translator. The chapter
// overview and the session view have to agree on these rules, and a rule that
// is a function can be tested without rendering either of them.

import type { CampaignTree, ChapterNode, SceneSummary } from "@grimoire/shared/types";

import { isSceneDone } from "@/scene/scene-status";

/** True for a scene of the contingency block shown at the end of the chapter. */
export function isContingency(scene: SceneSummary): boolean {
  return scene.type === "contingency";
}

/** The chapter's planned scenes in order — the first of the two blocks. */
export function plannedScenes(scenes: readonly SceneSummary[]): SceneSummary[] {
  return scenes.filter((scene) => !isContingency(scene));
}

/** The chapter's contingency scenes in order — the block at the end. */
export function contingencyScenes(scenes: readonly SceneSummary[]): SceneSummary[] {
  return scenes.filter(isContingency);
}

/**
 * The chapter's complete order after moving one scene one step inside ITS OWN
 * block — the list the scene-order endpoint takes.
 *
 * `pos` runs over all scenes of the chapter while the overview shows two
 * blocks, so swapping with the neighbour in the flat list would trade the last
 * planned scene for the first contingency: the DM presses and sees nothing
 * move. The swap therefore happens between the positions the two BLOCK
 * neighbours hold in the flat list, and every scene between them keeps its
 * place.
 *
 * A scene with no neighbour in that direction — the first or last row of its
 * block, where the control is disabled — gives the order back unchanged, and
 * so does an id the chapter does not hold.
 */
export function moveSceneOrder(
  scenes: readonly SceneSummary[],
  id: string,
  delta: -1 | 1,
): string[] {
  const order = scenes.map((scene) => scene.id);
  const from = scenes.findIndex((scene) => scene.id === id);
  const moved = scenes[from];
  if (moved === undefined) return order;

  let to = from + delta;
  for (;;) {
    const candidate = scenes[to];
    if (candidate === undefined) return order;
    if (isContingency(candidate) === isContingency(moved)) break;
    to += delta;
  }

  const here = order[from];
  const there = order[to];
  if (here === undefined || there === undefined) return order;
  order[from] = there;
  order[to] = here;
  return order;
}

/**
 * The scene the session view opens with: the first PLANNED scene of the order
 * whose status is neither `played` nor `dropped`.
 *
 * A contingency is never the entry — it fires when its trigger does, so the
 * evening cannot start on one, however early it sits in the order. `pos` runs
 * over both blocks, so the plan is what the search runs over.
 *
 * With the whole plan behind us it is the first planned scene, so the view
 * opens on something instead of on nothing; `undefined` for a chapter that
 * holds no planned scene at all.
 */
export function initialSessionScene(
  scenes: readonly SceneSummary[],
): SceneSummary | undefined {
  const planned = plannedScenes(scenes);
  return planned.find((scene) => !isSceneDone(scene.status)) ?? planned[0];
}

/**
 * Where the "next scene" step leads from the scene that is open: the next
 * PLANNED scene of the order that is not behind us yet.
 *
 * From a contingency it is the first such scene of the chapter. A contingency
 * is a detour, and the thread of the evening picks up where the plan left off
 * — not behind whichever scene the detour happens to sit next to.
 *
 * `undefined` means there is no step to offer, and the view then shows none: a
 * dead control at the end of the chapter says nothing that a missing one does
 * not say more quietly.
 */
export function nextSessionScene(
  scenes: readonly SceneSummary[],
  currentId: string | undefined,
): SceneSummary | undefined {
  const index = scenes.findIndex((scene) => scene.id === currentId);
  const current = scenes[index];
  const from = current === undefined || isContingency(current) ? 0 : index + 1;
  return scenes
    .slice(from)
    .find((scene) => !isContingency(scene) && !isSceneDone(scene.status));
}

function patchChapter(
  tree: CampaignTree,
  chapterId: string,
  patch: (chapter: ChapterNode) => ChapterNode,
): CampaignTree {
  return {
    ...tree,
    chapters: tree.chapters.map((chapter) =>
      chapter.id === chapterId ? patch(chapter) : chapter,
    ),
  };
}

/**
 * The tree with one chapter's scenes rearranged into `order` — the optimistic
 * half of a move, so the row is where the DM put it before the server answers.
 *
 * An id the chapter does not hold is skipped and a scene the order does not
 * name keeps its place at the end: the endpoint refuses an incomplete list
 * anyway, and no display is worth losing a row over.
 */
export function withSceneOrder(
  tree: CampaignTree,
  chapterId: string,
  order: readonly string[],
): CampaignTree {
  return patchChapter(tree, chapterId, (chapter) => {
    const rest = new Map(chapter.scenes.map((scene) => [scene.id, scene]));
    const moved: SceneSummary[] = [];
    for (const id of order) {
      const scene = rest.get(id);
      if (scene === undefined) continue;
      rest.delete(id);
      moved.push(scene);
    }
    return { ...chapter, scenes: [...moved, ...rest.values()] };
  });
}

/**
 * The tree carrying a chapter's fresh order guard token, so the next move
 * writes against the token the last one produced instead of waiting for the
 * tree to be refetched.
 */
export function withSceneOrderRev(
  tree: CampaignTree,
  chapterId: string,
  rev: number,
): CampaignTree {
  return patchChapter(tree, chapterId, (chapter) => ({ ...chapter, sceneOrderRev: rev }));
}
