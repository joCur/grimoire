// Augmenting a LOCATION: the generator pointed at a location that already
// exists, on the location's own resource (ADR #31) —
// `POST …/locations/:id/augment` starts the run and
// `POST …/locations/:id/augment/apply` writes what the DM took.
//
// The mechanics are the generator's (./generator.ts `runPipeline`): same
// provider, same correction turns, same truncation fail-fast, same background
// job, same naming check. What is the location's own:
//
//   1. the prompt shows the location COMPLETE — every field, `body` among
//      them — as the very object the reply is forced into, under the
//      augmentation rule of generator/location-augment-system-prompt.md,
//   2. the reply is read by the location's reply schema (./location-reply.ts)
//      and becomes a PROPOSAL: the location as the run read it beside the
//      location as the model proposes it (`LocationAugmentResult`). The app
//      compares the two field by field and cuts `body` into the
//      Block-Composer's blocks,
//   3. accepting is the location's own PATCH (store/locations.ts
//      `patchLocation`): the fields the DM took, `rev`-guarded, the job
//      discarded in the same transaction.

import {
  CALLOUT_KINDS,
  locationPatchSchema,
  type Location,
  type LocationAugmentResult,
  type LocationProposal,
} from "@grimoire/shared";
import { bodyEntityRefSlugs } from "@grimoire/shared/refs";
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
import { locationReplyRequest, parseLocationReply } from "./location-reply";
import type { LLMProvider } from "./llm-provider";
import { parseRequest } from "./store/shared";
import { patchLocation, readLocation } from "./store/locations";

/** The correction turn's tail — what a corrected reply must still contain. */
const CORRECTION_TAIL = "den vollständigen ergänzten Ort enthalten";

/** The section of the location prompt that describes the location's fields. */
const LOCATION_FORMAT_HEADING = "## Die Felder des Orts";

/** A location without its guard — what the prompt shows and the proposal compares. */
function withoutGuard(location: Location): LocationProposal {
  const { rev: _rev, ...proposal } = location;
  return proposal;
}

/**
 * The system prompt of a location augment run: the augmentation rule for a
 * location, followed by the field section of the location prompt — the
 * fields are described exactly once.
 */
export async function locationAugmentSystemPrompt(): Promise<string> {
  const [rule, format] = await Promise.all([
    loadAsset(ASSET_FILES.locationAugment.systemPrompt),
    loadAsset(ASSET_FILES.location.systemPrompt),
  ]);
  return `${rule.trimEnd()}\n\n${formatContract(format, LOCATION_FORMAT_HEADING)}`;
}

/**
 * Mechanical validation of one raw reply against the location it is about.
 * Returns the PROPOSAL, or the error list for the correction turn.
 *
 * The id stays (ADR #21), only known callouts, and every `[[id]]` the
 * proposal ADDS names something of the campaign — one the stored body
 * already carries is the DM's, and the augmentation rule tells the model to
 * keep it. A location has no `status`: a reply that names one had it dropped
 * as an echo (`ignored`), and it is still an error, because the key is the
 * data contract being broken.
 */
export function validateLocationAugmentReply(
  raw: string,
  stored: Location,
  refIds: ReadonlySet<string>,
): { ok: true; result: LocationAugmentResult } | { ok: false; errors: string[] } {
  const label = `location "${stored.id}"`;
  const read = parseLocationReply(raw, "augment");
  if (!read.ok) return { ok: false, errors: read.errors.map((e) => `${label}: ${e}`) };
  const { location, warnings, ignored } = read.reply;
  const errors: string[] = [];
  if (location.id !== stored.id) {
    errors.push(
      `${label}: die id bleibt "${stored.id}" — sie ist der Referenzschlüssel ` +
        "der Kampagne und wird beim Ergänzen nie geändert",
    );
  }
  if (ignored.includes("status")) {
    errors.push(`${label}: "status" ist nicht erlaubt — ein Ort hat keinen status`);
  }
  for (const callout of unknownCallouts(location.body)) {
    errors.push(
      `${label}: unknown callout "[!${callout}]" — allowed: ` +
        CALLOUT_KINDS.map((k) => `[!${k}]`).join(", "),
    );
  }
  const known = new Set([...refIds, ...bodyEntityRefSlugs(stored.body)]);
  for (const msg of unknownRefErrors(location.body, known)) errors.push(`${label}: ${msg}`);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    result: {
      id: stored.id,
      rev: stored.rev,
      current: withoutGuard(stored),
      proposed: location,
      warnings,
    },
  };
}

/**
 * The fields the proposal CHANGES, by name — what the naming check reads. A
 * field it leaves alone keeps a value the DM authored, and a hint about one
 * of those would be about the campaign rather than about this run.
 */
function changedFields(result: LocationAugmentResult): Record<string, unknown> {
  const current: Record<string, unknown> = result.current;
  const { body: _body, ...proposed } = result.proposed;
  return Object.fromEntries(
    Object.entries(proposed).filter(([key, value]) => !sameValue(current[key], value)),
  );
}

/**
 * Run the augment of one location: context -> prompt -> provider ->
 * validation, with the generator's correction turns, truncation fail-fast
 * and usage accounting. Writes NOTHING.
 *
 * At least one of `sourceText`/`instruction` is required — the route checks
 * that before a job exists, and this asserts it again because the run must
 * never depend on a caller having done it.
 */
export async function runLocationAugment(
  campaign: string,
  id: string,
  input: { sourceText?: string; instruction?: string },
  getProvider: () => LLMProvider = obtainProvider,
): Promise<LocationAugmentResult> {
  const sourceText = (input.sourceText ?? "").trim();
  const instruction = (input.instruction ?? "").trim();
  if (sourceText === "" && instruction === "") {
    throw new ApiError(400, "sourceText or instruction is required");
  }
  const stored = await readLocation(campaign, id);
  const ctx = await collectContext(campaign);
  const [prompt, fewShotTarget] = await Promise.all([
    locationAugmentSystemPrompt(),
    loadAsset(ASSET_FILES.location.fewShotTarget),
  ]);
  const result = await runPipeline({
    req: {
      systemPrompt: prompt,
      fewShotTarget,
      knowledge: ctx.knowledge,
      glossary: ctx.glossary,
      context: { npcs: ctx.npcs, locations: ctx.locations },
      sourceText,
      existingLocation: withoutGuard(stored),
      ...(instruction === "" ? {} : { instruction }),
      jsonSchema: locationReplyRequest("augment"),
    },
    provider: getProvider(),
    validate: (raw) => validateLocationAugmentReply(raw, stored, campaignRefIds(ctx)),
    correctionTail: CORRECTION_TAIL,
  });
  return withNamingHints(
    result,
    [{ location: result.id, fields: changedFields(result), body: result.proposed.body }],
    ctx.namingRules,
  );
}

/**
 * POST /api/campaigns/:campaign/locations/:id/augment/apply — write the
 * fields the DM took from the proposal.
 *
 * The body is the location's PATCH without `force` — the fields taken, the
 * body assembled from the accepted blocks, and the `rev` the review read —
 * and it is written like any other location write, because it IS one: rev
 * guard (409 `rev_conflict`), FTS, `[[id]]` reference rows, the reference
 * checks, and `jobId` discarding the augment job in the SAME transaction. The
 * id is never proposed, so it cannot be applied either.
 */
export async function applyLocationAugment(
  campaign: string,
  id: string,
  raw: Record<string, unknown>,
  jobId?: string,
): Promise<Location> {
  const patch = parseRequest(
    locationPatchSchema.omit({ force: true, id: true }),
    raw,
    "location augment",
  );
  const { rev: _rev, ...fields } = patch;
  if (Object.values(fields).every((value) => value === undefined)) {
    throw new ApiError(400, "nothing to apply");
  }
  return patchLocation(campaign, id, patch, jobId);
}
