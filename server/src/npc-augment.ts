// Augmenting an NPC: the generator pointed at an npc that already exists, on
// the npc's own resource (ADR #31) — `POST …/npcs/:id/augment` starts the run
// and `POST …/npcs/:id/augment/apply` writes what the DM took.
//
// The mechanics are the generator's (./generator.ts `runPipeline`): same
// provider, same correction turns, same truncation fail-fast, same background
// job, same naming check. What is the npc's own:
//
//   1. the prompt shows the npc COMPLETE — every field, `body` among them —
//      as the very object the reply is forced into (`quickstats` as its list
//      of pairs), under the augmentation rule of
//      generator/npc-augment-system-prompt.md,
//   2. the reply is read by the npc's reply schema (./npc-reply.ts) and
//      becomes a PROPOSAL: the npc as the run read it beside the npc as the
//      model proposes it (`NpcAugmentResult`). The app compares the two field
//      by field and cuts `body` into the Block-Composer's blocks,
//   3. accepting is the npc's own PATCH (store/npcs.ts `patchNpc`): the
//      fields the DM took, `rev`-guarded, the job discarded in the same
//      transaction.

import {
  CALLOUT_KINDS,
  npcPatchSchema,
  npcToReply,
  type Npc,
  type NpcAugmentResult,
  type NpcProposal,
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
import { npcReplyRequest, parseNpcReply } from "./npc-reply";
import { parseRequest } from "./store/shared";
import { patchNpc, readNpc } from "./store/npcs";

/** The correction turn's tail — what a corrected reply must still contain. */
const CORRECTION_TAIL = "den vollständigen ergänzten NPC enthalten";

/** The section of the npc prompt that describes the npc's fields. */
const NPC_FORMAT_HEADING = "## Die Felder des NPC";

/** An npc without its guard — what the prompt shows and the proposal compares. */
function withoutGuard(npc: Npc): NpcProposal {
  const { rev: _rev, ...proposal } = npc;
  return proposal;
}

/**
 * The system prompt of an npc augment run: the augmentation rule for an npc,
 * followed by the field section of the npc prompt — the fields are described
 * exactly once.
 */
export async function npcAugmentSystemPrompt(): Promise<string> {
  const [rule, format] = await Promise.all([
    loadAsset(ASSET_FILES.npcAugment.systemPrompt),
    loadAsset(ASSET_FILES.npc.systemPrompt),
  ]);
  return `${rule.trimEnd()}\n\n${formatContract(format, NPC_FORMAT_HEADING)}`;
}

/**
 * The values of a `quickstats` set as the reply writes them — every value a
 * string. A stored `2` the model echoes as `"2"` is the same value, not a
 * change the DM has to decide.
 */
function quickstatsText(quickstats: NpcProposal["quickstats"]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(quickstats ?? {}).map(([key, value]) => [key, String(value)]),
  );
}

/**
 * Mechanical validation of one raw reply against the npc it is about.
 * Returns the PROPOSAL, or the error list for the correction turn.
 *
 * The id stays (ADR #21), only known callouts, and every `[[id]]` the
 * proposal ADDS names something of the campaign — one the stored body
 * already carries is the DM's, and the augmentation rule tells the model to
 * keep it. A `quickstats` set the proposal repeats with its values written
 * as strings keeps the stored values: the reply form knows no other.
 */
export function validateNpcAugmentReply(
  raw: string,
  stored: Npc,
  refIds: ReadonlySet<string>,
): { ok: true; result: NpcAugmentResult } | { ok: false; errors: string[] } {
  const label = `npc "${stored.id}"`;
  const read = parseNpcReply(raw, "augment");
  if (!read.ok) return { ok: false, errors: read.errors.map((e) => `${label}: ${e}`) };
  const { npc, warnings } = read.reply;
  const errors: string[] = [];
  if (npc.id !== stored.id) {
    errors.push(
      `${label}: die id bleibt "${stored.id}" — sie ist der Referenzschlüssel ` +
        "der Kampagne und wird beim Ergänzen nie geändert",
    );
  }
  for (const callout of unknownCallouts(npc.body)) {
    errors.push(
      `${label}: unknown callout "[!${callout}]" — allowed: ` +
        CALLOUT_KINDS.map((k) => `[!${k}]`).join(", "),
    );
  }
  const known = new Set([...refIds, ...bodyRefSlugs(stored.body)]);
  for (const msg of unknownRefErrors(npc.body, known)) errors.push(`${label}: ${msg}`);
  if (errors.length > 0) return { ok: false, errors };
  const current = withoutGuard(stored);
  const { quickstats: _proposedStats, ...proposedFields } = npc;
  const keepsStats = sameValue(quickstatsText(current.quickstats), quickstatsText(npc.quickstats));
  const quickstats = keepsStats ? current.quickstats : npc.quickstats;
  return {
    ok: true,
    result: {
      id: stored.id,
      rev: stored.rev,
      current,
      proposed: { ...proposedFields, ...(quickstats === undefined ? {} : { quickstats }) },
      warnings,
    },
  };
}

/**
 * The fields the proposal CHANGES, by name — what the naming check reads. A
 * field it leaves alone keeps a value the DM authored, and a hint about one
 * of those would be about the campaign rather than about this run.
 */
function changedFields(result: NpcAugmentResult): Record<string, unknown> {
  const current: Record<string, unknown> = result.current;
  const { body: _body, ...proposed } = result.proposed;
  return Object.fromEntries(
    Object.entries(proposed).filter(([key, value]) => !sameValue(current[key], value)),
  );
}

/**
 * Run the augment of one npc: context -> prompt -> provider -> validation,
 * with the generator's correction turns, truncation fail-fast and usage
 * accounting. Writes NOTHING.
 *
 * At least one of `sourceText`/`instruction` is required — the route checks
 * that before a job exists, and this asserts it again because the run must
 * never depend on a caller having done it.
 */
export async function runNpcAugment(
  campaign: string,
  id: string,
  input: { sourceText?: string; instruction?: string },
  getProvider: () => LLMProvider = obtainProvider,
): Promise<NpcAugmentResult> {
  const sourceText = (input.sourceText ?? "").trim();
  const instruction = (input.instruction ?? "").trim();
  if (sourceText === "" && instruction === "") {
    throw new ApiError(400, "sourceText or instruction is required");
  }
  const stored = await readNpc(campaign, id);
  const ctx = await collectContext(campaign);
  const [prompt, fewShotTarget] = await Promise.all([
    npcAugmentSystemPrompt(),
    loadAsset(ASSET_FILES.npc.fewShotTarget),
  ]);
  const result = await runPipeline({
    req: {
      systemPrompt: prompt,
      fewShotTarget,
      knowledge: ctx.knowledge,
      glossary: ctx.glossary,
      context: { npcs: ctx.npcs, locations: ctx.locations },
      sourceText,
      existingNpc: npcToReply(withoutGuard(stored)),
      ...(instruction === "" ? {} : { instruction }),
      jsonSchema: npcReplyRequest("augment"),
    },
    provider: getProvider(),
    validate: (raw) => validateNpcAugmentReply(raw, stored, campaignRefIds(ctx)),
    correctionTail: CORRECTION_TAIL,
  });
  return withNamingHints(
    result,
    [{ npc: result.id, fields: changedFields(result), body: result.proposed.body }],
    ctx.namingRules,
  );
}

/**
 * POST /api/campaigns/:campaign/npcs/:id/augment/apply — write the fields the
 * DM took from the proposal.
 *
 * The body is the npc's PATCH without `force` — the fields taken, the body
 * assembled from the accepted blocks, and the `rev` the review read — and it
 * is written like any other npc write, because it IS one: rev guard (409
 * `rev_conflict`), FTS, `[[id]]` reference rows, the reference checks, and
 * `jobId` discarding the augment job in the SAME transaction. The id is never
 * proposed, so it cannot be applied either.
 */
export async function applyNpcAugment(
  campaign: string,
  id: string,
  raw: Record<string, unknown>,
  jobId?: string,
): Promise<Npc> {
  const patch = parseRequest(npcPatchSchema.omit({ force: true, id: true }), raw, "npc augment");
  const { rev: _rev, ...fields } = patch;
  if (Object.values(fields).every((value) => value === undefined)) {
    throw new ApiError(400, "nothing to apply");
  }
  return patchNpc(campaign, id, patch, jobId);
}
