// Generator pipeline (GitHub issue #6, generator/README.md):
//
//   1. collect campaign context (npc/location ids+names, chapter, glossary)
//   2. prompt = system-prompt.md + example-output.md + context + source text
//   3. call the LLM provider
//   4. extract the JSON object from the reply (issue #20 — prose around the
//      object is tolerated, the validation itself is not loosened) and
//      validate it MECHANICALLY; errors go back to the model as a
//      correction turn (LLM_CORRECTION_TURNS, default 1, max 2 — issue
//      #19), never to the user; exhausted retries -> 422.
//      A TRUNCATED reply (the provider saw finish_reason/stop_reason) skips
//      the correction turns entirely: re-asking for the same oversized JSON
//      cannot succeed and a correction turn resends the whole prompt plus
//      the previous reply — the most expensive retry there is (issue #18).
//   5. the app shows the result as a review preview — generating writes
//      NOTHING; only POST /generate/apply touches the disk, and it
//      re-validates server-side instead of trusting the client.
//
// Steps 1-4 run in the BACKGROUND since issue #19: POST /generate starts a
// job (./generate-jobs) and answers 202, the result waits in the job store
// until it is applied or discarded. runGenerate itself is unchanged by that
// — it is the job runner's one call.
//
// Since issue #21 there is a SECOND run kind next to scenes: one NPC file
// from source material (runGenerateNpc, POST /generate/npc). It shares
// everything that is mechanics — provider factory, correction turns,
// truncation fail-fast, usage accounting, JSON extraction (runPipeline) and
// the apply endpoint — and differs only in its prompt assets
// (generator/npc-*.md), its context (no chapter) and its validation rules
// (validateNpcReply). Still ONE job per campaign, whatever its kind.
//
// The provider is resolved lazily (per request, after the cheap request
// checks), so the read-only API never needs an API key (see server.ts).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_SCHEMA, dump } from "js-yaml";
import {
  CALLOUT_KINDS,
  NPC_STATUSES,
  SCENE_TYPES,
  kindFromPath,
  parseMarkdown,
  type GenerateNpcResult,
  type GenerateResult,
  type GenerateUsage,
  type GeneratedSceneDraft,
  type GeneratedStub,
  type NamingHint,
  type ParsedFile,
} from "@grimoire/shared";
import { ENTITY_SLUG } from "@grimoire/shared/slug";
import { ApiError, assertSafeAddress } from "./campaign-fs";
import { checkDraftsNaming, type NamingRule } from "./naming-check";
// The generator reads its context and writes its drafts through the store
// (issue #57) — the campaign file tree is not a data source any more.
import {
  buildTree,
  glossaryText,
  knowledgeText,
  namingRules,
  requireCampaign,
} from "./store/read";
import { applyDrafts, chapterExists, draftTargetExists } from "./store/write";
import {
  addressIdentity,
  chapterPath,
  locationPath,
  npcPath,
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
 * "max. 2"). Issue #19 makes the number configurable BELOW that bound and
 * lowers the default to 1: #18/#20 removed the non-fixable triggers
 * (truncation, prose around the JSON), and a model that gets an explicit
 * error list back repairs the remaining form errors in the first turn
 * almost always — the second one only costs money.
 */
export const MAX_CORRECTION_TURNS = 2;

/** Default when LLM_CORRECTION_TURNS is unset or unusable (issue #19). */
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
 * The two asset pairs (issue #21): scenes and NPCs have their own prompt and
 * their own few-shot target file, cached per kind after the first read.
 */
export const ASSET_FILES = {
  scene: { systemPrompt: "system-prompt.md", fewShotTarget: "example-output.md" },
  npc: { systemPrompt: "npc-system-prompt.md", fewShotTarget: "npc-example-output.md" },
  // Issue #36: locations had no prompt of their own — the augment run is the
  // first caller, and the pair is written so a future „Ort generieren" can
  // use it unchanged.
  location: {
    systemPrompt: "location-system-prompt.md",
    fewShotTarget: "location-example-output.md",
  },
  // The OUTLINE step of a pipelined scene run (issue #102): its own prompt
  // and its own few-shot (a worked example outline, not a target file).
  outline: {
    systemPrompt: "outline-system-prompt.md",
    fewShotTarget: "outline-example-output.md",
  },
  // The output-schema section that turns the scene prompt into „genau eine
  // Szene aus der Gliederung" mode (issue #102). No few-shot of its own — the
  // per-scene call sends the scene example file — so, like `augment`, this
  // entry carries a system prompt alone.
  sceneSingle: { systemPrompt: "scene-single-output.md" },
  // The augment run's OWN system prompt (issue #36). It has no few-shot of
  // its own — the run sends the TARGET KIND's example file — so this entry
  // carries the system prompt alone and `loadPromptAssets` is not the right
  // shape for it; see loadAsset below.
  augment: { systemPrompt: "augment-system-prompt.md" },
} as const;

const promptAssets = new Map<string, PromptAssets>();

/**
 * The kinds that have a prompt PAIR. `augment` and `sceneSingle` do not: the
 * first sends the target kind's example file, the second is only an output
 * schema spliced into the scene prompt (issue #102).
 */
type PromptPairKind = Exclude<keyof typeof ASSET_FILES, "augment" | "sceneSingle">;

export async function loadPromptAssets(kind: PromptPairKind): Promise<PromptAssets> {
  const cached = promptAssets.get(kind);
  if (cached !== undefined) return cached;
  const files = ASSET_FILES[kind];
  const assets: PromptAssets = {
    systemPrompt: await readFile(path.join(GENERATOR_DIR, files.systemPrompt), "utf8"),
    fewShotTarget: await readFile(path.join(GENERATOR_DIR, files.fewShotTarget), "utf8"),
  };
  promptAssets.set(kind, assets);
  return assets;
}

/** One prompt asset by FILE NAME, cached — the augment run mixes two pairs. */
const assetCache = new Map<string, string>();

export async function loadAsset(file: string): Promise<string> {
  const cached = assetCache.get(file);
  if (cached !== undefined) return cached;
  const text = await readFile(path.join(GENERATOR_DIR, file), "utf8");
  assetCache.set(file, text);
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
   * The binding knowledge block (issue #53) — `""` when the campaign has
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
}

/** A scene run additionally targets one chapter. */
export interface SceneContext extends CampaignContext {
  chapter: string;
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
 * reserved dir -> 404. `allowMissingChapter` is the "new chapter" flow
 * (issue #12): the target directory does not exist yet — it is created on
 * apply, so generating into it must not 404.
 *
 * Exported because POST /generate runs these BEFORE it creates a background
 * job (issue #19): a 400/404 is a request error and must stay a synchronous
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
 * The id of an existing npc file, for the collision check of an NPC run
 * (issue #21) — a request-level 409 before a single token is spent.
 * `assertSafeAddress` is not enough here: the id must be a kebab slug,
 * because it becomes the file name AND the reference key.
 */
export const NPC_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Cheap request checks of an NPC run: unsafe campaign id -> 400, unknown
 * campaign -> 404, an unusable pinned id -> 400, and a pinned id whose file
 * already exists -> 409 (never overwrite, issue #21 non-goal: enriching an
 * existing NPC file). Exported for the same reason as assertGenerateTarget:
 * POST /generate/npc runs it BEFORE it creates a background job.
 */
export async function assertNpcGenerateTarget(campaign: string, npcId?: string): Promise<void> {
  await requireCampaign(campaign); // 400 unsafe id, 404 unknown campaign
  if (npcId === undefined) return;
  if (!NPC_ID_PATTERN.test(npcId)) throw new ApiError(400, "invalid npc id");
  const rel = npcPath(npcId);
  if (await draftTargetExists(campaign, rel)) {
    throw new ApiError(409, "npc file already exists", { path: rel });
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
 * done them); the chapter contributes only its id to the context, so nothing
 * else changes when the chapter (and its `_chapter`) is still missing.
 */
export async function collectSceneContext(
  campaign: string,
  chapter: string,
  allowMissingChapter = false,
): Promise<SceneContext> {
  await assertGenerateTarget(campaign, chapter, allowMissingChapter);
  return { ...(await collectContext(campaign)), chapter };
}

/**
 * The part of the context that is the same for every run kind. Reads the
 * campaign's npcs/locations out of the tree query and the glossary out of its
 * TABLE (issue #57) — rendered as the `EN → DE` lines the prompt documents,
 * so the prompt text the LLM sees is the same as before.
 */
export async function collectContext(campaign: string): Promise<CampaignContext> {
  const tree = await buildTree(campaign);
  const npcs = tree.npcs.map((n) => ({ id: n.id, name: n.name }));
  const locations = tree.locations.map((l) => ({ id: l.id, name: l.name }));
  const glossary = (await glossaryText(campaign)) ?? "";
  // Issue #53: the knowledge block travels with EVERY run kind, and its
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
  };
}

// --- JSON extraction (generator/README.md step 4, issue #20) -----------------

/**
 * ```json fence (labelled wins) or a bare ``` fence. Non-greedy: the FIRST
 * fence of the reply. The bare variant requires the newline right after the
 * backticks, so it can never swallow a "json" label as content.
 */
const LABELLED_FENCE = /```json\b[ \t]*\r?\n?([\s\S]*?)```/i;
const BARE_FENCE = /```[ \t]*\r?\n([\s\S]*?)```/;

function fenceContent(raw: string): string | null {
  const labelled = LABELLED_FENCE.exec(raw);
  if (labelled !== null) return labelled[1]!;
  const bare = BARE_FENCE.exec(raw);
  return bare === null ? null : bare[1]!;
}

/** Substring from the first `{` to the last `}` — prose on both sides falls off. */
function braceSpan(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

/**
 * Get the JSON value out of a raw model reply (issue #20). Models like to
 * put an explainer sentence in front of the object ("I need to be careful
 * about characters inside string values…"); that must not cost two
 * correction turns for an otherwise usable reply.
 *
 * Three stages, first one that PARSES wins:
 *   (a) the whole text — what a well-behaved model returns,
 *   (b) the content of a ```json (or bare ```) fence,
 *   (c) the substring from the first `{` to the last `}` (braces inside
 *       string values cannot confuse this — only the outermost pair counts).
 *
 * The extraction loosens ONLY the parsing: whatever comes out goes through
 * the unchanged full validation below. Returns null when no stage parses —
 * then, and only then, the reply "is not valid JSON" and the correction turn
 * runs as before. Wrapped in an object because a parsed value may itself be
 * `null` (the validation rejects that, the extractor must not swallow it).
 */
export function extractJsonReply(raw: string): { value: unknown } | null {
  for (const candidate of [raw, fenceContent(raw), braceSpan(raw)]) {
    if (candidate === null) continue;
    const trimmed = candidate.trim();
    if (trimmed === "") continue;
    try {
      return { value: JSON.parse(trimmed) };
    } catch {
      // next stage
    }
  }
  return null;
}

// --- mechanical validation (generator/README.md step 4) ----------------------

/**
 * One document of a model reply (issue #100). There is no `path` any more:
 * the model does not address anything. It writes a DOCUMENT, the `id` in its
 * properties is the entity's key, and the server builds the address from the
 * run's chapter plus that id — which is what makes a corrected `location`
 * move the scene instead of contradicting a path the model chose.
 *
 * `kind` is how a suggested ENTRY says what it is; scenes and the npc run's
 * single document carry none (the run knows).
 */
export interface RawEntry {
  kind?: string;
  content: string;
}

interface RawReply {
  scenes: RawEntry[];
  entries: RawEntry[];
  warnings: string[];
}

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
 * An entity id is a kebab slug — the README's stable reference key, and
 * since issue #100 the ONLY thing a model decides about addressing.
 */
const ENTITY_ID_PATTERN = ENTITY_SLUG;

/**
 * The stem a still-UNADDRESSED reply document is parsed under.
 *
 * The shared parser fills a missing `id` from the address's last segment
 * (parse.ts, the degrade rule for a properties-less file), so a reply that
 * names no `id` silently inherited one from whatever label it happened to be
 * parsed under — for an NPC reply that label was `"npc"`, which is a kebab
 * slug and passed the id pattern. The run then wrote `npcs/npc`.
 *
 * Parsing under a stem that can NEVER be an id makes the omission visible,
 * and a missing `id` is exactly the kind of error a correction turn fixes
 * (issue #100 review): the model is told „id fehlt" instead of having one
 * invented for it.
 */
const NO_ID_STEM = "\u0000no-id";

/**
 * The `id` the document DECLARED, or undefined when it declared none — the
 * parser's fallback (NO_ID_STEM) read back as what it means.
 */
function declaredId(parsed: ParsedFile): unknown {
  const id = parsed.properties.id;
  return id === NO_ID_STEM ? undefined : id;
}

/** Last segment of a campaign-relative address — the entity's id. */
function addressId(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

/**
 * "Properties parseable" through the shared parser: the parser never
 * throws, it DEGRADES — a missing or broken block leaves the whole raw text
 * as the body. So: parseable iff the content opens a block and the parser
 * actually split it off.
 */
/**
 * Re-parse a document under the ADDRESS the server derives from the `id`
 * inside it (issue #100). The shared parser fills a missing `name`/`title`
 * from the address's last segment, so once the id is known the document has
 * to be parsed again under its real address — otherwise a reply that
 * legitimately omits the display name degrades to a placeholder nobody chose.
 */
export function reparseAtAddress(
  content: string,
  id: string,
  address: (id: string) => string,
): ParsedFile {
  return parseMarkdown(content, address(id), 0);
}

export function parseWithProperties(
  content: string,
  rel: string,
): { parsed: ParsedFile; error?: string } {
  const parsed = parseMarkdown(content, rel, 0);
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { parsed, error: "missing properties block" };
  }
  if (parsed.body === content) return { parsed, error: "properties is not parseable YAML" };
  return { parsed };
}

/** Shape check for one scenes/stubs entry of the raw reply. */
export function isRawEntry(v: unknown): v is RawEntry {
  return v !== null && typeof v === "object" && typeof (v as RawEntry).content === "string";
}

function parseRawReply(raw: string, errors: string[]): RawReply | null {
  const extracted = extractJsonReply(raw);
  if (extracted === null) {
    errors.push("reply is not valid JSON");
    return null;
  }
  const parsed = extracted.value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push("reply must be a JSON object");
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const entryList = (key: "scenes" | "entries"): RawEntry[] => {
    const v = obj[key] ?? [];
    if (!Array.isArray(v)) {
      errors.push(`"${key}" must be an array`);
      return [];
    }
    const good: RawEntry[] = [];
    v.forEach((item, i) => {
      if (isRawEntry(item)) good.push(item);
      else errors.push(`"${key}[${i}]" must be an object with a string "content"`);
    });
    return good;
  };
  const scenes = entryList("scenes");
  const entries = entryList("entries");
  if (errors.length > 0) return null;
  if (scenes.length === 0) {
    errors.push('"scenes" must contain at least one scene');
    return null;
  }
  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return { scenes, entries, warnings };
}

/**
 * The `status` rules for stubs (issue #27), as messages — empty list means
 * fine. `status: draft` belongs to SCENES only: per the data contract
 * (README) an npc knows alive/dead/missing/unknown and a location has no
 * status at all, so a `draft` leaking into a stub becomes an invalid
 * pass-through value in the UI. Any valid NpcStatus is accepted for an npc
 * stub; the prompt asks for `alive` unless the source text says otherwise,
 * which is why a MISSING npc status is an error too.
 *
 * Shared by the reply validation (-> correction turn) and the apply
 * re-validation (-> 400): the same rule, checked on both ways in.
 */
function stubStatusErrors(kind: "npc" | "location", fm: Record<string, unknown>): string[] {
  if (kind === "location") {
    return Object.hasOwn(fm, "status")
      ? ['"status" ist nicht erlaubt — locations haben keinen status']
      : [];
  }
  return npcStatusErrors(fm, "NPC-Stubs");
}

/**
 * The npc `status` rule, shared by the stub validation and the NPC generator
 * (issue #21): present, and one of NPC_STATUSES. `subject` names who the rule
 * is about, so the correction turn reads naturally in both places.
 */
export function npcStatusErrors(fm: Record<string, unknown>, subject: string): string[] {
  if (!Object.hasOwn(fm, "status")) {
    return [`"status" fehlt — ${subject} brauchen einen status (im Normalfall "alive")`];
  }
  const status = fm.status;
  if (typeof status !== "string" || !(NPC_STATUSES as readonly string[]).includes(status)) {
    return [
      `"status" muss einer von ${NPC_STATUSES.join(", ")} sein — ` +
        `${subject} im Normalfall "alive"`,
    ];
  }
  return [];
}

/**
 * Validate one SUGGESTED ENTRY of a scene reply (issue #100): `kind` says
 * what it is, the properties `id` is its key, and the server addresses it as
 * `npcs/<id>` / `locations/<id>`. Returns the GeneratedStub or pushes errors.
 */
export function validateEntry(entry: RawEntry, index: number, errors: string[]): GeneratedStub | null {
  const kind = entry.kind;
  if (kind !== "npc" && kind !== "location") {
    errors.push(`entries[${index}]: "kind" must be "npc" or "location"`);
    return null;
  }
  const preview = `entries[${index}]`;
  const { parsed, error } = parseWithProperties(entry.content, NO_ID_STEM);
  if (error !== undefined) {
    errors.push(`${kind} entry ${preview}: ${error}`);
    return null;
  }
  const fmId = declaredId(parsed);
  if (fmId === undefined) {
    errors.push(`${kind} entry ${preview}: "id" fehlt — jeder Eintrag nennt seine kebab-case id`);
    return null;
  }
  if (typeof fmId !== "string" || !ENTITY_ID_PATTERN.test(fmId)) {
    errors.push(
      `${kind} entry ${preview}: "id" must be a kebab-case id (a-z, 0-9, single dashes)`,
    );
    return null;
  }
  const id = fmId;
  const reparsed = reparseAtAddress(entry.content, id, kind === "npc" ? npcPath : locationPath);
  const label = `${kind} entry "${id}"`;
  // A status error does not stop the mapping: the stub still resolves the
  // scene's reference, so the correction turn gets the ONE real error
  // instead of a cascade of "npc does not exist".
  for (const msg of stubStatusErrors(kind, parsed.properties)) errors.push(`${label}: ${msg}`);
  return {
    kind,
    id,
    name: typeof reparsed.properties.name === "string" ? reparsed.properties.name : id,
    markdown: entry.content,
  };
}

/**
 * Mechanical validation of one raw model reply against the campaign context.
 * Returns the mapped GenerateResult, or the list of errors for the
 * correction turn.
 */
/**
 * Which ids a scene document may REFERENCE (issue #102). Before this ticket
 * the answer was "the campaign plus the stubs of the same reply"; with the
 * pipeline the reply is one scene and the other ids come from the OUTLINE, so
 * the allowed sets became a parameter instead of a local variable.
 */
export interface AllowedRefs {
  npcIds: ReadonlySet<string>;
  locationIds: ReadonlySet<string>;
}

/**
 * Mechanical validation of ONE scene document (issue #102). Factored out of
 * `validateReply` rather than duplicated: the batch reply and the pipeline's
 * single-scene reply have to be judged by exactly the same rules, and the one
 * way to guarantee that is one function.
 *
 * `label` is how the document is named in an error message; `seenIds` is the
 * duplicate guard of the surrounding reply (a batch has several documents, a
 * single-scene reply shares the set with the outline's ids).
 *
 * Returns the draft, or null with the errors pushed onto `errors`.
 */
export function validateSceneDocument(input: {
  content: string;
  label: string;
  chapter: string;
  allowed: AllowedRefs;
  seenIds: Set<string>;
  errors: string[];
  /** The id the OUTLINE assigned — a pipeline part may not rename itself. */
  expectedId?: string;
}): GeneratedSceneDraft | null {
  const { content, chapter, allowed, seenIds, errors } = input;
  // The scene's ADDRESS is the server's: `<chapter>/<id>`, with the chapter
  // taken from the run's CONTEXT and never from the model (issue #100). The
  // id is the one thing the model decides here, so it is the one thing
  // validated as an address would be.
  const { parsed, error } = parseWithProperties(content, NO_ID_STEM);
  if (error !== undefined) {
    errors.push(`${input.label}: ${error}`);
    return null;
  }
  const fm = parsed.properties;
  const fmId = declaredId(parsed);
  if (fmId === undefined) {
    errors.push(`${input.label}: "id" fehlt — jede Szene nennt ihre kebab-case id`);
    return null;
  }
  if (typeof fmId !== "string" || !ENTITY_ID_PATTERN.test(fmId)) {
    errors.push(`${input.label}: "id" must be a kebab-case id (a-z, 0-9, single dashes)`);
    return null;
  }
  const label = `scene "${fmId}"`;
  if (input.expectedId !== undefined && fmId !== input.expectedId) {
    errors.push(
      `${label}: die id muss "${input.expectedId}" bleiben — sie kommt aus der Gliederung ` +
        "und andere Szenen verweisen darauf",
    );
    return null;
  }
  if (seenIds.has(fmId)) {
    errors.push(`${label}: duplicate id`);
    return null;
  }
  seenIds.add(fmId);
  const reparsed = reparseAtAddress(content, fmId, (id) => scenePath(chapter, "", id));

  if (!(SCENE_TYPES as readonly string[]).includes(String(fm.type))) {
    errors.push(`${label}: "type" must be one of ${SCENE_TYPES.join(", ")}`);
  }
  if (fm.status !== "draft") {
    errors.push(`${label}: "status" must be "draft"`);
  }

  if (fm.npcs !== undefined && fm.npcs !== null) {
    if (!Array.isArray(fm.npcs) || fm.npcs.some((n) => typeof n !== "string")) {
      errors.push(`${label}: "npcs" must be an array of npc ids`);
    } else {
      for (const npc of fm.npcs as string[]) {
        if (!allowed.npcIds.has(npc)) {
          errors.push(
            `${label}: npc "${npc}" does not exist in the campaign and no suggested entry provides it`,
          );
        }
      }
    }
  }
  if (typeof fm.location === "string" && fm.location !== "") {
    if (!allowed.locationIds.has(fm.location)) {
      errors.push(
        `${label}: location "${fm.location}" does not exist in the campaign and ` +
          `no suggested entry provides it`,
      );
    }
  }

  for (const kind of unknownCallouts(parsed.body)) {
    errors.push(
      `${label}: unknown callout "[!${kind}]" — allowed: ${CALLOUT_KINDS.map((k) => `[!${k}]`).join(", ")}`,
    );
  }

  return {
    path: scenePath(chapter, "", fmId),
    markdown: content,
    properties: reparsed.properties,
  };
}

/**
 * Validate the suggested ENTRIES of a reply: each one mapped, duplicates
 * rejected, and the id sets a scene may reference collected from them.
 * Shared by the batch reply and by nothing else yet — the pipeline validates
 * one entry at a time — but it is where the "an entry resolves a scene's
 * reference" rule lives, so it stays one function.
 */
function validateEntries(
  entries: readonly RawEntry[],
  errors: string[],
): { stubs: GeneratedStub[]; npcIds: Set<string>; locationIds: Set<string> } {
  const stubs: GeneratedStub[] = [];
  const seenEntries = new Set<string>();
  entries.forEach((entry, index) => {
    const stub = validateEntry(entry, index, errors);
    if (stub === null) return;
    const key = `${stub.kind}/${stub.id}`;
    if (seenEntries.has(key)) {
      errors.push(`${stub.kind} entry "${stub.id}": duplicate id`);
      return;
    }
    seenEntries.add(key);
    stubs.push(stub);
  });
  return {
    stubs,
    npcIds: new Set(stubs.filter((s) => s.kind === "npc").map((s) => s.id)),
    locationIds: new Set(stubs.filter((s) => s.kind === "location").map((s) => s.id)),
  };
}

/**
 * Mechanical validation of one raw model reply against the campaign context.
 * Returns the mapped GenerateResult, or the list of errors for the
 * correction turn.
 *
 * This is the BATCH shape — one reply carrying every scene and every
 * suggested entry. Since issue #102 a scene run does not use it any more
 * (the pipeline validates one document per call); it stays because it is the
 * shape the single-call runs share their rules with, and because the rules
 * themselves now live in `validateSceneDocument` / `validateEntries`.
 */
export function validateReply(
  raw: string,
  ctx: SceneContext,
): { ok: true; result: GenerateResult } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const reply = parseRawReply(raw, errors);
  if (reply === null) return { ok: false, errors };

  // Suggested entries first — scene references may point at them.
  const entries = validateEntries(reply.entries, errors);
  const allowed: AllowedRefs = {
    npcIds: new Set([...ctx.npcIds, ...entries.npcIds]),
    locationIds: new Set([...ctx.locationIds, ...entries.locationIds]),
  };

  const scenes: GeneratedSceneDraft[] = [];
  const seenIds = new Set<string>();
  reply.scenes.forEach((entry, index) => {
    const draft = validateSceneDocument({
      content: entry.content,
      label: `scene scenes[${index}]`,
      chapter: ctx.chapter,
      allowed,
      seenIds,
      errors,
    });
    if (draft !== null) scenes.push(draft);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, result: { scenes, stubs: entries.stubs, warnings: reply.warnings } };
}

// --- mechanical validation of an NPC reply (issue #21) -----------------------

/** The NPC reply schema the npc system prompt demands: one file, warnings. */
interface RawNpcReply {
  npc: RawEntry;
  warnings: string[];
}

/** The only legal target of an NPC run — the id IS the file name. */
const NPC_PATH_PATTERN = /^npcs\/[a-z0-9][a-z0-9-]*$/;

/** The sections of the NPC format that carry rules (README "Entität: NPC"). */
const KNOWLEDGE_SECTION = "Weiß";
const RELATIONS_SECTION = "Beziehungen";
const NOTES_SECTION = "Notizen";

/** `- <npc-id>: <text>` — the relationship line of the format contract. */
const RELATION_ITEM = /^\s*[-*]\s+(.*)$/;
const RELATION_ENTRY = /^([a-z0-9][a-z0-9-]*)\s*:\s*\S/;

/** The title of a `##` heading line, or undefined for any other line. */
function h2Title(line: string): string | undefined {
  const match = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
  return match?.[1];
}

/**
 * Body of one `## <heading>` section (up to the next heading of any level), or
 * undefined when the section is not there. Sections are NOT required — the
 * format degrades — but the ones that exist have to follow their rules.
 */
function sectionBody(body: string, heading: string): string | undefined {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => h2Title(line) === heading);
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6}[ \t]/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * `## Beziehungen` may only point at npcs that EXIST (the prompt's rule is
 * "weglassen statt erfinden"): every list line must be `- <npc-id>: <text>`
 * with an id from the campaign context. Prose lines inside the section are
 * left alone — that is the format degrading, not a mechanical error.
 */
function relationErrors(body: string, ctx: CampaignContext): string[] {
  const section = sectionBody(body, RELATIONS_SECTION);
  if (section === undefined) return [];
  const errors: string[] = [];
  for (const line of section.split("\n")) {
    const item = RELATION_ITEM.exec(line);
    if (item === null) continue;
    const text = item[1]!.trim();
    const entry = RELATION_ENTRY.exec(text);
    if (entry === null) {
      errors.push(
        `## ${RELATIONS_SECTION}: "${text}" ist keine "- <npc-id>: <Text>"-Zeile — ` +
          "nur ids aus der Kontextliste",
      );
      continue;
    }
    const id = entry[1]!;
    if (!ctx.npcIds.has(id)) {
      errors.push(
        `## ${RELATIONS_SECTION}: npc "${id}" existiert nicht in der Kampagne — ` +
          "Beziehung weglassen statt erfinden",
      );
    }
  }
  return errors;
}

/**
 * Inside `## Weiß` only `[!secret]` belongs (that section is the aggregated
 * player-unknown knowledge). Other KNOWN callouts elsewhere in the file are
 * fine; unknown ones are reported once for the whole file by unknownCallouts.
 */
function knowledgeCalloutErrors(body: string): string[] {
  const section = sectionBody(body, KNOWLEDGE_SECTION);
  if (section === undefined) return [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const m of section.matchAll(CALLOUT_MARKER)) {
    const kind = m[1]!.toLowerCase();
    if (!KNOWN_CALLOUTS.has(kind) || kind === "secret" || seen.has(kind)) continue;
    seen.add(kind);
    errors.push(
      `## ${KNOWLEDGE_SECTION}: nur [!secret] erlaubt — [!${kind}] gehört in einen anderen Abschnitt`,
    );
  }
  return errors;
}

/** `## Notizen` is app-managed (README) — it must arrive empty. */
function notesErrors(body: string): string[] {
  const section = sectionBody(body, NOTES_SECTION);
  if (section === undefined) return [];
  const text = section.replace(/<!--[\s\S]*?-->/g, "").trim();
  return text === ""
    ? []
    : [`## ${NOTES_SECTION} bleibt leer — die App füllt den Abschnitt im Review-Schritt`];
}

/**
 * Quickstats values must be quoted STRINGS: YAML reads a bare `+2` as the
 * number 2 and the plus — the whole point of a social modifier — is gone
 * before anyone sees the file.
 */
export function quickstatsErrors(fm: Record<string, unknown>): string[] {
  const quickstats = fm.quickstats;
  if (quickstats === undefined || quickstats === null) return [];
  if (typeof quickstats !== "object" || Array.isArray(quickstats)) {
    return ['"quickstats" muss ein Objekt sein, z. B. { wis: "+2" }'];
  }
  const bad = Object.entries(quickstats)
    .filter(([, value]) => typeof value !== "string")
    .map(([key]) => key);
  return bad.length === 0
    ? []
    : [
        '"quickstats" — Werte als Strings in Anführungszeichen ("+2"), sonst verschluckt ' +
          `YAML das Plus: ${bad.join(", ")}`,
      ];
}

function parseRawNpcReply(raw: string, errors: string[]): RawNpcReply | null {
  const extracted = extractJsonReply(raw);
  if (extracted === null) {
    errors.push("reply is not valid JSON");
    return null;
  }
  const parsed = extracted.value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    errors.push("reply must be a JSON object");
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (!isRawEntry(obj.npc)) {
    // No `path`: the model writes a DOCUMENT and the server addresses it
    // (issue #100), so `content` is the only member left to ask for.
    errors.push('"npc" must be an object with a string "content"');
    return null;
  }
  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return { npc: obj.npc, warnings };
}

/**
 * Mechanical validation of one raw NPC reply against the campaign context —
 * the NPC counterpart of validateReply. Same contract: the mapped result, or
 * the error list for the correction turn.
 *
 * The rules, all from the format contract (README "Entität: NPC"):
 * parseable properties whose `id` is a kebab-case id — the ADDRESS is the
 * server's (`npcs/<id>`, issue #100), the model does not name one — a `name`, a valid NpcStatus (`alive` unless the source says
 * otherwise), no invented `chapter`, quoted quickstats, relationships only to
 * npcs that exist, only `[!secret]` inside `## Weiß`, only known callouts, and
 * an empty `## Notizen`. An id that already exists is an error too — the DM
 * can pin a different one via the request's `id`.
 */
/**
 * The NPC FORMAT rules that live in the body (issue #21): `## Weiß` carries
 * only `[!secret]`, `## Beziehungen` only existing npc ids, `## Notizen`
 * stays empty. Exported since issue #102, where an npc is generated as a part
 * of a scene run and has to be judged by the same rules as an npc RUN — minus
 * the ones that are about the run (no chapter, the pinned id).
 */
export function npcBodyErrors(body: string, ctx: CampaignContext): string[] {
  return [...knowledgeCalloutErrors(body), ...relationErrors(body, ctx), ...notesErrors(body)];
}

export function validateNpcReply(
  raw: string,
  ctx: CampaignContext,
  pinnedId?: string,
): { ok: true; result: GenerateNpcResult } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const reply = parseRawNpcReply(raw, errors);
  if (reply === null) return { ok: false, errors };

  const entry = reply.npc;
  // Without usable properties nothing else can be judged (the id is in them).
  const { parsed, error } = parseWithProperties(entry.content, NO_ID_STEM);
  if (error !== undefined) {
    return { ok: false, errors: [`npc: ${error}`] };
  }
  const fm = parsed.properties;
  const fmId = declaredId(parsed);
  if (fmId === undefined) {
    return {
      ok: false,
      errors: ['npc: "id" fehlt — die Datei muss ihre kebab-case id nennen'],
    };
  }
  if (typeof fmId !== "string" || !ENTITY_ID_PATTERN.test(fmId)) {
    return {
      ok: false,
      errors: ['npc: "id" muss eine kebab-case id sein (a-z, 0-9, einzelne Bindestriche)'],
    };
  }
  const id = fmId;
  // Re-parsed under the address the server will use, so the shared parser's
  // degrade rules (a missing `name` falls back to the address's last
  // segment) see the same address they always did — see reparseAtAddress.
  const reparsed = reparseAtAddress(entry.content, id, npcPath);
  const label = `npc "${id}"`;
  if (pinnedId !== undefined && id !== pinnedId) {
    errors.push(`${label}: die id ist vorgegeben — "id" muss "${pinnedId}" sein`);
  }
  if (ctx.npcIds.has(id)) {
    errors.push(
      `${label}: id "${id}" existiert schon in der Kampagne — andere id wählen ` +
        '(oder der DM gibt eine id über das Feld "id" vor)',
    );
  }

  // `name` is NOT checked: the shared parser degrades a missing display name
  // to the id (README/parse.ts), so there is nothing mechanical left to
  // complain about — the prompt asks for one, the format survives without it.
  if (Object.hasOwn(fm, "chapter")) {
    errors.push(`${label}: kein "chapter" — der NPC-Lauf kennt kein Ziel-Kapitel`);
  }
  for (const msg of npcStatusErrors(fm, "NPC-Dateien")) errors.push(`${label}: ${msg}`);
  for (const msg of quickstatsErrors(fm)) errors.push(`${label}: ${msg}`);

  for (const kind of unknownCallouts(parsed.body)) {
    errors.push(
      `${label}: unknown callout "[!${kind}]" — allowed: ${CALLOUT_KINDS.map((k) => `[!${k}]`).join(", ")}`,
    );
  }
  for (const msg of [
    ...knowledgeCalloutErrors(parsed.body),
    ...relationErrors(parsed.body, ctx),
    ...notesErrors(parsed.body),
  ]) {
    errors.push(`${label}: ${msg}`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    result: {
      npc: { path: npcPath(id), markdown: entry.content, properties: reparsed.properties },
      warnings: reply.warnings,
    },
  };
}

// German on purpose: it is part of the (German) prompt conversation. The tail
// names what the corrected reply must still contain — the only part that
// differs between a scene run and an NPC run (issue #21).
export function buildCorrectionMessage(errors: string[], tail: string): string {
  return [
    "Deine letzte Antwort hat die mechanische Validierung nicht bestanden:",
    errors.map((e) => `- ${e}`).join("\n"),
    `Antworte erneut mit dem vollständigen, korrigierten JSON — gleiches Schema, ${tail}, ` +
      "kein Text außerhalb des JSON-Blocks.",
  ].join("\n\n");
}

export const SCENE_CORRECTION_TAIL = "alle Szenen und Stubs enthalten";
const NPC_CORRECTION_TAIL = "die vollständige NPC-Datei enthalten";

// --- run accounting (issue #18) -----------------------------------------------

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
  private reported = false;

  add(completion: CompletionResult): void {
    this.attempts += 1;
    if (completion.usage === undefined) return;
    this.reported = true;
    this.inputTokens += completion.usage.inputTokens;
    this.outputTokens += completion.usage.outputTokens;
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
        : `${usage.inputTokens} in / ${usage.outputTokens} out`;
    console.log(
      `generate: ${providerName}, ${this.attempts} attempt(s), ${tokens} — ${outcome}`,
    );
  }
}

/**
 * The truncation message — the ENGLISH technical fallback next to
 * `code: "llm_truncated"` (issue #69); the sentence the DM reads is built by
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

// --- POST /api/:campaign/generate ---------------------------------------------

/**
 * Run the pipeline: context -> prompt -> provider -> mechanical validation,
 * with up to `LLM_CORRECTION_TURNS` correction turns (default 1, hard bound
 * MAX_CORRECTION_TURNS — see parseCorrectionTurns). Writes NOTHING.
 *
 * Two ways out with 422, both carrying the last raw reply (capped) and the
 * run's token usage so the DM sees WHAT came back and what it cost:
 * a truncated reply (immediately, no correction turn) and exhausted retries.
 *
 * `getProvider` is called lazily after the request-level checks (unknown
 * campaign/chapter answer 404 before an unconfigured provider answers 503);
 * tests inject a fake here.
 *
 * `newChapter` marks the app's "new chapter" flow: the chapter directory
 * does not exist yet and is created by apply, so a missing one is not a 404.
 */
export async function runGenerate(
  campaign: string,
  chapter: string,
  sourceText: string,
  newChapter = false,
  getProvider: () => LLMProvider = obtainProvider,
): Promise<GenerateResult> {
  const ctx = await collectSceneContext(campaign, chapter, newChapter);
  const assets = await loadPromptAssets("scene");
  const result = await runPipeline({
    req: {
      systemPrompt: assets.systemPrompt,
      fewShotTarget: assets.fewShotTarget,
      knowledge: ctx.knowledge,
      glossary: ctx.glossary,
      context: { chapter: ctx.chapter, npcs: ctx.npcs, locations: ctx.locations },
      sourceText,
    },
    provider: getProvider(),
    validate: (raw) => validateReply(raw, ctx),
    correctionTail: SCENE_CORRECTION_TAIL,
  });
  // The naming check runs on the FINISHED drafts (issue #53 AK3) — after the
  // correction turns, because only the reply that survived validation is the
  // text the DM will read. Stubs are checked too: a stub is a file the run
  // creates, and a convention applies to it exactly as much.
  return withNamingHints(result, [
    ...result.scenes.map((s) => ({ path: s.path, markdown: s.markdown })),
    ...result.stubs.map((s) => ({ path: stubPath(s), markdown: s.markdown })),
  ], ctx.namingRules);
}

/** Where a stub would be written — the address the hint has to name. */
export function stubPath(stub: GeneratedStub): string {
  return stub.kind === "npc" ? npcPath(stub.id) : locationPath(stub.id);
}

/**
 * Attach the naming check's findings to a result. Its own function so a
 * scene run and an NPC run cannot drift apart on it, and so the "no rules,
 * no field" case is spelled once: with nothing to report the key stays
 * ABSENT rather than becoming an empty array every client has to ignore.
 */
export function withNamingHints<T extends { namingHints?: NamingHint[] }>(
  result: T,
  drafts: ReadonlyArray<{ path: string; markdown: string }>,
  rules: readonly NamingRule[],
): T {
  const namingHints = checkDraftsNaming(drafts, rules);
  return namingHints.length === 0 ? result : { ...result, namingHints };
}

/**
 * The provider loop itself, shared by both run kinds (issue #21) so the
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
}): Promise<T> {
  const { req, provider, validate } = input;
  const corrections: CorrectionTurn[] = [];
  // Read once per run: the bound must not change under a running loop.
  const maxCorrections = parseCorrectionTurns();
  const spend = new RunUsage();
  for (;;) {
    const completion = await provider.complete(req, corrections);
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
      correction: buildCorrectionMessage(outcome.errors, input.correctionTail),
    });
  }
}

// --- POST /api/:campaign/generate/npc (issue #21) -----------------------------

/**
 * Run the NPC pipeline: context -> npc prompt -> provider -> mechanical
 * validation, with the same correction turns, the same truncation fail-fast
 * and the same usage accounting as a scene run (runPipeline). Writes NOTHING;
 * the draft goes into the review and only apply touches the disk.
 *
 * `npcId` is the DM's optional pin: it decides the target file name and is
 * checked for collisions BEFORE the provider is called. Without it the model
 * picks the id (and a collision becomes a correction turn).
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
    },
    provider: getProvider(),
    validate: (raw) => validateNpcReply(raw, ctx, npcId),
    correctionTail: NPC_CORRECTION_TAIL,
  });
  return withNamingHints(
    result,
    [{ path: result.npc.path, markdown: result.npc.markdown }],
    ctx.namingRules,
  );
}

// --- POST /api/:campaign/generate/apply -----------------------------------------

const SCENE_ITEM_KEYS = new Set(["path", "markdown", "properties"]);
const STUB_ITEM_KEYS = new Set(["kind", "id", "name", "markdown"]);
/** Same three keys as a scene draft — the client may pass the draft verbatim. */
const NPC_ITEM_KEYS = SCENE_ITEM_KEYS;

/** One validated file ready to be written. */
export interface ApplyTarget {
  rel: string;
  markdown: string;
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
  const markdown = item.markdown;
  if (typeof rel !== "string") throw new ApiError(400, `${label}.path must be a string`);
  if (typeof markdown !== "string" || markdown === "") {
    throw new ApiError(400, `${label}.markdown must be a non-empty string`);
  }
  assertSafeAddress(rel); // 400 on traversal/absolute/hidden
  // `<chapter>/<id>` and nothing else since issue #100: the group segment of
  // a scene address is its `location`, which the SERVER derives on the way in
  // (`draftAddress`). A client that still sends a three-segment path is
  // naming a group of its own, and that is exactly the contradiction between
  // address and `location` this ticket removes.
  const segments = rel.split("/");
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
  // the properties must still parse and the draft must still be a draft.
  const { parsed, error } = parseWithProperties(markdown, rel);
  if (error !== undefined) throw new ApiError(400, `${label}: ${error}`);
  if (parsed.properties.status !== "draft") {
    throw new ApiError(400, `${label}: "status" must be "draft"`);
  }
  return { rel, markdown };
}

/**
 * Deep-validate the `npc` item of the apply body -> write target (issue #21).
 * Re-validated on the way in, exactly like a scene draft and for the same
 * reason (apply is a separate request — never trust the client): the target
 * path, parseable properties, the id matching the file name and a valid
 * NpcStatus. The rules that shape the MODEL's reply (relationship targets,
 * `[!secret]`-only inside `## Weiß`) are deliberately not re-run here — from
 * here on the DM is the author of the markdown, and their raw edit must not
 * be rejected for a prompt rule.
 */
export function applyNpcTarget(item: unknown): ApplyTarget {
  const label = "npc";
  if (!isPlainObject(item)) throw new ApiError(400, `${label} must be an object`);
  assertKnownKeys(item, NPC_ITEM_KEYS, label);
  const rel = item.path;
  const markdown = item.markdown;
  if (typeof rel !== "string") throw new ApiError(400, `${label}.path must be a string`);
  if (typeof markdown !== "string" || markdown === "") {
    throw new ApiError(400, `${label}.markdown must be a non-empty string`);
  }
  if (!NPC_PATH_PATTERN.test(rel)) {
    throw new ApiError(400, `${label}.path must be "npcs/<kebab-case-id>"`);
  }
  assertSafeAddress(rel); // defense in depth — the pattern rules escapes out
  const { parsed, error } = parseWithProperties(markdown, rel);
  if (error !== undefined) throw new ApiError(400, `${label}: ${error}`);
  const id = addressId(rel);
  if (parsed.properties.id !== id) {
    throw new ApiError(400, `${label}: properties id does not match the address`);
  }
  const statusError = npcStatusErrors(parsed.properties, "NPC-Dateien")[0];
  if (statusError !== undefined) throw new ApiError(400, `${label}: ${statusError}`);
  return { rel, markdown };
}

/** Deep-validate one stub item of the apply body -> write target. */
export function applyStubTarget(item: unknown, index: number): ApplyTarget {
  const label = `stubs[${index}]`;
  if (!isPlainObject(item)) throw new ApiError(400, `${label} must be an object`);
  assertKnownKeys(item, STUB_ITEM_KEYS, label);
  const kind = item.kind;
  const id = item.id;
  const markdown = item.markdown;
  // Narrowed to the literal union on purpose — the status re-validation
  // below is kind-specific (issue #27).
  if (kind !== "npc" && kind !== "location") {
    throw new ApiError(400, `${label}.kind must be "npc" or "location"`);
  }
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new ApiError(400, `${label}.id must be a kebab-case slug`);
  }
  if (typeof markdown !== "string" || markdown === "") {
    throw new ApiError(400, `${label}.markdown must be a non-empty string`);
  }
  const rel = kind === "npc" ? npcPath(id) : locationPath(id);
  assertSafeAddress(rel); // defense in depth — the slug check above rules escapes out
  const { parsed, error } = parseWithProperties(markdown, rel);
  if (error !== undefined) throw new ApiError(400, `${label}: ${error}`);
  // Re-validation, same as for scenes: a client payload must not sneak a
  // stub status past the reply validation (issue #27).
  const statusError = stubStatusErrors(kind, parsed.properties)[0];
  if (statusError !== undefined) throw new ApiError(400, `${label}: ${statusError}`);
  return { rel, markdown };
}

/**
 * The new-chapter flow (issue #12): `chapter` + `chapterTitle` mean "the
 * drafts go into a chapter that does not exist yet". Returns the
 * `<chapter>/_chapter` target to create in the same batch, or null when the
 * chapter is already there (idempotent — an existing chapter is not a
 * conflict). Minimal properties per the examples convention
 * (id/title/status: planned — a generator-created chapter is upcoming,
 * never the active one); the body stays empty and degrades.
 */
export async function newChapterTarget(
  campaign: string,
  chapter: unknown,
  chapterTitle: unknown,
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
  const yaml = dump(
    { id: chapter, title, status: "planned" },
    { schema: CORE_SCHEMA, flowLevel: 1, lineWidth: -1 },
  );
  return { rel, markdown: `---\n${yaml}---\n` };
}

/**
 * Write the reviewed drafts (issue #57: as ROWS). Validates ALL drafts first
 * (400), then checks ALL targets for conflicts (409 with the conflicting
 * paths, nothing partially written), then inserts them in ONE transaction —
 * which is what "all or nothing" now means literally. Returns the written
 * campaign-relative paths.
 *
 * `chapter`/`chapterTitle` (both or neither) add the chapter's `_chapter`
 * to the SAME all-or-nothing batch when it does not exist yet — the app's
 * "Neues Kapitel" flow.
 *
 * `npc` is the NPC generator's single draft (issue #21) — the same endpoint on
 * purpose: conflict handling, atomic writes and the job cleanup are identical,
 * and a second apply endpoint would only duplicate them.
 *
 * `jobId` is the background job the drafts came from (issue #19): a
 * successful apply discards it — in the SAME transaction as the writes (issue
 * #62), so a crash can never leave a finished job behind whose drafts are
 * already stored. A stale id is ignored rather than dropping the wrong job.
 */
export async function applyGenerated(
  campaign: string,
  body: {
    scenes?: unknown;
    stubs?: unknown;
    npc?: unknown;
    chapter?: unknown;
    chapterTitle?: unknown;
  },
  jobId?: string,
): Promise<{ written: string[] }> {
  await requireCampaign(campaign);
  const { scenes, stubs, npc, chapter, chapterTitle } = body;

  if (scenes !== undefined && !Array.isArray(scenes)) {
    throw new ApiError(400, "scenes must be an array");
  }
  if (stubs !== undefined && !Array.isArray(stubs)) {
    throw new ApiError(400, "stubs must be an array");
  }
  const targets: ApplyTarget[] = [
    ...((scenes as unknown[] | undefined) ?? []).map(applySceneTarget),
    ...((stubs as unknown[] | undefined) ?? []).map(applyStubTarget),
    ...(npc === undefined || npc === null ? [] : [applyNpcTarget(npc)]),
  ];
  if (targets.length === 0) throw new ApiError(400, "nothing to apply");

  // The chapter file comes first — the drafts live inside it.
  const chapterFile = await newChapterTarget(campaign, chapter, chapterTitle);
  if (chapterFile !== null) targets.unshift(chapterFile);

  const drafts = targets.map((t) => {
    const parsed = parseMarkdown(t.markdown, t.rel, 0);
    assertDraftId(parsed.properties.id, t.rel);
    // The ADDRESS the entity will have (store/paths) — for a scene that is
    // `<chapter>/<group>/<id>`, derived from the PROPERTIES id, because
    // that is the key `insertDraft` writes under. The model's last segment is
    // not part of the addressing any more, so it must not decide anything
    // here either: checking the path-derived id while inserting the
    // properties id would let a colliding draft past the 409 and into a
    // primary-key violation.
    return {
      rel: t.rel,
      address: draftAddress(t.rel, parsed.properties),
      properties: parsed.properties,
      body: parsed.body,
    };
  });

  // By IDENTITY, not by address: a scene's address carries its `location`
  // (issue #100), so two drafts with the same id under different locations
  // are two addresses for ONE row — and the row is what the insert claims.
  const seen = new Set<string>();
  for (const draft of drafts) {
    const key = addressIdentity(draft.address);
    if (seen.has(key)) throw new ApiError(400, `duplicate target path: ${draft.rel}`);
    seen.add(key);
  }

  // The conflict check runs in the SAME transaction as the inserts — see
  // store/write.ts `applyDrafts`. Asking here first left a window between
  // "free" and "inserted" in which a target could appear, and the documented
  // `409 { conflicts }` became a primary-key violation (a 500). It asks by
  // ADDRESS, i.e. by id, which is the key now — so a draft that collides with
  // an existing entity is caught even when the model chose a different file
  // name for it; the conflict is REPORTED under the path the client sent,
  // which is the draft it has to fix.
  await applyDrafts(campaign, drafts, jobId);
  return { written: drafts.map((draft) => draft.address) };
}

/**
 * The `id` of a draft BECOMES THE PRIMARY KEY of the inserted row (and, for a
 * scene, the id segment of its address). It arrives from a client payload and
 * was taken on trust: `id: ""` inserted a row nothing can address, and
 * `id: "a/b"` inserted one whose address parses as a different path — both
 * unreachable through `GET /file`, i.e. content written and lost in the same
 * request. A properties that HAS an `id` must therefore carry a usable one;
 * a draft without the key keeps falling back to its address segment, which
 * the address validation already constrains.
 *
 * 422 like the generator's other content rejections: the payload is
 * well-formed, its CONTENT is unusable.
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
 * properties `location` (issue #100). Nothing about the group is taken from
 * the path any more: that is what made a corrected `location` and the stored
 * address disagree. For every other kind the address is the path (an npc or
 * location draft is validated against its own segment, a chapter's id IS the
 * first segment).
 *
 * An unusable `location` is NOT rejected here — `insertDraft` does that, in
 * the transaction, with the code the app has a sentence for.
 */
export function draftAddress(rel: string, properties: Record<string, unknown>): string {
  if (kindFromPath(rel) !== "scene") return rel;
  const segments = rel.split("/");
  const chapterId = segments[0] ?? "";
  const fmId = typeof properties.id === "string" ? properties.id.trim() : "";
  const id = fmId === "" ? (segments[segments.length - 1] ?? "") : fmId;
  const location = typeof properties.location === "string" ? properties.location.trim() : "";
  return scenePath(chapterId, ENTITY_ID_PATTERN.test(location) ? location : "", id);
}
