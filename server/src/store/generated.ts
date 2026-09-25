// Taking over what a generator run produced.
//
// A run proposes entities, each the entity itself without its guard
// (ADR #31): the chapter a new-chapter run creates is a
// `ChapterProposal`, a proposed scene a `SceneProposal`, a proposed npc an
// `NpcProposal` and a proposed location a `LocationProposal`. This is the
// write behind `POST /generate/apply` and the accept: one transaction for
// the whole batch, the documented `409 { chapters, scenes, npcs, locations }`
// decided INSIDE it, and the job row discarded in the same commit. A partial
// accept records what it wrote instead. Nothing here is a second write path
// — a row that already holds content is a conflict, not something to
// overwrite.

import { and, eq } from "drizzle-orm";
import type {
  ChapterProposal,
  LocationProposal,
  NpcProposal,
  SceneProposal,
} from "@grimoire/shared";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { generateJobs } from "../db/schema";
import { mutate } from "./campaigns";
import { chapterTaken, ensureChapterRow, insertChapterProposal } from "./chapters";
import { insertLocationProposal, locationTaken } from "./locations";
import { insertNpcProposal, npcTaken } from "./npcs";
import { insertSceneProposal, sceneTaken } from "./scenes";

// --- the generator's apply step ------------------------------------------------

/**
 * Where a proposed scene goes in its chapter: a `pos`, or undefined for the
 * end of the chapter. Asked INSIDE the write transaction, once the scene's
 * chapter exists and before the scene is inserted — a generator run's start
 * is the chapter's end at that moment (store/chapters.ts `sceneRunPos`).
 */
export type ScenePlacement = (tx: GrimoireDb, scene: SceneProposal) => number | undefined;

/**
 * Run a batch of generator writes in ONE transaction — and CHECK THE
 * CONFLICTS IN IT. A check in front of the transaction (generator.ts) would
 * leave a window between "nothing exists yet" and the
 * insert: a scene created in between would turn the documented
 * `409 { scenes }` into a primary-key violation, i.e. a 500. Inside the
 * transaction there is no window, and a constraint that fires anyway is
 * translated back to the documented answer instead of escaping as a 500 —
 * either way the transaction rolls back, so a partial apply is impossible.
 *
 * `jobId` discards the generate job the batch came from IN THE
 * SAME COMMIT, never as a second statement after the write: a crash in
 * between would leave a `done` job whose proposals were already stored, so
 * the next start would offer a review that could only ever answer 409 — and a
 * failing delete would turn a successful write into a 500. The job row
 * disappears exactly when the proposals appear, or neither does. A stale id
 * (a newer run started meanwhile) matches nothing and is ignored, which is
 * the documented behaviour.
 *
 * A chapter or a scene that already exists is a conflict (reported by id
 * under `chapters` or `scenes`); an npc or a location that already holds
 * content is one too (under `npcs` or `locations`), while an empty one is
 * filled.
 */
export async function writeGenerated(
  campaign: string,
  options: {
    /** The chapter a new-chapter run creates, when it is not there yet. */
    chapter?: ChapterProposal;
    scenes?: SceneProposal[];
    npcs?: NpcProposal[];
    locations?: LocationProposal[];
    jobId?: string;
    /**
     * The chapters the run decided on (ADR #18): each is written here if it
     * is not there yet — the net under a new-chapter run, whose chapter
     * usually comes along. Any other chapter a scene names has to exist.
     */
    runChapters?: readonly string[];
    /**
     * A PARTIAL accept does not discard the job — it records what
     * it wrote on it and deletes the row only when nothing is left open. That
     * bookkeeping belongs in THIS transaction for the same reason the discard
     * does: after a crash the job and the rows it produced must not
     * disagree. When it is given it replaces the `jobId` discard entirely.
     */
    onWritten?: (tx: GrimoireDb) => void;
    /** Where the scenes go; absent, every one goes to its chapter's end. */
    placeScene?: ScenePlacement;
  } = {},
): Promise<void> {
  const {
    chapter,
    scenes = [],
    npcs = [],
    locations = [],
    jobId,
    runChapters = [],
    onWritten,
    placeScene,
  } = options;
  try {
    await mutate(campaign, (tx) => {
      // TWO proposals for ONE row are a conflict too. An empty npc or
      // location is no conflict, so the second proposal does not hit the
      // primary key: unchecked it would FILL the row the first had just
      // written, last write wins, and the review would report a clean apply
      // for content it had silently dropped. The batch is the model's output
      // — one hallucinated duplicate id is exactly the case — so the answer
      // is the documented one, and it names both offenders.
      const duplicateScenes = duplicateIds(scenes.map((scene) => scene.id));
      const duplicateNpcs = duplicateIds(npcs.map((npc) => npc.id));
      const duplicateLocations = duplicateIds(locations.map((location) => location.id));
      if (
        duplicateScenes.length > 0 ||
        duplicateNpcs.length > 0 ||
        duplicateLocations.length > 0
      ) {
        throw new ApiError(409, "two proposals for the same target", {
          chapters: [],
          scenes: duplicateScenes,
          npcs: duplicateNpcs,
          locations: duplicateLocations,
        });
      }
      const takenChapters =
        chapter !== undefined && chapterTaken(tx, campaign, chapter.id) ? [chapter.id] : [];
      const takenScenes = scenes
        .filter((scene) => sceneTaken(tx, campaign, scene.id))
        .map((scene) => scene.id);
      const takenNpcs = npcs.filter((npc) => npcTaken(tx, campaign, npc.id)).map((npc) => npc.id);
      const takenLocations = locations
        .filter((location) => locationTaken(tx, campaign, location.id))
        .map((location) => location.id);
      if (
        takenChapters.length > 0 ||
        takenScenes.length > 0 ||
        takenNpcs.length > 0 ||
        takenLocations.length > 0
      ) {
        throw new ApiError(409, "target rows already exist", {
          chapters: takenChapters,
          scenes: takenScenes,
          npcs: takenNpcs,
          locations: takenLocations,
        });
      }
      // A chapter goes in before everything that names it, and an npc and a
      // location before the scene that lists them: the constraints are
      // checked per statement.
      if (chapter !== undefined) insertChapterProposal(tx, campaign, chapter);
      for (const chapter of runChapters) ensureChapterRow(tx, campaign, chapter);
      for (const location of locations) insertLocationProposal(tx, campaign, location);
      for (const npc of npcs) insertNpcProposal(tx, campaign, npc);
      for (const scene of scenes) {
        insertSceneProposal(tx, campaign, scene, placeScene?.(tx, scene));
      }
      if (onWritten !== undefined) {
        onWritten(tx);
      } else if (jobId !== undefined) {
        tx.delete(generateJobs)
          .where(and(eq(generateJobs.id, jobId), eq(generateJobs.campaignId, campaign)))
          .run();
      }
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isConstraintViolation(error)) {
      throw new ApiError(409, "target rows already exist", {
        chapters: chapter === undefined ? [] : [chapter.id],
        scenes: scenes.map((scene) => scene.id),
        npcs: npcs.map((npc) => npc.id),
        locations: locations.map((location) => location.id),
      });
    }
    throw error;
  }
}

/** Every id that occurs more than once, sorted. */
function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Map<string, number>();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].filter(([, count]) => count > 1).map(([id]) => id).sort();
}

/**
 * A UNIQUE/PRIMARY KEY violation from either SQLite backend (ADR #13) — the
 * race the conflict check above cannot close, and the only constraint failure
 * that means "the target is taken".
 *
 * NAMED CONSTRAINTS ONLY, deliberately. A plain /constraint/ also matches
 * "FOREIGN KEY constraint failed", so a proposal that names a row the batch
 * does not bring would turn into a 409 listing every proposal as an existing
 * target — an answer about the wrong thing, and about rows that are not
 * there. A reference that names nothing is a 400 with its own code, raised by
 * the assertions before the insert; anything else is not this function's
 * answer and travels on as the error it is.
 */
function isConstraintViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(UNIQUE|PRIMARY KEY) constraint failed/i.test(message);
}
