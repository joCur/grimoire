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
  type ParsedFile,
} from "@grimoire/shared";
import { ApiError, assertSafeAddress } from "./campaign-fs";
// The generator reads its context and writes its drafts through the store
// (issue #57) — the campaign file tree is not a data source any more.
import { buildTree, glossaryText, requireCampaign } from "./store/read";
import { applyDrafts, chapterExists, draftTargetExists } from "./store/write";
import { chapterPath, locationPath, npcPath, scenePath } from "./store/paths";
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

interface PromptAssets {
  systemPrompt: string;
  fewShotTarget: string;
}

/**
 * The two asset pairs (issue #21): scenes and NPCs have their own prompt and
 * their own few-shot target file, cached per kind after the first read.
 */
const ASSET_FILES = {
  scene: { systemPrompt: "system-prompt.md", fewShotTarget: "example-output.md" },
  npc: { systemPrompt: "npc-system-prompt.md", fewShotTarget: "npc-example-output.md" },
} as const;

const promptAssets = new Map<keyof typeof ASSET_FILES, PromptAssets>();

async function loadPromptAssets(kind: keyof typeof ASSET_FILES): Promise<PromptAssets> {
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

// --- context collection ------------------------------------------------------

/**
 * What every run sends along: the campaign's npc/location ids + names (so the
 * model can only REFERENCE what exists) and the glossary.
 */
interface CampaignContext {
  npcs: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  glossary: string;
  npcIds: Set<string>;
  locationIds: Set<string>;
}

/** A scene run additionally targets one chapter. */
interface SceneContext extends CampaignContext {
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
async function collectSceneContext(
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
async function collectContext(campaign: string): Promise<CampaignContext> {
  const tree = await buildTree(campaign);
  const npcs = tree.npcs.map((n) => ({ id: n.id, name: n.name }));
  const locations = tree.locations.map((l) => ({ id: l.id, name: l.name }));
  const glossary = (await glossaryText(campaign)) ?? "";

  return {
    npcs,
    locations,
    glossary,
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

/** The reply schema the system prompt demands. */
interface RawEntry {
  path: string;
  content: string;
}

interface RawReply {
  scenes: RawEntry[];
  npc_stubs: RawEntry[];
  location_stubs: RawEntry[];
  warnings: string[];
}

const KNOWN_CALLOUTS = new Set<string>(CALLOUT_KINDS);
/** `> [!kind]` markers at line starts (nested `>>` included). */
const CALLOUT_MARKER = /^\s*>+\s*\[!([^\]\s]+)\]/gm;

function unknownCallouts(body: string): string[] {
  const unknown: string[] = [];
  for (const m of body.matchAll(CALLOUT_MARKER)) {
    const kind = m[1]!.toLowerCase();
    if (!KNOWN_CALLOUTS.has(kind) && !unknown.includes(m[1]!)) unknown.push(m[1]!);
  }
  return unknown;
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
function parseWithProperties(
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
function isRawEntry(v: unknown): v is RawEntry {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as RawEntry).path === "string" &&
    typeof (v as RawEntry).content === "string"
  );
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
  const entryList = (key: "scenes" | "npc_stubs" | "location_stubs"): RawEntry[] => {
    const v = obj[key] ?? [];
    if (!Array.isArray(v)) {
      errors.push(`"${key}" must be an array`);
      return [];
    }
    const good: RawEntry[] = [];
    v.forEach((item, i) => {
      if (isRawEntry(item)) good.push(item);
      else errors.push(`"${key}[${i}]" must be an object with string "path" and "content"`);
    });
    return good;
  };
  const scenes = entryList("scenes");
  const npc_stubs = entryList("npc_stubs");
  const location_stubs = entryList("location_stubs");
  if (errors.length > 0) return null;
  if (scenes.length === 0) {
    errors.push('"scenes" must contain at least one scene');
    return null;
  }
  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return { scenes, npc_stubs, location_stubs, warnings };
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
function npcStatusErrors(fm: Record<string, unknown>, subject: string): string[] {
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

/** Validate one stub entry; returns the GeneratedStub or pushes errors. */
function validateStub(
  entry: RawEntry,
  kind: "npc" | "location",
  errors: string[],
): GeneratedStub | null {
  const dirName = kind === "npc" ? "npcs" : "locations";
  const label = `${kind} stub "${entry.path}"`;
  if (!new RegExp(`^${dirName}/[a-z0-9][a-z0-9-]*$`).test(entry.path)) {
    errors.push(`${label}: path must be "${dirName}/<kebab-case-id>"`);
    return null;
  }
  const { parsed, error } = parseWithProperties(entry.content, entry.path);
  if (error !== undefined) {
    errors.push(`${label}: ${error}`);
    return null;
  }
  const id = addressId(entry.path);
  const fmId = parsed.properties.id;
  if (typeof fmId === "string" && fmId !== id) {
    errors.push(`${label}: properties id "${fmId}" does not match the address`);
    return null;
  }
  // A status error does not stop the mapping: the stub still resolves the
  // scene's reference, so the correction turn gets the ONE real error
  // instead of a cascade of "npc does not exist".
  for (const msg of stubStatusErrors(kind, parsed.properties)) errors.push(`${label}: ${msg}`);
  return {
    kind,
    id,
    name: typeof parsed.properties.name === "string" ? parsed.properties.name : id,
    markdown: entry.content,
  };
}

/**
 * Mechanical validation of one raw model reply against the campaign context.
 * Returns the mapped GenerateResult, or the list of errors for the
 * correction turn.
 */
export function validateReply(
  raw: string,
  ctx: SceneContext,
): { ok: true; result: GenerateResult } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const reply = parseRawReply(raw, errors);
  if (reply === null) return { ok: false, errors };

  // Stubs first — scene references may point at them.
  const stubs: GeneratedStub[] = [];
  for (const entry of reply.npc_stubs) {
    const stub = validateStub(entry, "npc", errors);
    if (stub !== null) stubs.push(stub);
  }
  for (const entry of reply.location_stubs) {
    const stub = validateStub(entry, "location", errors);
    if (stub !== null) stubs.push(stub);
  }
  const stubNpcIds = new Set(stubs.filter((s) => s.kind === "npc").map((s) => s.id));
  const stubLocationIds = new Set(stubs.filter((s) => s.kind === "location").map((s) => s.id));

  const scenes: GeneratedSceneDraft[] = [];
  const seenPaths = new Set<string>();
  for (const entry of reply.scenes) {
    const label = `scene "${entry.path}"`;

    try {
      assertSafeAddress(entry.path);
    } catch {
      errors.push(`${label}: invalid path`);
      continue;
    }
    const segments = entry.path.split("/");
    if (segments[0] !== ctx.chapter || segments.length < 2 || segments.length > 3) {
      errors.push(
        `${label}: path must be "${ctx.chapter}/<scene>" or "${ctx.chapter}/<location-slug>/<scene>"`,
      );
    }
    if (seenPaths.has(entry.path)) errors.push(`${label}: duplicate path`);
    seenPaths.add(entry.path);

    const { parsed, error } = parseWithProperties(entry.content, entry.path);
    if (error !== undefined) {
      errors.push(`${label}: ${error}`);
      continue;
    }
    const fm = parsed.properties;

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
          if (!ctx.npcIds.has(npc) && !stubNpcIds.has(npc)) {
            errors.push(
              `${label}: npc "${npc}" does not exist in the campaign and no npc_stub provides it`,
            );
          }
        }
      }
    }
    if (typeof fm.location === "string" && fm.location !== "") {
      if (!ctx.locationIds.has(fm.location) && !stubLocationIds.has(fm.location)) {
        errors.push(
          `${label}: location "${fm.location}" does not exist in the campaign and no location_stub provides it`,
        );
      }
    }

    for (const kind of unknownCallouts(parsed.body)) {
      errors.push(
        `${label}: unknown callout "[!${kind}]" — allowed: ${CALLOUT_KINDS.map((k) => `[!${k}]`).join(", ")}`,
      );
    }

    scenes.push({ path: entry.path, markdown: entry.content, properties: fm });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, result: { scenes, stubs, warnings: reply.warnings } };
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
function quickstatsErrors(fm: Record<string, unknown>): string[] {
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
    errors.push('"npc" must be an object with string "path" and "content"');
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
 * target address `npcs/<kebab-id>`, parseable properties whose `id` matches
 * the file name, a `name`, a valid NpcStatus (`alive` unless the source says
 * otherwise), no invented `chapter`, quoted quickstats, relationships only to
 * npcs that exist, only `[!secret]` inside `## Weiß`, only known callouts, and
 * an empty `## Notizen`. An id that already exists is an error too — the DM
 * can pin a different one via the request's `id`.
 */
export function validateNpcReply(
  raw: string,
  ctx: CampaignContext,
  pinnedId?: string,
): { ok: true; result: GenerateNpcResult } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const reply = parseRawNpcReply(raw, errors);
  if (reply === null) return { ok: false, errors };

  const entry = reply.npc;
  const label = `npc "${entry.path}"`;
  // Without a usable path nothing else can be judged (the id comes from it).
  if (!NPC_PATH_PATTERN.test(entry.path)) {
    return { ok: false, errors: [`${label}: path muss "npcs/<kebab-id>" sein`] };
  }
  const id = addressId(entry.path);
  if (pinnedId !== undefined && id !== pinnedId) {
    errors.push(`${label}: die id ist vorgegeben — der path muss "npcs/${pinnedId}" sein`);
  }
  if (ctx.npcIds.has(id)) {
    errors.push(
      `${label}: id "${id}" existiert schon in der Kampagne — andere id wählen ` +
        '(oder der DM gibt eine id über das Feld "id" vor)',
    );
  }

  const { parsed, error } = parseWithProperties(entry.content, entry.path);
  if (error !== undefined) {
    errors.push(`${label}: ${error}`);
    return { ok: false, errors };
  }
  const fm = parsed.properties;

  // `name` is NOT checked: the shared parser degrades a missing display name
  // to the id (README/parse.ts), so there is nothing mechanical left to
  // complain about — the prompt asks for one, the format survives without it.
  if (fm.id !== id) {
    errors.push(`${label}: properties id "${String(fm.id)}" passt nicht zum Dateinamen`);
  }
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
      npc: { path: entry.path, markdown: entry.content, properties: fm },
      warnings: reply.warnings,
    },
  };
}

// German on purpose: it is part of the (German) prompt conversation. The tail
// names what the corrected reply must still contain — the only part that
// differs between a scene run and an NPC run (issue #21).
function buildCorrectionMessage(errors: string[], tail: string): string {
  return [
    "Deine letzte Antwort hat die mechanische Validierung nicht bestanden:",
    errors.map((e) => `- ${e}`).join("\n"),
    `Antworte erneut mit dem vollständigen, korrigierten JSON — gleiches Schema, ${tail}, ` +
      "kein Text außerhalb des JSON-Blocks.",
  ].join("\n\n");
}

const SCENE_CORRECTION_TAIL = "alle Szenen und Stubs enthalten";
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
 * The truncation message (German — it goes straight into the UI). It names
 * the effective cap so the DM knows which number to raise; see the
 * LLM_MAX_TOKENS section of docs/DEPLOYMENT.md.
 */
export function truncationMessage(maxTokens: number | undefined): string {
  const current = maxTokens === undefined ? "Standard des Endpoints" : String(maxTokens);
  return (
    `Antwort wurde vom Modell abgeschnitten — LLM_MAX_TOKENS erhöhen ` +
    `(aktuell: ${current}) oder Quelltext verkleinern.`
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
  return runPipeline({
    req: {
      systemPrompt: assets.systemPrompt,
      fewShotTarget: assets.fewShotTarget,
      glossary: ctx.glossary,
      context: { chapter: ctx.chapter, npcs: ctx.npcs, locations: ctx.locations },
      sourceText,
    },
    provider: getProvider(),
    validate: (raw) => validateReply(raw, ctx),
    correctionTail: SCENE_CORRECTION_TAIL,
  });
}

/**
 * The provider loop itself, shared by both run kinds (issue #21) so the
 * mechanics can only ever be IDENTICAL: correction turns bounded by
 * LLM_CORRECTION_TURNS, truncation fail-fast before any validation, usage
 * summed over every call, and the raw reply in both 422 bodies.
 *
 * `validate` is the only difference between a scene run and an NPC run.
 */
async function runPipeline<T extends { usage?: GenerateUsage }>(input: {
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
  return runPipeline({
    req: {
      systemPrompt: assets.systemPrompt,
      fewShotTarget: assets.fewShotTarget,
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
}

// --- POST /api/:campaign/generate/apply -----------------------------------------

const SCENE_ITEM_KEYS = new Set(["path", "markdown", "properties"]);
const STUB_ITEM_KEYS = new Set(["kind", "id", "name", "markdown"]);
/** Same three keys as a scene draft — the client may pass the draft verbatim. */
const NPC_ITEM_KEYS = SCENE_ITEM_KEYS;

/** One validated file ready to be written. */
interface ApplyTarget {
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
function applySceneTarget(item: unknown, index: number): ApplyTarget {
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
  const segments = rel.split("/");
  if (segments.length < 2 || segments.length > 3 || RESERVED_DIRS.has(segments[0]!)) {
    throw new ApiError(
      400,
      `${label}.path must be "<chapter>/<scene>" or "<chapter>/<location-slug>/<scene>"`,
    );
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
function applyNpcTarget(item: unknown): ApplyTarget {
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
function applyStubTarget(item: unknown, index: number): ApplyTarget {
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
async function newChapterTarget(
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

  const seen = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.address)) throw new ApiError(400, `duplicate target path: ${draft.rel}`);
    seen.add(draft.address);
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

/** An entity id is a kebab slug — the README's stable reference key. */
const DRAFT_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
function assertDraftId(id: unknown, rel: string): void {
  if (id === undefined) return;
  if (typeof id !== "string" || !DRAFT_ID_PATTERN.test(id.trim())) {
    throw new ApiError(
      422,
      `${rel}: "id" must be a kebab-case slug (a-z, 0-9, single dashes) — ` +
        `"${String(id)}" cannot be addressed`,
    );
  }
}

/**
 * Where a draft will live: its address, with the id segment taken from the
 * properties when there is one. Only scenes can actually differ (an npc or
 * location draft is validated against its own segment, a chapter's id IS the
 * first segment), but the rule is stated once for all of them.
 */
function draftAddress(rel: string, properties: Record<string, unknown>): string {
  const id = typeof properties.id === "string" ? properties.id.trim() : "";
  if (id === "" || kindFromPath(rel) !== "scene") return rel;
  const segments = rel.split("/");
  const chapterId = segments[0] ?? "";
  const groupSlug = segments.length === 3 ? (segments[1] ?? "") : "";
  return scenePath(chapterId, groupSlug, id);
}
