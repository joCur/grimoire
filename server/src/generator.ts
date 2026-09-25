// Generator pipeline (generator/README.md):
//
//   1. collect campaign context (npc/location ids+names, chapter, glossary)
//   2. prompt = system-prompt.md + example-output.json + context + source text
//   3. call the LLM provider
//   4. read the reply and validate it MECHANICALLY. EVERY call answers a
//      JSON object whose shape the provider forces: the outline
//      its own small object (shared/outline-schema), a scene call every
//      field of the scene plus `warnings` (shared/scene, read by
//      ./scene-reply), an npc call every field of the npc plus `warnings`
//      (shared/npc, read by ./npc-reply), a location call every field of the
//      location plus `warnings` (shared/location, read by ./location-reply).
//      Errors
//      go back to the model as a correction turn (LLM_CORRECTION_TURNS,
//      default 1, max 2), never to the user; exhausted retries
//      -> 422.
//      A TRUNCATED reply (the provider saw finish_reason/stop_reason) skips
//      the correction turns entirely: re-asking for the same oversized JSON
//      cannot succeed and a correction turn resends the whole prompt plus
//      the previous reply — the most expensive retry there is.
//   5. the app shows the result as a review preview — generating writes
//      NOTHING; only POST /generate/apply stores anything, and it
//      re-validates server-side instead of trusting the client.
//
// A proposed scene, npc or location is a `SceneProposal`, an `NpcProposal`
// or a `LocationProposal` — the entity without its guard (ADR #31): nothing
// here renders one into one markdown text and nothing parses one back.
//
// Steps 1-4 run in the BACKGROUND: POST /generate starts a
// job (./generate-jobs) and answers 202, the result waits in the job store
// until it is applied or discarded. runGenerate itself is unchanged by that
// — it is the job runner's one call.
//
// There is a SECOND run kind next to scenes: one npc from source material
// (runGenerateNpc, POST /generate/npc). It shares everything that is
// mechanics — provider factory, correction turns, truncation fail-fast, usage
// accounting (runPipeline) and the accept — and differs only in its prompt
// assets (generator/npc-*.md), its context (no chapter), its reply (the npc's
// own, ./npc-reply) and its validation rules (validateNpcReply). Still ONE
// job per campaign, whatever its kind.
//
// The provider is resolved lazily (per request, after the cheap request
// checks), so the read-only API never needs an API key (see server.ts).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALLOUT_KINDS,
  type ChapterProposal,
  type GenerateNpcResult,
  type GenerateUsage,
  type LocationProposal,
  type NamingHint,
  type NpcProposal,
  type SceneProposal,
} from "@grimoire/shared";
import { bodyEntityRefSlugs, entityRefSource } from "@grimoire/shared/refs";
import { ENTITY_SLUG } from "@grimoire/shared/slug";
import { ApiError } from "./api-error";
import type { LocationReply } from "./location-reply";
import { npcReplyRequest, parseNpcReply, type NpcReply } from "./npc-reply";
import { checkProposalsNaming, type CheckedProposal, type NamingRule } from "./naming-check";
import type { SceneReply } from "./scene-reply";
// The generator reads its context and writes its proposals through the store —
// nothing else is a data source.
import { requireCampaign } from "./store/campaigns";
import { buildTree, chapterExists, newChapterBody } from "./store/chapters";
import { knowledgeText, namingRules } from "./store/knowledge";
import { glossaryText } from "./store/glossary";
import { writeGenerated } from "./store/generated";
import { readLocationProposal } from "./store/locations";
import { npcHoldsContent, readNpcProposal } from "./store/npcs";
import { readSceneProposal } from "./store/scenes";
import { assertSafeChapterId } from "./store/shared";
import {
  createProvider,
  type CompletionResult,
  type CorrectionTurn,
  type GenerateRequest,
  type LLMProvider,
} from "./llm-provider";

/**
 * Upper bound for correction turns after the initial call (DECISIONS #6:
 * "max. 2"). The number is configurable BELOW that bound and the default
 * is 1: the non-fixable triggers are gone
 * (truncation, prose around the JSON), and a model that gets an explicit
 * error list back repairs the remaining form errors in the first turn
 * almost always — the second one only costs money.
 */
export const MAX_CORRECTION_TURNS = 2;

/** Default when LLM_CORRECTION_TURNS is unset or unusable. */
export const DEFAULT_CORRECTION_TURNS = 1;

/**
 * `LLM_CORRECTION_TURNS`: how many correction turns one run may spend,
 * 0…MAX_CORRECTION_TURNS. Junk (non-integer, negative, above the bound)
 * falls back to the default instead of failing the run — same spirit as
 * parseMaxTokens in llm-provider.ts: config junk must never take the
 * generator down or push the spend UP.
 */
export function parseCorrectionTurns(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LLM_CORRECTION_TURNS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_CORRECTION_TURNS;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_CORRECTION_TURNS) {
    return DEFAULT_CORRECTION_TURNS;
  }
  return n;
}

/**
 * How much of the model's raw reply travels in a 422 body. Enough to see
 * WHERE a reply broke off, small enough to stay a JSON error body.
 */
export const RAW_REPLY_LIMIT = 4000;

// --- provider resolution ---------------------------------------------------

let providerOverride: LLMProvider | null = null;

/** Test-only hook: route requests through a fake provider (null resets). */
export function setProviderForTests(provider: LLMProvider | null): void {
  providerOverride = provider;
}

/**
 * Resolve the configured provider — lazily, per generate request. An
 * unconfigured provider (e.g. missing ANTHROPIC_API_KEY) answers 503 with
 * the factory's message; the rest of the API stays usable without a key.
 */
export function obtainProvider(): LLMProvider {
  if (providerOverride !== null) return providerOverride;
  try {
    return createProvider(process.env);
  } catch (err) {
    throw new ApiError(503, err instanceof Error ? err.message : "LLM provider not configured");
  }
}

// --- prompt assets -----------------------------------------------------------

/** Server package dir (parent of src/), same resolution as config.ts. */
const PACKAGE_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
/** The prompt assets ship with the repo — resolved relative to the package. */
const GENERATOR_DIR = path.resolve(PACKAGE_DIR, "../generator");

export interface PromptAssets {
  systemPrompt: string;
  fewShotTarget: string;
}

/**
 * The asset pairs: scenes, npcs, locations and the outline have their own
 * prompt and their own few-shot target, cached per kind after the first
 * read; the augment runs and the single-scene mode carry a prompt alone.
 */
export const ASSET_FILES = {
  // A scene run writes every scene of its outline with this pair, and the
  // scene augment run takes the field section of the prompt and the
  // few-shot from here.
  scene: { systemPrompt: "system-prompt.md", fewShotTarget: "example-output.json" },
  // The scene augment run's own augmentation rule; the scene pair above
  // brings the fields and the few-shot.
  sceneAugment: { systemPrompt: "scene-augment-system-prompt.md" },
  // An npc has a single-call run of its own (the NPC run), and a scene run
  // loads this pair for every npc its outline proposes; the npc augment run
  // takes the field section of the prompt and the few-shot from here.
  npc: { systemPrompt: "npc-system-prompt.md", fewShotTarget: "npc-example-output.json" },
  // The npc augment run's own augmentation rule; the npc pair above brings
  // the fields and the few-shot.
  npcAugment: { systemPrompt: "npc-augment-system-prompt.md" },
  // Locations have no single-call run of their own: a scene run loads this
  // pair for every location its outline proposes, and the location augment
  // run takes the field section of the prompt and the few-shot from here.
  location: {
    systemPrompt: "location-system-prompt.md",
    fewShotTarget: "location-example-output.json",
  },
  // The location augment run's own augmentation rule; the location pair
  // above brings the fields and the few-shot.
  locationAugment: { systemPrompt: "location-augment-system-prompt.md" },
  // The OUTLINE step of a pipelined scene run: its own prompt
  // and its own few-shot (a worked example outline, not a target draft).
  outline: {
    systemPrompt: "outline-system-prompt.md",
    fewShotTarget: "outline-example-output.json",
  },
  // The output-schema section that turns the scene prompt into
  // single-scene-from-outline mode. No few-shot of its own — the
  // per-scene call sends the scene example asset — so, like the augment
  // rules, this carries a system prompt alone.
  sceneSingle: { systemPrompt: "scene-single-output.md" },
} as const;

const promptAssets = new Map<string, PromptAssets>();

/**
 * The kinds that have a prompt PAIR. `sceneAugment`, `npcAugment`,
 * `locationAugment` and `sceneSingle` do not: the augment runs send the
 * entity's example asset, and `sceneSingle` is only an output schema spliced
 * into the scene prompt.
 */
type PromptPairKind = Exclude<
  keyof typeof ASSET_FILES,
  "sceneAugment" | "npcAugment" | "locationAugment" | "sceneSingle"
>;

export async function loadPromptAssets(kind: PromptPairKind): Promise<PromptAssets> {
  const cached = promptAssets.get(kind);
  if (cached !== undefined) return cached;
  const names = ASSET_FILES[kind];
  const assets: PromptAssets = {
    systemPrompt: await readFile(path.join(GENERATOR_DIR, names.systemPrompt), "utf8"),
    fewShotTarget: await readFile(path.join(GENERATOR_DIR, names.fewShotTarget), "utf8"),
  };
  promptAssets.set(kind, assets);
  return assets;
}

/** One prompt asset by its name in `generator/`, cached — the augment run mixes two pairs. */
const assetCache = new Map<string, string>();

export async function loadAsset(name: string): Promise<string> {
  const cached = assetCache.get(name);
  if (cached !== undefined) return cached;
  const text = await readFile(path.join(GENERATOR_DIR, name), "utf8");
  assetCache.set(name, text);
  return text;
}

// --- context collection ------------------------------------------------------

/**
 * What every run sends along: the campaign's npc/location ids + names (so the
 * model can only REFERENCE what exists), the CAMPAIGN KNOWLEDGE and the
 * glossary.
 */
export interface CampaignContext {
  npcs: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  /**
   * The binding knowledge block — `""` when the campaign has
   * none, and then the prompt has no such section at all.
   */
  knowledge: string;
  glossary: string;
  /**
   * The naming conventions of that knowledge, for the POST-RUN check
   * (naming-check.ts). Collected WITH the context so the run checks against
   * the same rules it prompted with, even if the DM edits them meanwhile.
   */
  namingRules: NamingRule[];
  npcIds: Set<string>;
  locationIds: Set<string>;
  /**
   * The campaign's scene ids. A scene is the third kind a `[[id]]` can name
   * (@grimoire/shared/refs), so the reference check needs them next to the
   * npc and location ids.
   */
  sceneIds: Set<string>;
}

/** A scene run additionally targets one chapter. */
export interface SceneContext extends CampaignContext {
  chapter: string;
  /**
   * The run creates its chapter (a new-chapter run): the outline then
   * also describes that chapter. False for a run into an existing chapter.
   */
  newChapter: boolean;
}

/**
 * The cheap request-level checks of a generate target, without touching the
 * LLM: unsafe campaign/chapter id -> 400, unknown campaign/chapter -> 404.
 * `allowMissingChapter` is the "new chapter" flow: the chapter does not exist
 * yet — it is created on apply, so generating into it must not 404.
 *
 * Exported because POST /generate runs these BEFORE it creates a background
 * job: a 400/404 is a request error and must stay a synchronous
 * answer instead of becoming a failed job the DM has to go and read.
 */
export async function assertGenerateTarget(
  campaign: string,
  chapter: string,
  allowMissingChapter = false,
): Promise<void> {
  await requireCampaign(campaign); // 400 unsafe id, 404 unknown campaign
  assertSafeChapterId(chapter);
  if (!(await chapterExists(campaign, chapter)) && !allowMissingChapter) {
    throw new ApiError(404, "chapter not found");
  }
}

/**
 * Cheap request checks of an NPC run: unsafe campaign id -> 400, unknown
 * campaign -> 404, a pinned id that is not a kebab slug -> 400, and a pinned
 * id whose npc already holds something -> 409 `{ id }` (never overwrite — an
 * existing npc is augmented on its own resource). An npc the DM created and
 * left empty is no conflict: the run fills it. Exported for the same reason
 * as assertGenerateTarget: POST /generate/npc runs it BEFORE it creates a
 * background job.
 */
export async function assertNpcGenerateTarget(campaign: string, npcId?: string): Promise<void> {
  await requireCampaign(campaign); // 400 unsafe id, 404 unknown campaign
  if (npcId === undefined) return;
  if (!ENTITY_SLUG.test(npcId)) throw new ApiError(400, "invalid npc id");
  if (await npcHoldsContent(campaign, npcId)) {
    throw new ApiError(409, "npc already exists", { id: npcId });
  }
}

/**
 * Collect the prompt context of an NPC run: the campaign's npcs (collision
 * check + the only allowed relationship targets), its locations and the
 * glossary. No chapter — an NPC run has no target chapter.
 */
async function collectNpcContext(campaign: string, npcId?: string): Promise<CampaignContext> {
  await assertNpcGenerateTarget(campaign, npcId);
  return collectContext(campaign);
}

/**
 * Collect the prompt context of a scene run. Runs the same target checks
 * again (they are cheap and the pipeline must never depend on a caller having
 * done them); the chapter contributes only its id — and, for a new-chapter
 * run, that fact — to the context, so nothing else changes when the chapter
 * is still missing.
 */
export async function collectSceneContext(
  campaign: string,
  chapter: string,
  newChapter = false,
): Promise<SceneContext> {
  await assertGenerateTarget(campaign, chapter, newChapter);
  return { ...(await collectContext(campaign)), chapter, newChapter };
}

/**
 * The part of the context that is the same for every run kind. Reads the
 * campaign's npcs/locations out of the tree query and the glossary out of its
 * TABLE — rendered as the `EN → DE` lines the prompt documents,
 * so the prompt text the LLM sees is the same as before.
 */
export async function collectContext(campaign: string): Promise<CampaignContext> {
  const tree = await buildTree(campaign);
  const npcs = tree.npcs.map((n) => ({ id: n.id, name: n.name }));
  const locations = tree.locations.map((l) => ({ id: l.id, name: l.name }));
  const glossary = (await glossaryText(campaign)) ?? "";
  // The knowledge block travels with EVERY run kind, and its
  // `[[slug]]` references are already resolved by knowledgeText.
  const knowledge = (await knowledgeText(campaign)) ?? "";

  return {
    npcs,
    locations,
    knowledge,
    glossary,
    namingRules: await namingRules(campaign),
    npcIds: new Set(npcs.map((n) => n.id)),
    locationIds: new Set(locations.map((l) => l.id)),
    sceneIds: new Set(tree.chapters.flatMap((chapter) => chapter.scenes.map((s) => s.id))),
  };
}

// --- reading a reply --------------------------------------------------------
//
// There is nothing left to extract here. Every reply is a JSON object the
// provider was forced into, and the one tolerant reader every call shares —
// fence, brace span, ONE `jsonrepair` attempt — lives in ./json-reply
// (`parseJsonReply`).

// --- mechanical validation (generator/README.md step 4) ----------------------

const KNOWN_CALLOUTS = new Set<string>(CALLOUT_KINDS);
/** `> [!kind]` markers at line starts (nested `>>` included). */
const CALLOUT_MARKER = /^\s*>+\s*\[!([^\]\s]+)\]/gm;

export function unknownCallouts(body: string): string[] {
  const unknown: string[] = [];
  for (const m of body.matchAll(CALLOUT_MARKER)) {
    const kind = m[1]!.toLowerCase();
    if (!KNOWN_CALLOUTS.has(kind) && !unknown.includes(m[1]!)) unknown.push(m[1]!);
  }
  return unknown;
}

/**
 * Every id a `[[id]]` in a generated body may name without the run proposing
 * it: the campaign's npcs, locations and scenes — the three kinds a reference
 * resolves to (@grimoire/shared/refs `ENTITY_REF_KINDS`).
 */
export function campaignRefIds(ctx: CampaignContext): Set<string> {
  return new Set([...ctx.npcIds, ...ctx.locationIds, ...ctx.sceneIds]);
}

/**
 * The reference rule of a generated body: every `[[id]]` names a scene, npc
 * or location the campaign has or one the same run proposes (`known`). A reference to nothing
 * would reach the DM as bracketed text instead of a name, so it is a
 * correction turn like every other mechanical error.
 *
 * It reads the body with the grammar the renderer and the search index use
 * (@grimoire/shared/refs): only a kebab-case slug in double brackets is a
 * reference, and one inside a code span or a fenced block is literal text and
 * not checked. WHERE in the body a reference stands does not matter.
 */
export function unknownRefErrors(body: string, known: ReadonlySet<string>): string[] {
  return bodyEntityRefSlugs(body)
    .filter((slug) => !known.has(slug))
    .map(
      (slug) =>
        `${entityRefSource(slug)} nennt nichts — weder die Kampagne noch dieser ` +
        "Durchlauf hat diese id; nenne eine id aus dem Kontext oder schreibe den Namen als Text",
    );
}

/**
 * An entity id is a kebab slug — the README's stable reference key, and
 * the ONLY thing a model decides about addressing.
 */
const ENTITY_ID_PATTERN = ENTITY_SLUG;

/**
 * Validate one proposed NPC of a scene run, read by the npc's reply schema
 * (./npc-reply.ts): its `id` is its key and has to be a kebab slug. Returns
 * the proposal or pushes errors.
 */
export function validateNpcProposal(reply: NpcReply, errors: string[]): NpcProposal | null {
  const { npc } = reply;
  if (!ENTITY_ID_PATTERN.test(npc.id)) {
    errors.push(`npc "${npc.id}": "id" must be a kebab-case id (a-z, 0-9, single dashes)`);
    return null;
  }
  return npc;
}

/**
 * Validate one proposed LOCATION of a scene run, read by the location's
 * reply schema (./location-reply.ts): its `id` is its key and has to be a
 * kebab slug. Returns the proposal or pushes errors.
 */
export function validateLocationProposal(
  reply: LocationReply,
  errors: string[],
): LocationProposal | null {
  const { location } = reply;
  if (!ENTITY_ID_PATTERN.test(location.id)) {
    errors.push(
      `location "${location.id}": "id" must be a kebab-case id (a-z, 0-9, single dashes)`,
    );
    return null;
  }
  return location;
}

/**
 * Which ids a proposal of a scene run may REFERENCE: the campaign's plus the
 * ones the run's OUTLINE decided. The reply is one part of the run and the
 * other ids come from the outline, so the sets are a parameter.
 *
 * `npcIds`/`locationIds` are what a scene's `npcs`/`location` fields may
 * name; `refIds` is what a `[[id]]` in any body of the run may name — every
 * npc, location and scene of the campaign and of the outline.
 */
export interface AllowedRefs {
  npcIds: ReadonlySet<string>;
  locationIds: ReadonlySet<string>;
  refIds: ReadonlySet<string>;
}

/**
 * Mechanical validation of ONE proposed scene of a scene run, read by the
 * scene's reply schema (./scene-reply.ts): its id is the one the OUTLINE
 * assigned and a kebab slug, its chapter is the run's, the npcs and the
 * location it names exist in the campaign or the outline, and its body uses
 * known callouts and references that resolve. A NEW scene's reply can only
 * be a draft — its schema says so.
 *
 * Returns the scene, or null with the errors pushed onto `errors`.
 */
export function validateSceneProposal(input: {
  reply: SceneReply;
  chapter: string;
  allowed: AllowedRefs;
  errors: string[];
  /** The id the OUTLINE assigned — a pipeline part may not change its own. */
  expectedId: string;
}): SceneProposal | null {
  const { reply, chapter, allowed, errors, expectedId } = input;
  const { scene } = reply;
  if (!ENTITY_ID_PATTERN.test(scene.id)) {
    errors.push(`scene "${expectedId}": "id" must be a kebab-case id (a-z, 0-9, single dashes)`);
    return null;
  }
  const label = `scene "${scene.id}"`;
  if (scene.id !== expectedId) {
    errors.push(
      `${label}: die id muss "${expectedId}" bleiben — sie kommt aus der Gliederung ` +
        "und andere Szenen verweisen darauf",
    );
    return null;
  }
  // The chapter is the run's, never the model's: a reply that names another
  // would produce a scene sitting in one chapter while the run was about
  // another. Cheaper as a correction turn than as a scene the DM has to find
  // and move by hand.
  if (scene.chapter !== chapter) {
    errors.push(
      `${label}: "chapter" muss "${chapter}" sein — das Kapitel kommt aus dem Kontext ` +
        "dieses Durchlaufs, nicht aus der Antwort",
    );
  }
  for (const npc of scene.npcs) {
    if (!allowed.npcIds.has(npc)) {
      errors.push(
        `${label}: npc "${npc}" does not exist in the campaign and the outline does not propose it`,
      );
    }
  }
  if (scene.location !== undefined && !allowed.locationIds.has(scene.location)) {
    errors.push(
      `${label}: location "${scene.location}" does not exist in the campaign and ` +
        `the outline does not propose it`,
    );
  }
  for (const kind of unknownCallouts(scene.body)) {
    errors.push(
      `${label}: unknown callout "[!${kind}]" — allowed: ${CALLOUT_KINDS.map((k) => `[!${k}]`).join(", ")}`,
    );
  }
  for (const msg of unknownRefErrors(scene.body, allowed.refIds)) errors.push(`${label}: ${msg}`);
  return errors.length > 0 ? null : scene;
}

// --- mechanical validation of an NPC reply -----------------------------------

/**
 * Mechanical validation of one raw NPC reply against the campaign context.
 * Same contract as every other validator: the mapped result, or the error
 * list for the correction turn.
 *
 * The reply is the npc's own schema-forced object (./npc-reply): every field
 * of the npc, `body` among them, and `warnings`. The rules: an `id` that is a
 * kebab-case id, the pinned id when the DM set one, no id the campaign
 * already has, no `chapter` (an NPC run has no target chapter), only known
 * callouts, and every `[[id]]` of the body naming something of the campaign
 * or the npc itself. The DM can pin a different id via the request's `id`.
 *
 * No rule looks for a heading (ADR #29): the sections of an npc body are the
 * prompt's recommendation, and the text under them is the model's prose.
 */
export function validateNpcReply(
  raw: string,
  ctx: CampaignContext,
  pinnedId?: string,
): { ok: true; result: GenerateNpcResult } | { ok: false; errors: string[] } {
  const read = parseNpcReply(raw);
  if (!read.ok) return { ok: false, errors: read.errors.map((e) => `npc: ${e}`) };
  const { npc, warnings } = read.reply;
  if (!ENTITY_ID_PATTERN.test(npc.id)) {
    return {
      ok: false,
      errors: ['npc: "id" muss eine kebab-case id sein (a-z, 0-9, einzelne Bindestriche)'],
    };
  }
  const label = `npc "${npc.id}"`;
  const errors: string[] = [];
  if (pinnedId !== undefined && npc.id !== pinnedId) {
    errors.push(`${label}: die id ist vorgegeben — "id" muss "${pinnedId}" sein`);
  }
  if (ctx.npcIds.has(npc.id) && npc.id !== pinnedId) {
    errors.push(
      `${label}: id "${npc.id}" existiert schon in der Kampagne — andere id wählen ` +
        '(oder der DM gibt eine id über das Feld "id" vor)',
    );
  }
  if (npc.chapter !== undefined) {
    errors.push(`${label}: "chapter" ist null — der NPC-Lauf kennt kein Ziel-Kapitel`);
  }
  for (const kind of unknownCallouts(npc.body)) {
    errors.push(
      `${label}: unknown callout "[!${kind}]" — allowed: ${CALLOUT_KINDS.map((k) => `[!${k}]`).join(", ")}`,
    );
  }
  // The npc itself is the one thing this run proposes.
  const known = campaignRefIds(ctx).add(npc.id);
  for (const msg of unknownRefErrors(npc.body, known)) errors.push(`${label}: ${msg}`);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, result: { npc, warnings } };
}

/**
 * The correction turn's message — German on purpose: it is part of the
 * (German) prompt conversation. The tail names what the corrected reply must
 * still contain, which is the only part that differs between the run kinds.
 *
 * `schemaName` is the schema the reply is forced into — it is
 * NAMED here so the model corrects inside the shape it was given instead of
 * starting a new one. Every call has one, so the instruction is the same
 * sentence for the outline and for a scene, npc or location; an absent name
 * (a provider that forces nothing) simply leaves the reference out.
 */
export function buildCorrectionMessage(
  errors: string[],
  tail: string,
  schemaName?: string,
): string {
  const schema = schemaName === undefined ? "gleiches Schema" : `gleiches Schema (\`${schemaName}\`)`;
  const instruction =
    `Antworte erneut mit dem vollständigen, korrigierten JSON-Objekt — ${schema}, ` +
    `${tail}, kein Text außerhalb des Objekts.`;
  return [
    "Deine letzte Antwort hat die mechanische Validierung nicht bestanden:",
    errors.map((e) => `- ${e}`).join("\n"),
    instruction,
  ].join("\n\n");
}

const NPC_CORRECTION_TAIL = "den vollständigen NPC enthalten";

// --- run accounting ----------------------------------------------------------

/** The raw reply for a 422 body: capped, and honest about being capped. */
export function capRawReply(raw: string): string {
  return raw.length <= RAW_REPLY_LIMIT ? raw : `${raw.slice(0, RAW_REPLY_LIMIT)}… [gekürzt]`;
}

/**
 * Token spend of one run. Every provider call is counted; the token numbers
 * are only reported when at least one call carried usage (a local endpoint
 * may report none — then `usage()` stays undefined instead of claiming 0).
 */
class RunUsage {
  private attempts = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  // Log-only: how much of the input was a cache hit. It is NOT
  // added to the reported usage — a cached token was still sent, and the
  // review's token figure is the size of the prompt, not its price.
  private cachedInputTokens = 0;
  private reported = false;

  add(completion: CompletionResult): void {
    this.attempts += 1;
    if (completion.usage === undefined) return;
    this.reported = true;
    this.inputTokens += completion.usage.inputTokens;
    this.outputTokens += completion.usage.outputTokens;
    this.cachedInputTokens += completion.usage.cachedInputTokens ?? 0;
  }

  usage(): GenerateUsage | undefined {
    if (!this.reported) return undefined;
    const { inputTokens, outputTokens, attempts } = this;
    return { inputTokens, outputTokens, attempts };
  }

  /** One line per run, so an expensive run is visible in the server log. */
  log(providerName: string, outcome: string): void {
    const usage = this.usage();
    const tokens =
      usage === undefined
        ? "tokens unknown"
        : `${usage.inputTokens} in / ${usage.outputTokens} out` +
          // Only when something was actually cached: on the paths without
          // caching the line stays the one it always was.
          (this.cachedInputTokens > 0 ? ` (${this.cachedInputTokens} cached)` : "");
    console.log(
      `generate: ${providerName}, ${this.attempts} attempt(s), ${tokens} — ${outcome}`,
    );
  }
}

/**
 * The truncation message — the ENGLISH technical fallback next to
 * `code: "llm_truncated"`; the sentence the DM reads is built by
 * the app from `maxTokens`. It names the effective cap so the number to raise
 * is unambiguous; see the LLM_MAX_TOKENS section of docs/DEPLOYMENT.md.
 */
export function truncationMessage(maxTokens: number | undefined): string {
  const current = maxTokens === undefined ? "the endpoint default" : String(maxTokens);
  return (
    `the model's reply was cut off — raise LLM_MAX_TOKENS ` +
    `(currently: ${current}) or shorten the source text.`
  );
}

/**
 * Attach the naming check's findings to a result. Its own function so the
 * runs cannot drift apart on it, and so the "no rules,
 * no field" case is spelled once: with nothing to report the key stays
 * ABSENT rather than becoming an empty array every client has to ignore.
 */
export function withNamingHints<T extends { namingHints?: NamingHint[] }>(
  result: T,
  proposals: readonly CheckedProposal[],
  rules: readonly NamingRule[],
): T {
  const namingHints = checkProposalsNaming(proposals, rules);
  return namingHints.length === 0 ? result : { ...result, namingHints };
}

/**
 * The provider loop itself, shared by both run kinds so the
 * mechanics can only ever be IDENTICAL: correction turns bounded by
 * LLM_CORRECTION_TURNS, truncation fail-fast before any validation, usage
 * summed over every call, and the raw reply in both 422 bodies.
 *
 * `validate` is the only difference between a scene run and an NPC run.
 */
export async function runPipeline<T extends { usage?: GenerateUsage }>(input: {
  req: GenerateRequest;
  provider: LLMProvider;
  validate: (raw: string) => { ok: true; result: T } | { ok: false; errors: string[] };
  correctionTail: string;
  /**
   * Called once per provider call. The pipeline counts its own
   * calls with it: `usage` is absent whenever the endpoint reports no tokens,
   * so the run's call count cannot be read off it — and a part that FAILED
   * has to contribute its attempts to the total as well.
   */
  onCall?: () => void;
}): Promise<T> {
  const { req, provider, validate } = input;
  const corrections: CorrectionTurn[] = [];
  // Read once per run: the bound must not change under a running loop.
  const maxCorrections = parseCorrectionTurns();
  const spend = new RunUsage();
  for (;;) {
    const completion = await provider.complete(req, corrections);
    input.onCall?.();
    spend.add(completion);
    const raw = completion.text;

    // Fail fast: a cut-off reply is not a form error the model can fix, and
    // a correction turn would resend prompt + reply at full price.
    if (completion.truncated) {
      spend.log(provider.name, "truncated");
      throw new ApiError(422, truncationMessage(provider.maxTokens), {
        code: "llm_truncated",
        ...(provider.maxTokens === undefined ? {} : { maxTokens: provider.maxTokens }),
        rawReply: capRawReply(raw),
        ...(spend.usage() === undefined ? {} : { usage: spend.usage() }),
      });
    }

    const outcome = validate(raw);
    if (outcome.ok) {
      spend.log(provider.name, "ok");
      const usage = spend.usage();
      return usage === undefined ? outcome.result : { ...outcome.result, usage };
    }
    if (corrections.length >= maxCorrections) {
      spend.log(provider.name, "validation failed");
      throw new ApiError(422, "generation failed mechanical validation after retries", {
        code: "llm_invalid",
        validationErrors: outcome.errors,
        rawReply: capRawReply(raw),
        ...(spend.usage() === undefined ? {} : { usage: spend.usage() }),
      });
    }
    corrections.push({
      assistant: raw,
      correction: buildCorrectionMessage(
        outcome.errors,
        input.correctionTail,
        // The schema the request itself carries — no caller has to repeat it.
        req.jsonSchema?.name,
      ),
    });
  }
}

// --- POST /api/campaigns/:campaign/generate/npc ----------------------------------------

/**
 * Run the NPC pipeline: context -> npc prompt -> provider -> mechanical
 * validation, with the same correction turns, the same truncation fail-fast
 * and the same usage accounting as a scene run (runPipeline). Writes NOTHING;
 * the proposed npc goes into the review and only the accept writes it.
 *
 * `npcId` is the DM's optional pin: it decides the npc's id and is checked
 * for collisions BEFORE the provider is called. Without it the model picks
 * the id (and a collision becomes a correction turn).
 */
export async function runGenerateNpc(
  campaign: string,
  sourceText: string,
  npcId?: string,
  getProvider: () => LLMProvider = obtainProvider,
): Promise<GenerateNpcResult> {
  const ctx = await collectNpcContext(campaign, npcId);
  const assets = await loadPromptAssets("npc");
  const result = await runPipeline({
    req: {
      systemPrompt: assets.systemPrompt,
      fewShotTarget: assets.fewShotTarget,
      knowledge: ctx.knowledge,
      glossary: ctx.glossary,
      context: {
        npcs: ctx.npcs,
        locations: ctx.locations,
        ...(npcId === undefined ? {} : { targetId: npcId }),
      },
      sourceText,
      // The npc's own reply object, forced by the provider — the same
      // guarantee the outline call has always had.
      jsonSchema: npcReplyRequest("create"),
    },
    provider: getProvider(),
    validate: (raw) => validateNpcReply(raw, ctx, npcId),
    correctionTail: NPC_CORRECTION_TAIL,
  });
  const { body, ...fields } = result.npc;
  return withNamingHints(result, [{ npc: result.npc.id, fields, body }], ctx.namingRules);
}

// --- POST /api/campaigns/:campaign/generate/apply -----------------------------------------

/**
 * Deep-validate one proposed scene of the apply body: a scene without its
 * guard, checked against the scene's schema — a key a scene does not have (a
 * `path`, a `properties`) is a 400 that names it —, a kebab id, and a draft:
 * apply is a separate request and never trusts the client.
 */
export function applySceneItem(item: unknown, index: number): SceneProposal {
  const label = `scenes[${index}]`;
  const scene = readSceneProposal(item, label);
  if (!ENTITY_ID_PATTERN.test(scene.id)) {
    throw new ApiError(400, `${label}.id must be a kebab-case slug`);
  }
  if (scene.status !== "draft") throw new ApiError(400, `${label}: "status" must be "draft"`);
  return scene;
}

/**
 * Deep-validate one proposed npc of the apply body: an npc without its
 * guard, checked against the npc's schema — a key an npc does not have (a
 * `kind`, a `properties`) is a 400 that names it — and a kebab id.
 */
export function applyNpcItem(item: unknown, index: number): NpcProposal {
  const label = `npcs[${index}]`;
  const npc = readNpcProposal(item, label);
  if (!ENTITY_ID_PATTERN.test(npc.id)) {
    throw new ApiError(400, `${label}.id must be a kebab-case slug`);
  }
  return npc;
}

/**
 * Deep-validate one proposed location of the apply body: a location without
 * its guard, checked against the location's schema — a key a location does
 * not have (a `status`, a `kind`) is a 400 that names it — and a kebab id.
 */
export function applyLocationItem(item: unknown, index: number): LocationProposal {
  const label = `locations[${index}]`;
  const location = readLocationProposal(item, label);
  if (!ENTITY_ID_PATTERN.test(location.id)) {
    throw new ApiError(400, `${label}.id must be a kebab-case slug`);
  }
  return location;
}

/**
 * The chapter target of a new-chapter run, decided from the JOB.
 *
 * The app must not decide it from its own state: the review state is
 * persistent, so that state is gone after a navigation or a reload, and the
 * scenes would land under a chapter that has no entry of its own — invisible
 * in the overview, together with every scene in it. The run knows what
 * chapter it is for (`generate_jobs.chapter`) and what it is CALLED
 * (`generate_jobs.new_chapter_title`), so the decision is made here and needs
 * no browser.
 *
 * The body fields stay an OVERRIDE for compatibility (an older app build, and
 * the whole-run `POST /generate/apply`, which has no job to read): sent, they
 * decide; absent, the job does. Idempotent either way — an existing chapter
 * yields null.
 */
export async function jobChapterTarget(
  campaign: string,
  job: {
    newChapter: boolean;
    chapter?: string;
    newChapterTitle?: string;
    pipeline?: { outline?: { chapterDescription?: string } };
  },
  bodyChapter: unknown,
  bodyChapterTitle: unknown,
): Promise<ChapterProposal | null> {
  // The description is the OUTLINE's (it read the source material) and only
  // a new-chapter run's outline has one, so it comes from the job on either
  // path: the override names the chapter, it does not describe it.
  const description = job.newChapter ? job.pipeline?.outline?.chapterDescription : undefined;
  if (bodyChapter !== undefined || bodyChapterTitle !== undefined) {
    return newChapterTarget(campaign, bodyChapter, bodyChapterTitle, description);
  }
  if (!job.newChapter || job.chapter === undefined) return null;
  // No stored title (a run started before the column existed) falls back to
  // the id: a chapter called by its slug is at least readable in the
  // overview, an invisible one is not.
  return newChapterTarget(
    campaign,
    job.chapter,
    job.newChapterTitle ?? job.chapter,
    description,
  );
}

/**
 * The new-chapter flow: `chapter` + `chapterTitle` mean "the scenes go into
 * a chapter that does not exist yet". Returns the chapter to create in the
 * same batch, or null when the chapter is already there (idempotent — an
 * existing chapter is not a conflict, and its text is never touched). The
 * chapter is `planned` — a generator-created chapter is upcoming, never the
 * active one —, and its `body` is the run's chapter description, or empty
 * when there is none.
 */
export async function newChapterTarget(
  campaign: string,
  chapter: unknown,
  chapterTitle: unknown,
  description?: string,
): Promise<ChapterProposal | null> {
  if (chapter === undefined && chapterTitle === undefined) return null;
  if (typeof chapter !== "string" || typeof chapterTitle !== "string") {
    throw new ApiError(400, "chapter and chapterTitle must be sent together as strings");
  }
  const title = chapterTitle.replace(/\s*\r?\n\s*/g, " ").trim();
  if (title === "") throw new ApiError(400, "chapterTitle must be a non-empty string");
  assertSafeChapterId(chapter); // 400 unsafe id
  // An existing chapter is not a conflict — idempotent.
  if (await chapterExists(campaign, chapter)) return null;
  return { id: chapter, title, status: "planned", body: newChapterBody(description) };
}

/**
 * Write the reviewed run (as ROWS). Validates ALL scenes, npcs and locations
 * first (400), then checks ALL targets for conflicts (409 with the
 * conflicting scene, npc and location ids, nothing partially written), then
 * inserts them in ONE transaction — which is what "all or nothing" means
 * literally. Returns the written scene, npc and location ids.
 *
 * `chapter`/`chapterTitle` (both or neither) add the chapter to the SAME
 * all-or-nothing batch when it does not exist yet — the app's new-chapter
 * flow.
 *
 * `npcs` are proposed npcs, each an npc without its guard — a scene run's
 * and the NPC run's one npc alike: conflict handling, atomic writes and the
 * job cleanup are identical. The same holds for `scenes` and `locations`.
 *
 * `jobId` is the background job the proposals came from: a
 * successful apply discards it — in the SAME transaction as the writes,
 * so a crash can never leave a finished job behind whose proposals are
 * already stored. A stale id is ignored rather than dropping the wrong job.
 */
export async function applyGenerated(
  campaign: string,
  body: {
    scenes?: unknown;
    npcs?: unknown;
    locations?: unknown;
    chapter?: unknown;
    chapterTitle?: unknown;
  },
  jobId?: string,
): Promise<{ scenes: string[]; npcs: string[]; locations: string[] }> {
  await requireCampaign(campaign);
  const { chapter, chapterTitle } = body;
  for (const key of ["scenes", "npcs", "locations"] as const) {
    if (body[key] !== undefined && !Array.isArray(body[key])) {
      throw new ApiError(400, `${key} must be an array`);
    }
  }
  const scenes = ((body.scenes as unknown[] | undefined) ?? []).map(applySceneItem);
  const npcs = ((body.npcs as unknown[] | undefined) ?? []).map(applyNpcItem);
  const locations = ((body.locations as unknown[] | undefined) ?? []).map(applyLocationItem);
  if (scenes.length === 0 && npcs.length === 0 && locations.length === 0) {
    throw new ApiError(400, "nothing to apply");
  }

  // The chapter comes first — the scenes live inside it. The conflict check
  // runs in the SAME transaction as the inserts (store/generated.ts
  // `writeGenerated`): asking here first would leave a window between "free"
  // and "inserted" in which a target could appear, and the documented
  // `409 { scenes }` would become a primary-key violation (a 500).
  const newChapter = await newChapterTarget(campaign, chapter, chapterTitle);
  await writeGenerated(campaign, {
    ...(newChapter === null ? {} : { chapter: newChapter }),
    scenes,
    npcs,
    locations,
    // Without a job, the chapters the run decided on are the ones its scenes
    // name (ADR #18).
    runChapters: [...new Set(scenes.map((scene) => scene.chapter))],
    jobId,
  });
  return {
    scenes: scenes.map((scene) => scene.id),
    npcs: npcs.map((npc) => npc.id),
    locations: locations.map((location) => location.id),
  };
}
