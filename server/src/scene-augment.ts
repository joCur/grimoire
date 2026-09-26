// Augmenting a SCENE: the generator pointed at a scene that already exists,
// on the scene's own resource (decisions/resources) — `POST …/scenes/:id/augment` starts
// the run and `POST …/scenes/:id/augment/apply` writes what the DM took.
//
// The mechanics are the generator's (./generator.ts `runPipeline`): same
// provider, same correction turns, same truncation fail-fast, same background
// job, same naming check. What is the scene's own:
//
//   1. the prompt shows the scene COMPLETE — every field, `body` among them —
//      as the very object the reply is forced into, under the augmentation
//      rule of generator/scene-augment-system-prompt.md,
//   2. the reply is read by the scene's reply schema (./scene-reply.ts) and
//      becomes a PROPOSAL: the scene as the run read it beside the scene as
//      the model proposes it (`SceneAugmentResult`). The app compares the two
//      field by field and cuts `body` into the Block-Composer's blocks,
//   3. accepting is the scene's own PATCH (store/scenes.ts `patchScene`): the
//      fields the DM took, `rev`-guarded, the job discarded in the same
//      transaction.

import {
  CALLOUT_KINDS,
  scenePatchSchema,
  sceneToReply,
  type Scene,
  type SceneAugmentResult,
  type SceneProposal,
} from "@grimoire/shared";
import { bodyRefSlugs } from "@grimoire/shared/refs";
import { ApiError } from "./api-error";
import {
  ASSET_FILES,
  campaignRefIds,
  collectContext,
  loadAsset,
  obtainProvider,
  runPipeline,
  unknownCallouts,
  unknownRefErrors,
  withNamingHints,
} from "./generator";
import { formatContract, sameValue } from "./generator-augment";
import type { LLMProvider } from "./llm-provider";
import { parseSceneReply, sceneReplyRequest } from "./scene-reply";
import { parseRequest } from "./store/shared";
import { patchScene, readScene } from "./store/scenes";

/** The correction turn's tail — what a corrected reply must still contain. */
const CORRECTION_TAIL = "die vollständige ergänzte Szene enthalten";

/** The section of the scene prompt that describes the scene's fields. */
const SCENE_FORMAT_HEADING = "## Die Felder der Szene";

/** A scene without its guard — what the prompt shows and the proposal compares. */
function withoutGuard(scene: Scene): SceneProposal {
  const { rev: _rev, ...proposal } = scene;
  return proposal;
}

/**
 * The system prompt of a scene augment run: the augmentation rule for a
 * scene, followed by the field section of the scene prompt — the fields are
 * described exactly once.
 */
export async function sceneAugmentSystemPrompt(): Promise<string> {
  const [rule, format] = await Promise.all([
    loadAsset(ASSET_FILES.sceneAugment.systemPrompt),
    loadAsset(ASSET_FILES.scene.systemPrompt),
  ]);
  return `${rule.trimEnd()}\n\n${formatContract(format, SCENE_FORMAT_HEADING)}`;
}

/**
 * Mechanical validation of one raw reply against the scene it is about.
 * Returns the PROPOSAL, or the error list for the correction turn.
 *
 * The id stays (decisions/constraints), only known callouts, and every `[[id]]` the
 * proposal ADDS names something of the campaign — one the stored body
 * already carries is the DM's, and the augmentation rule tells the model to
 * keep it. The status is whatever the DM made it and may stay so: the reply
 * offers all four. An `npcs` or `location` that names nothing is not checked
 * here — the scene's write refuses it with the sentence the DM already knows.
 */
export function validateSceneAugmentReply(
  raw: string,
  stored: Scene,
  refIds: ReadonlySet<string>,
): { ok: true; result: SceneAugmentResult } | { ok: false; errors: string[] } {
  const label = `scene "${stored.id}"`;
  const read = parseSceneReply(raw, "augment");
  if (!read.ok) return { ok: false, errors: read.errors.map((e) => `${label}: ${e}`) };
  const { scene, warnings } = read.reply;
  const errors: string[] = [];
  if (scene.id !== stored.id) {
    errors.push(
      `${label}: die id bleibt "${stored.id}" — sie ist der Referenzschlüssel ` +
        "der Kampagne und wird beim Ergänzen nie geändert",
    );
  }
  for (const callout of unknownCallouts(scene.body)) {
    errors.push(
      `${label}: unknown callout "[!${callout}]" — allowed: ` +
        CALLOUT_KINDS.map((k) => `[!${k}]`).join(", "),
    );
  }
  const known = new Set([...refIds, ...bodyRefSlugs(stored.body)]);
  for (const msg of unknownRefErrors(scene.body, known)) errors.push(`${label}: ${msg}`);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    result: {
      id: stored.id,
      rev: stored.rev,
      current: withoutGuard(stored),
      proposed: scene,
      warnings,
    },
  };
}

/**
 * The fields the proposal CHANGES, by name — what the naming check reads. A
 * field it leaves alone keeps a value the DM authored, and a hint about one
 * of those would be about the campaign rather than about this run.
 */
function changedFields(result: SceneAugmentResult): Record<string, unknown> {
  const current: Record<string, unknown> = result.current;
  const { body: _body, ...proposed } = result.proposed;
  return Object.fromEntries(
    Object.entries(proposed).filter(([key, value]) => !sameValue(current[key], value)),
  );
}

/**
 * Run the augment of one scene: context -> prompt -> provider -> validation,
 * with the generator's correction turns, truncation fail-fast and usage
 * accounting. Writes NOTHING.
 *
 * At least one of `sourceText`/`instruction` is required — the route checks
 * that before a job exists, and this asserts it again because the run must
 * never depend on a caller having done it.
 */
export async function runSceneAugment(
  campaign: string,
  id: string,
  input: { sourceText?: string; instruction?: string },
  getProvider: () => LLMProvider = obtainProvider,
): Promise<SceneAugmentResult> {
  const sourceText = (input.sourceText ?? "").trim();
  const instruction = (input.instruction ?? "").trim();
  if (sourceText === "" && instruction === "") {
    throw new ApiError(400, "sourceText or instruction is required");
  }
  const stored = await readScene(campaign, id);
  const ctx = await collectContext(campaign);
  const [prompt, fewShotTarget] = await Promise.all([
    sceneAugmentSystemPrompt(),
    loadAsset(ASSET_FILES.scene.fewShotTarget),
  ]);
  const result = await runPipeline({
    req: {
      systemPrompt: prompt,
      fewShotTarget,
      knowledge: ctx.knowledge,
      glossary: ctx.glossary,
      context: { chapter: stored.chapter, npcs: ctx.npcs, locations: ctx.locations },
      sourceText,
      existingScene: sceneToReply(withoutGuard(stored)),
      ...(instruction === "" ? {} : { instruction }),
      jsonSchema: sceneReplyRequest("augment"),
    },
    provider: getProvider(),
    validate: (raw) => validateSceneAugmentReply(raw, stored, campaignRefIds(ctx)),
    correctionTail: CORRECTION_TAIL,
  });
  return withNamingHints(
    result,
    [{ scene: result.id, fields: changedFields(result), body: result.proposed.body }],
    ctx.namingRules,
  );
}

/**
 * POST /api/campaigns/:campaign/scenes/:id/augment/apply — write the fields
 * the DM took from the proposal.
 *
 * The body is the scene's PATCH without `force` — the fields taken, the body
 * assembled from the accepted blocks, and the `rev` the review read — and it
 * is written like any other scene write, because it IS one: rev guard (409
 * `rev_conflict`), FTS, `[[id]]` reference rows, the reference checks, and
 * `jobId` discarding the augment job in the SAME transaction. The id is never
 * proposed, so it cannot be applied either.
 */
export async function applySceneAugment(
  campaign: string,
  id: string,
  raw: Record<string, unknown>,
  jobId?: string,
): Promise<Scene> {
  const patch = parseRequest(scenePatchSchema.omit({ force: true, id: true }), raw, "scene augment");
  const { rev: _rev, ...fields } = patch;
  if (Object.values(fields).every((value) => value === undefined)) {
    throw new ApiError(400, "nothing to apply");
  }
  return patchScene(campaign, id, patch, jobId);
}
