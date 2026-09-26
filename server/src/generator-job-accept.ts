// Accepting what a generator run proposed — the `writtenScenes`,
// `writtenNpcs` and `writtenLocations` of a `PATCH …/generator-jobs/:id`.
//
// Its own module and not part of generator.ts for one reason: it needs both
// the proposal VALIDATION (generator.ts) and the JOB store (generator-jobs.ts),
// and generator-jobs.ts already imports generator.ts to run the pipeline. A
// third module keeps that import graph a tree — the same split db/job-boot.ts
// exists for.

import {
  withNpcChange,
  withSceneChange,
  type GeneratorJobPatch,
  type LocationProposal,
  type NpcProposal,
  type SceneProposal,
} from "@grimoire/shared";
import { ApiError } from "./api-error";
import {
  applyReviewPatch,
  markWrittenInTx,
  outlineSceneNumbers,
  jobConflict,
  patchJobReview,
  requireJob,
  type Job,
} from "./generator-jobs";
import { applyLocationItem, applyNpcItem, applySceneItem, jobChapterTarget } from "./generator";
import { requireCampaign } from "./store/campaigns";
import { sceneRunPos, takeSceneRunStart, type SceneRunStart } from "./store/chapters";
import { writeGenerated, type ScenePlacement } from "./store/generated";

/**
 * Accept proposals of a run — every proposed scene, npc and location the
 * patch names in `review.writtenScenes`, `writtenNpcs` and `writtenLocations`
 * — together with the rest of the patch, the DM's changes and decisions:
 *
 *   selection   exactly the named proposals. Naming one is the decision to
 *               take it: an undecided npc or location is written, a dropped
 *               scene or a rejected npc or location is not open and is a 409.
 *               A proposal that is already written has nothing left to do (a
 *               double click, a second tab) and is skipped.
 *               A SCENE CARRIES WHAT IT NAMES. A scene cannot be written
 *               while its `npcs`/`location` name nothing (decisions/constraints), so a
 *               selected scene pulls in the run's own npcs and locations for
 *               those ids — every one that is not REJECTED, accepted or
 *               still undecided. Accepting the scene is the decision that
 *               they exist; what the DM threw away stays thrown away, and
 *               the write is then refused and names it.
 *   transaction one, with the conflict checks of the ordinary generator write
 *               (`writeGenerated`: conflicts checked INSIDE it, FTS and
 *               `[[slug]]` reference rows follow because this is that path).
 *   placement   a scene of a pipelined run goes to the run's start plus its
 *               outline number (decisions/scene-order), so the run keeps its outline order
 *               in the chapter however many calls accept it and in whatever
 *               order. The start is the chapter's end at the FIRST scene
 *               accept, taken in that transaction and stored on the job in
 *               the same commit.
 *   job         the patch's review part and the written proposals are
 *               recorded ON the job in that same commit, and the row is
 *               deleted the moment nothing is left open. Discarding the job
 *               therefore removes only the open rest — what was written is a
 *               row now, not a job.
 *
 * Answers the job as the write leaves it — as it ended, when nothing is left
 * open.
 */
export async function acceptJobParts(
  campaign: string,
  jobId: string,
  patch: GeneratorJobPatch,
): Promise<Job> {
  await requireCampaign(campaign);
  const job = await requireJob(campaign, jobId);
  // The guard is checked binding inside the write; checked here too, a stale
  // one costs no planning and gets the same answer.
  if (job.rev !== patch.rev) throw jobConflict(job);
  // A RUNNING job is acceptable too, part by part: a
  // pipelined run stays `running` while parts are open, and the whole point
  // of the pipeline is that a finished part is reviewable and acceptable
  // before its siblings are. What is acceptable is what is IN the result, and
  // only a `done` part ever lands there — so the gate asks for a result, not
  // for a finished run. A `failed` job (no part produced anything) and a
  // running one that has not produced anything yet keep their 409.
  if (job.status === "failed") throw new ApiError(409, "this job has no result to accept");
  // A running SINGLE-CALL run (npc, augment) has no parts at all, so this is
  // also what keeps it unacceptable until it is done.
  if (job.status === "running" && !(job.pipeline?.parts ?? []).some((p) => p.status === "done")) {
    throw new ApiError(409, "this job has no finished part to accept");
  }

  // The plan reads the job as the patch leaves it: a change to a proposal
  // sent together with its accept is what gets written.
  applyReviewPatch(job, patch);
  const review = job.review;
  const dropped = new Set(review.droppedScenes);
  /**
   * Every proposed scene of this run, by its id — with the DM's change
   * applied on top of the model's scene (`withSceneChange`) and checked
   * against the scene's schema like any other scene the accept writes.
   */
  const sceneParts = new Map<string, { scene: SceneProposal; open: boolean }>();
  job.result?.scenes.forEach((proposal, index) => {
    const open = !review.writtenScenes.includes(proposal.id) && !dropped.has(proposal.id);
    const change = job.sceneEdits[proposal.id];
    sceneParts.set(proposal.id, {
      scene: applySceneItem(
        change === undefined ? proposal : withSceneChange(proposal, change),
        index,
      ),
      open,
    });
  });
  /**
   * Every proposed npc of this run, by its id — with the DM's change applied
   * on top of the model's npc (`withNpcChange`) and checked against the
   * npc's schema like any other npc the accept writes.
   */
  const npcParts = new Map<string, { npc: NpcProposal; open: boolean }>();
  const addNpc = (proposal: NpcProposal, index: number): void => {
    const open =
      !review.writtenNpcs.includes(proposal.id) && review.npcs[proposal.id] !== "rejected";
    const change = job.npcEdits[proposal.id];
    npcParts.set(proposal.id, {
      npc: applyNpcItem(change === undefined ? proposal : withNpcChange(proposal, change), index),
      open,
    });
  };
  job.result?.npcs.forEach((proposal, index) => addNpc(proposal, index));
  if (job.npcResult !== undefined) addNpc(job.npcResult.npc, 0);
  /** Every proposed location of this run, by its id. */
  const locationParts = new Map<string, { location: LocationProposal; open: boolean }>();
  job.result?.locations.forEach((proposal, index) => {
    const open =
      !review.writtenLocations.includes(proposal.id) &&
      review.locations[proposal.id] !== "rejected";
    locationParts.set(proposal.id, { location: applyLocationItem(proposal, index), open });
  });

  /**
   * The run's own npcs and locations a scene REFERENCES and the DM has not
   * rejected — see the selection rule above. Read off the scene with the
   * DM's change applied, so an edit of the scene in the review counts.
   */
  const referencedOf = (id: string): { npcs: string[]; locations: string[] } => {
    const part = sceneParts.get(id);
    if (part === undefined) return { npcs: [], locations: [] };
    const { npcs: npcIds, location } = part.scene;
    return {
      npcs: npcIds.filter((npcId) => npcParts.get(npcId)?.open === true),
      locations:
        location !== undefined && locationParts.get(location)?.open === true ? [location] : [],
    };
  };

  /**
   * WHICH parts this call writes. Only membership — the order comes from
   * `sceneParts` below.
   */
  const chosenScenes = new Set<string>();
  const chosenNpcs = new Set<string>();
  const chosenLocations = new Set<string>();
  const selection = patch.review ?? {};
  // An unknown id is a 400 (`applyReviewPatch`); an already WRITTEN one is
  // skipped. One that is dropped or rejected cannot be written.
  for (const id of selection.writtenScenes ?? []) {
    const part = sceneParts.get(id)!;
    if (part.open) chosenScenes.add(id);
    else if (!review.writtenScenes.includes(id)) throw notOpen("scene", id);
  }
  for (const id of selection.writtenNpcs ?? []) {
    const part = npcParts.get(id)!;
    if (part.open) chosenNpcs.add(id);
    else if (!review.writtenNpcs.includes(id)) throw notOpen("npc", id);
  }
  for (const id of selection.writtenLocations ?? []) {
    const part = locationParts.get(id)!;
    if (part.open) chosenLocations.add(id);
    else if (!review.writtenLocations.includes(id)) throw notOpen("location", id);
  }
  for (const id of [...chosenScenes]) {
    const referenced = referencedOf(id);
    for (const id of referenced.npcs) chosenNpcs.add(id);
    for (const id of referenced.locations) chosenLocations.add(id);
  }
  const npcs = [...npcParts].filter(([id]) => chosenNpcs.has(id)).map(([, part]) => part.npc);
  const locations = [...locationParts]
    .filter(([id]) => chosenLocations.has(id))
    .map(([, part]) => part.location);
  /**
   * The selection in the order of `sceneParts`, which is the run's OUTLINE
   * order — the dramaturgical sequence the outline step decided. A scene of
   * a pipelined run is placed by its outline number (`placeScene` below); a
   * scene without one goes to the end of its chapter, and then the write
   * order IS the order the scenes end up in (decisions/scene-order). Either way the chapter
   * does not depend on the order the review happened to name its scenes in.
   *
   * The npcs and locations a selected scene carries along are written ahead
   * of every scene by `writeGenerated`, so they cannot shift a scene's
   * position.
   */
  const scenes = [...sceneParts]
    .filter(([id]) => chosenScenes.has(id))
    .map(([, part]) => part.scene);
  // A selection whose parts are ALL written already is a double click or a
  // second tab, not an error: the caller asked for a state that is the
  // state. What else the patch carries is stored as a review patch.
  if (scenes.length === 0 && npcs.length === 0 && locations.length === 0) {
    return patchJobReview(campaign, jobId, patch);
  }

  // The chapter comes first — the scenes live inside it. Idempotent:
  // an existing chapter yields null, so only the FIRST partial accept of a
  // new-chapter run actually creates it.
  //
  // Decided from the JOB: the review state is persistent, so the accept
  // regularly happens in a browser that never saw the start form.
  const newChapter = await jobChapterTarget(campaign, job);
  /**
   * The run's start, stored or — at the first scene accept — taken inside
   * the write transaction. Reading the stored one off the pre-read job is
   * safe: only an accept sets it, every accept bumps the review rev, and
   * `markWrittenInTx` refuses a stale rev in this very transaction.
   */
  let sceneStart: SceneRunStart | undefined = job.pipeline?.sceneStart;
  let tookStart = false;
  const numbers = outlineSceneNumbers(job.pipeline?.parts ?? []);
  const placeScene: ScenePlacement = (tx, scene) => {
    const number = numbers.get(scene.id);
    const chapter = scene.chapter;
    // A scene outside the outline or outside the run's chapter has no place
    // of its own and goes to the end, like every other new scene.
    if (number === undefined || chapter !== job.chapter) return undefined;
    if (sceneStart === undefined) {
      sceneStart = takeSceneRunStart(tx, campaign, chapter);
      tookStart = true;
    }
    return sceneRunPos(tx, campaign, chapter, sceneStart, number);
  };

  const writtenScenes = scenes.map((scene) => scene.id);
  const writtenNpcs = npcs.map((npc) => npc.id);
  const writtenLocations = locations.map((location) => location.id);
  let accepted: Job | undefined;
  await writeGenerated(campaign, {
    ...(newChapter === null ? {} : { chapter: newChapter }),
    scenes,
    npcs,
    locations,
    runChapters: job.chapter === undefined ? [] : [job.chapter],
    placeScene,
    onWritten: (tx) => {
      accepted = markWrittenInTx(
        tx,
        campaign,
        jobId,
        patch,
        { scenes: writtenScenes, npcs: writtenNpcs, locations: writtenLocations },
        tookStart ? sceneStart : undefined,
      );
    },
  });
  return accepted!;
}

/** The 409 of a proposal the DM dropped or rejected — it is not open to accept. */
function notOpen(entity: string, id: string): ApiError {
  return new ApiError(409, `the proposed ${entity} ${id} is dropped or rejected — it is not open`);
}
