// Generator pipeline (generator/README.md):
//
//   1. collect campaign context (npc/location ids+names, chapter, glossary)
//   2. prompt = system-prompt.md + example-output.json + context + source text
//   3. call the LLM provider
//   4. read the reply and validate it MECHANICALLY. EVERY call answers a
//      JSON object whose shape the provider forces: the outline
//      its own small object (shared/outline-schema), a scene call the
//      object that mirrors the stored row — `properties`, `body`,
//      `warnings` (shared/entry-schema, read by ./entry-reply), an npc call
//      every field of the npc plus `warnings` (shared/npc, read by
//      ./npc-reply), a location call every field of the location plus
//      `warnings` (shared/location, read by ./location-reply). Errors
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
// A scene DRAFT IS `{ properties, body }` from the reply to the store
// (ADR #24), and a proposed npc or location is an `NpcProposal` or a
// `LocationProposal` — the entity without its guard (ADR #31): nothing here
// renders one into one markdown text and nothing parses one back.
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
  SCENE_TYPES,
  kindFromAddress,
  type GenerateNpcResult,
  type GenerateUsage,
  type GeneratedSceneDraft,
  type LocationProposal,
  type NamingHint,
  type NpcProposal,
} from "@grimoire/shared";
import { bodyEntityRefSlugs, entityRefSource } from "@grimoire/shared/refs";
import { ENTITY_SLUG } from "@grimoire/shared/slug";
import { ApiError } from "./api-error";
import { assertSafeAddress } from "./addressing";
import type { EntryReply } from "./entry-reply";
import type { LocationReply } from "./location-reply";
import { npcReplyRequest, parseNpcReply, type NpcReply } from "./npc-reply";
import { checkDraftsNaming, type CheckedDraft, type NamingRule } from "./naming-check";
// The generator reads its context and writes its drafts through the store —
// nothing else is a data source.
import { requireCampaign } from "./store/campaigns";
import { buildTree, chapterExists, newChapterBody } from "./store/chapters";
import { knowledgeText, namingRules } from "./store/knowledge";
import { glossaryText } from "./store/glossary";
import { applyDrafts } from "./store/drafts";
import { readLocationProposal } from "./store/locations";
import { npcHoldsContent, readNpcProposal } from "./store/npcs";
import {
  addressHead,
  addressIdentity,
  addressSegments,
  chapterPath,
  scenePath,
} from "./store/paths";
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

/** Directories under a campaign that can never be chapters. */
const RESERVED_DIRS = new Set(["npcs", "locations", "sessions"]);

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
  scene: { systemPrompt: "system-prompt.md", fewShotTarget: "example-output.json" },
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
  // per-scene call sends the scene example asset — so, like `augment`, this
  // entry carries a system prompt alone.
  sceneSingle: { systemPrompt: "scene-single-output.md" },
  // The augment run's OWN system prompt. It has no few-shot of
  // its own — the run sends the TARGET KIND's example asset — so this entry
  // carries the system prompt alone and `loadPromptAssets` is not the right
  // shape for it; see loadAsset below.
  augment: { systemPrompt: "augment-system-prompt.md" },
} as const;

const promptAssets = new Map<string, PromptAssets>();

/**
 * The kinds that have a prompt PAIR. `augment`, `npcAugment`,
 * `locationAugment` and `sceneSingle` do not: the augment runs send the
 * target's example asset, and `sceneSingle` is only an output schema spliced
 * into the scene prompt.
 */
type PromptPairKind = Exclude<
  keyof typeof ASSET_FILES,
  "augment" | "npcAugment" | "locationAugment" | "sceneSingle"
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
   * The run creates its chapter (a „Neues Kapitel" run): the outline then
   * also describes that chapter. False for a run into an existing chapter.
   */
  newChapter: boolean;
}

/** A chapter id is a single, non-hidden path segment. */
function assertSafeChapterId(chapter: string): void {
  if (
    chapter.length === 0 ||
    chapter.startsWith(".") ||
    chapter.includes("/") ||
    chapter.includes("\\") ||
    chapter.includes("\0") ||
    chapter.includes("..")
  ) {
    throw new ApiError(400, "invalid chapter");
  }
  // npcs/locations/sessions exist as directories but are not chapters.
  if (RESERVED_DIRS.has(chapter)) throw new ApiError(404, "chapter not found");
}

/**
 * The cheap request-level checks of a generate target, without touching the
 * LLM: unsafe campaign/chapter id -> 400, unknown campaign/chapter or a
 * reserved dir -> 404. `allowMissingChapter` is the "new chapter" flow:
 * the target directory does not exist yet — it is created on
 * apply, so generating into it must not 404.
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
 * (and its chapter entry) is still missing.
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
// provider was forced into, and the one tolerant reader both the
// outline and the entries share — fence, brace span, ONE `jsonrepair`
// attempt — lives in ./entry-reply (`parseJsonReply`), next to the
// entry shape it is mostly used for.

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
 * The reference rule of a generated body: every `[[id]]` names an entry the
 * campaign has or one the same run proposes (`known`). A reference to nothing
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
        `${entityRefSource(slug)} nennt keinen Eintrag — weder die Kampagne noch dieser ` +
        "Durchlauf hat diese id; nenne eine id aus dem Kontext oder schreibe den Namen als Text",
    );
}

/**
 * An entity id is a kebab slug — the README's stable reference key, and
 * the ONLY thing a model decides about addressing.
 */
const ENTITY_ID_PATTERN = ENTITY_SLUG;

/** The `id` a reply DECLARED, or undefined — the schema's `null` read as what it means. */
function declaredId(properties: Record<string, unknown>): string | undefined {
  const id = properties.id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * The properties of a scene draft as the review and the store read them: the
 * `id` spelled out, and the title fallen back to it.
 *
 * The fallback is the format's (README: a scene that names no title is shown
 * under its id). It is applied HERE, once, where the draft is built — a reply
 * may legitimately omit the title, and everything downstream reads the
 * properties as they are.
 */
function draftProperties(properties: Record<string, unknown>, id: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...properties, id };
  const title = out.title;
  if (typeof title !== "string" || title === "") out.title = id;
  return out;
}

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
 * Which ids an entry of a scene run may REFERENCE: the campaign's plus the
 * ones the run's OUTLINE decided. The reply is one part of the run and the
 * other ids come from the outline, so the sets are a parameter.
 *
 * `npcIds`/`locationIds` are what a scene's `npcs`/`location` properties may
 * name; `refIds` is what a `[[id]]` in any body of the run may name — every
 * npc, location and scene of the campaign and of the outline.
 */
export interface AllowedRefs {
  npcIds: ReadonlySet<string>;
  locationIds: ReadonlySet<string>;
  refIds: ReadonlySet<string>;
}

/**
 * Mechanical validation of ONE scene entry, the rules of the
 * data contract in one place: the pipeline's per-scene call and the apply
 * re-validation have to judge a scene by exactly the same rules, and the one
 * way to guarantee that is one function.
 *
 * `label` is how the entry is named in an error message; `seenIds` is the
 * duplicate guard of the surrounding run (the single-scene reply shares the
 * set with the outline's ids).
 *
 * Returns the draft, or null with the errors pushed onto `errors`.
 */
export function validateSceneEntry(input: {
  reply: EntryReply;
  label: string;
  chapter: string;
  allowed: AllowedRefs;
  seenIds: Set<string>;
  errors: string[];
  /** The id the OUTLINE assigned — a pipeline part may not change its own. */
  expectedId?: string;
}): GeneratedSceneDraft | null {
  const { reply, chapter, allowed, seenIds, errors } = input;
  // The scene's ADDRESS is the server's: `<chapter>/<id>`, with the chapter
  // taken from the run's CONTEXT and never from the model. The
  // id is the one thing the model decides here, so it is the one thing
  // validated as an address would be.
  const props = reply.properties;
  const propsId = declaredId(props);
  if (propsId === undefined) {
    errors.push(`${input.label}: "id" fehlt — jede Szene nennt ihre kebab-case id`);
    return null;
  }
  if (!ENTITY_ID_PATTERN.test(propsId)) {
    errors.push(`${input.label}: "id" must be a kebab-case id (a-z, 0-9, single dashes)`);
    return null;
  }
  const label = `scene "${propsId}"`;
  if (input.expectedId !== undefined && propsId !== input.expectedId) {
    errors.push(
      `${label}: die id muss "${input.expectedId}" bleiben — sie kommt aus der Gliederung ` +
        "und andere Szenen verweisen darauf",
    );
    return null;
  }
  if (seenIds.has(propsId)) {
    errors.push(`${label}: duplicate id`);
    return null;
  }
  seenIds.add(propsId);

  if (!(SCENE_TYPES as readonly string[]).includes(String(props.type))) {
    errors.push(`${label}: "type" must be one of ${SCENE_TYPES.join(", ")}`);
  }
  if (props.status !== "draft") {
    errors.push(`${label}: "status" must be "draft"`);
  }
  // The `chapter` key and the scene's ADDRESS have to say the same thing. The
  // address is the run's (`<chapter>/<id>`, never the model's), so a reply
  // that names a different chapter would produce an entry sitting in one
  // chapter while claiming another — the chapter overview groups by the key, the entry
  // tree by the address, and the two would disagree forever after. Cheaper as
  // a correction turn than as a scene the DM has to find and fix by hand.
  if (typeof props.chapter === "string" && props.chapter !== "" && props.chapter !== chapter) {
    errors.push(
      `${label}: "chapter" muss "${chapter}" sein — das Kapitel kommt aus dem Kontext ` +
        "dieses Durchlaufs, nicht aus der Antwort",
    );
  }

  if (props.npcs !== undefined && props.npcs !== null) {
    if (!Array.isArray(props.npcs) || props.npcs.some((n) => typeof n !== "string")) {
      errors.push(`${label}: "npcs" must be an array of npc ids`);
    } else {
      for (const npc of props.npcs as string[]) {
        if (!allowed.npcIds.has(npc)) {
          errors.push(
            `${label}: npc "${npc}" does not exist in the campaign and the outline does not propose it`,
          );
        }
      }
    }
  }
  if (typeof props.location === "string" && props.location !== "") {
    if (!allowed.locationIds.has(props.location)) {
      errors.push(
        `${label}: location "${props.location}" does not exist in the campaign and ` +
          `the outline does not propose it`,
      );
    }
  }

  for (const kind of unknownCallouts(reply.body)) {
    errors.push(
      `${label}: unknown callout "[!${kind}]" — allowed: ${CALLOUT_KINDS.map((k) => `[!${k}]`).join(", ")}`,
    );
  }
  for (const msg of unknownRefErrors(reply.body, allowed.refIds)) errors.push(`${label}: ${msg}`);

  return {
    path: scenePath(chapter, "", propsId),
    properties: draftProperties(props, propsId),
    body: reply.body,
  };
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
 * starting a new one. Every call has one now, so the instruction is the same
 * sentence for the outline and for an entry; an absent name (a provider
 * that forces nothing) simply leaves the reference out.
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
  drafts: readonly CheckedDraft[],
  rules: readonly NamingRule[],
): T {
  const namingHints = checkDraftsNaming(drafts, rules);
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

const SCENE_ITEM_KEYS = new Set(["path", "properties", "body"]);

/** One validated entry ready to be written. */
export interface ApplyTarget {
  rel: string;
  properties: Record<string, unknown>;
  body: string;
}

/**
 * The `properties`/`body` pair of one scene item. A scene draft is those two
 * halves and nothing else, so this is the whole shape check — no text is
 * parsed on the way in, and a body is allowed to be empty.
 */
function itemHalves(
  item: Record<string, unknown>,
  label: string,
): { properties: Record<string, unknown>; body: string } {
  const properties = item.properties;
  if (!isPlainObject(properties)) {
    throw new ApiError(400, `${label}.properties must be an object`);
  }
  const body = item.body;
  if (typeof body !== "string") throw new ApiError(400, `${label}.body must be a string`);
  return { properties, body };
}

function assertKnownKeys(item: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) throw new ApiError(400, `${label}: unknown key "${key}"`);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Deep-validate one scene item of the apply body -> write target. */
export function applySceneTarget(item: unknown, index: number): ApplyTarget {
  const label = `scenes[${index}]`;
  if (!isPlainObject(item)) throw new ApiError(400, `${label} must be an object`);
  assertKnownKeys(item, SCENE_ITEM_KEYS, label);
  const rel = item.path;
  if (typeof rel !== "string") throw new ApiError(400, `${label}.path must be a string`);
  const { properties, body } = itemHalves(item, label);
  assertSafeAddress(rel); // 400 on traversal/absolute/hidden
  // `<chapter>/<id>` and nothing else: the group segment of
  // a scene address is its `location`, which the SERVER derives on the way in
  // (`draftAddress`). A client that still sends a three-segment path is
  // naming a group of its own, and that is exactly the contradiction between
  // address and `location` that the two-segment rule rules out.
  const segments = addressSegments(rel);
  if (segments.length !== 2 || RESERVED_DIRS.has(segments[0]!)) {
    throw new ApiError(400, `${label}.path must be "<chapter>/<scene-id>"`);
  }
  // The last segment is the SCENE ID whenever the properties carry none
  // (`draftAddress` only overrides it when there is one, and `insertDraft`
  // falls back to the locator id). So it has to obey the same address
  // contract as an explicit `id` does — otherwise `01-x/foo.md` inserts a
  // row whose id contradicts the addressing and cannot be opened again.
  if (!ENTITY_ID_PATTERN.test(segments[1]!)) {
    throw new ApiError(400, `${label}.path: "${segments[1]!}" is not a scene id`);
  }
  // Re-validation (apply is a separate request — never trust the client):
  // the draft must still be a draft.
  if (properties.status !== "draft") {
    throw new ApiError(400, `${label}: "status" must be "draft"`);
  }
  return { rel, properties, body };
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
): Promise<ApplyTarget | null> {
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
 * The new-chapter flow: `chapter` + `chapterTitle` mean "the
 * drafts go into a chapter that does not exist yet". Returns the
 * chapter entry to create in the same batch, or null when the
 * chapter is already there (idempotent — an existing chapter is not a
 * conflict, and its text is never touched). Minimal properties per the format
 * (id/title/status: planned — a generator-created chapter is upcoming,
 * never the active one); the text is the run's chapter description, or empty
 * when there is none.
 */
export async function newChapterTarget(
  campaign: string,
  chapter: unknown,
  chapterTitle: unknown,
  description?: string,
): Promise<ApplyTarget | null> {
  if (chapter === undefined && chapterTitle === undefined) return null;
  if (typeof chapter !== "string" || typeof chapterTitle !== "string") {
    throw new ApiError(400, "chapter and chapterTitle must be sent together as strings");
  }
  const title = chapterTitle.replace(/\s*\r?\n\s*/g, " ").trim();
  if (title === "") throw new ApiError(400, "chapterTitle must be a non-empty string");
  assertSafeChapterId(chapter); // 400 unsafe id, 404 reserved dirs
  const rel = chapterPath(chapter);
  // An existing chapter is not a conflict — idempotent, as before.
  if (await chapterExists(campaign, chapter)) return null;
  return {
    rel,
    properties: { id: chapter, title, status: "planned" },
    body: newChapterBody(description),
  };
}

/**
 * Write the reviewed run (as ROWS). Validates ALL scene drafts, npcs and
 * locations first (400), then checks ALL targets for conflicts (409 with the
 * conflicting scene paths, npc ids and location ids, nothing partially
 * written), then inserts them in ONE transaction — which is what "all or
 * nothing" means literally. Returns the written scene addresses, npc ids and
 * location ids.
 *
 * `chapter`/`chapterTitle` (both or neither) add the chapter's chapter entry
 * to the SAME all-or-nothing batch when it does not exist yet — the app's
 * new-chapter flow.
 *
 * `npcs` are proposed npcs, each an npc without its guard — a scene run's
 * and the NPC run's one npc alike: conflict handling, atomic writes and the
 * job cleanup are identical.
 *
 * `jobId` is the background job the drafts came from: a
 * successful apply discards it — in the SAME transaction as the writes,
 * so a crash can never leave a finished job behind whose drafts are
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
): Promise<{ written: string[]; npcs: string[]; locations: string[] }> {
  await requireCampaign(campaign);
  const { scenes, chapter, chapterTitle } = body;

  if (scenes !== undefined && !Array.isArray(scenes)) {
    throw new ApiError(400, "scenes must be an array");
  }
  if (body.npcs !== undefined && !Array.isArray(body.npcs)) {
    throw new ApiError(400, "npcs must be an array");
  }
  if (body.locations !== undefined && !Array.isArray(body.locations)) {
    throw new ApiError(400, "locations must be an array");
  }
  const targets: ApplyTarget[] = ((scenes as unknown[] | undefined) ?? []).map(applySceneTarget);
  const npcs = ((body.npcs as unknown[] | undefined) ?? []).map(applyNpcItem);
  const locations = ((body.locations as unknown[] | undefined) ?? []).map(applyLocationItem);
  if (targets.length === 0 && npcs.length === 0 && locations.length === 0) {
    throw new ApiError(400, "nothing to apply");
  }

  // The chapter entry comes first — the drafts live inside it.
  const chapterEntry = await newChapterTarget(campaign, chapter, chapterTitle);
  if (chapterEntry !== null) targets.unshift(chapterEntry);

  const drafts = targets.map((t) => {
    const properties = storedDraftProperties(t.properties, t.rel);
    // The ADDRESS the entity will have (store/paths) — for a scene that is
    // `<chapter>/<group>/<id>`, derived from the PROPERTIES id, because
    // that is the key `insertDraft` writes under. The model's last segment is
    // not part of the addressing, so it must not decide anything
    // here either: checking the path-derived id while inserting the
    // properties id would let a colliding draft past the 409 and into a
    // primary-key violation.
    return {
      rel: t.rel,
      address: draftAddress(t.rel, properties),
      properties,
      body: t.body,
    };
  });

  // By IDENTITY, not by address: a scene's address carries its `location`, so
  // two drafts with the same id under different locations
  // are two addresses for ONE row — and the row is what the insert claims.
  const seen = new Set<string>();
  for (const draft of drafts) {
    const key = addressIdentity(draft.address);
    if (seen.has(key)) throw new ApiError(400, `duplicate target path: ${draft.rel}`);
    seen.add(key);
  }

  // The conflict check runs in the SAME transaction as the inserts — see
  // store/drafts.ts `applyDrafts`. Asking here first would leave a window
  // between "free" and "inserted" in which a target could appear, and the
  // documented `409 { conflicts }` would become a primary-key violation (a
  // 500). It asks by ADDRESS, i.e. by id, which is the key — so a draft that
  // collides with an existing entity is caught even when the model chose a
  // different last segment for it; the conflict is REPORTED under the path
  // the client sent, which is the draft it has to fix.
  await applyDrafts(campaign, drafts, { npcs, locations, jobId });
  return {
    written: drafts.map((draft) => draft.address),
    npcs: npcs.map((npc) => npc.id),
    locations: locations.map((location) => location.id),
  };
}

/**
 * The properties a draft is STORED with, checked and degraded in one step.
 *
 * The `id` BECOMES THE PRIMARY KEY of the inserted row (and, for a scene, the
 * id segment of its address). It arrives from a client payload and was taken
 * on trust: `id: "a/b"` inserted a row whose address parses as a different
 * path — unreachable through `GET /entries`, i.e. content written and lost in
 * the same request. So an `id` that is THERE has to be usable.
 *
 * A BLANK one is not there: it is dropped here, and the store then falls the
 * id back to the address's last segment — the only stable identity such a
 * draft has, and an address the validation has already constrained.
 */
export function storedDraftProperties(
  properties: Record<string, unknown>,
  rel: string,
): Record<string, unknown> {
  const id = properties.id;
  if (typeof id === "string" && id.trim() === "") {
    const rest = { ...properties };
    delete rest.id;
    return rest;
  }
  assertDraftId(id, rel);
  return properties;
}

/**
 * The id rule itself — 422 like the generator's other content rejections: the
 * payload is well-formed, its CONTENT is unusable.
 */
export function assertDraftId(id: unknown, rel: string): void {
  if (id === undefined) return;
  if (typeof id !== "string" || !ENTITY_ID_PATTERN.test(id.trim())) {
    throw new ApiError(
      422,
      `${rel}: "id" must be a kebab-case slug (a-z, 0-9, single dashes) — ` +
        `"${String(id)}" cannot be addressed`,
    );
  }
}

/**
 * Where a draft will live: its address. For a SCENE that is
 * `<chapter>/<location>/<id>` — the chapter from the draft's own path (the
 * run's chapter), the id from the properties, and the GROUP from the
 * properties `location`. Nothing about the group is taken from the path:
 * taking it from there would make a corrected `location` and the stored
 * address disagree. For a chapter the address is the path — its id IS the
 * first segment.
 *
 * An unusable `location` is NOT rejected here — `insertDraft` does that, in
 * the transaction, with the code the app has a sentence for.
 */
export function draftAddress(rel: string, properties: Record<string, unknown>): string {
  if (kindFromAddress(rel) !== "scene") return rel;
  const segments = addressSegments(rel);
  const chapterId = addressHead(rel);
  const propsId = typeof properties.id === "string" ? properties.id.trim() : "";
  const id = propsId === "" ? (segments[segments.length - 1] ?? "") : propsId;
  const location = typeof properties.location === "string" ? properties.location.trim() : "";
  return scenePath(chapterId, ENTITY_ID_PATTERN.test(location) ? location : "", id);
}
