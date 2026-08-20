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
// The provider is resolved lazily (per request, after the cheap request
// checks), so the read-only API never needs an API key (see server.ts).

import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_SCHEMA, dump } from "js-yaml";
import {
  CALLOUT_KINDS,
  NPC_STATUSES,
  SCENE_TYPES,
  parseMarkdown,
  type GenerateResult,
  type GenerateUsage,
  type GeneratedSceneDraft,
  type GeneratedStub,
  type ParsedFile,
} from "@grimoire/shared";
import {
  ApiError,
  assertSafeRelativeMdPath,
  campaignDir,
  collectCampaignFiles,
} from "./campaign-fs";
import { atomicWrite, withFileLock } from "./campaign-write";
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

let promptAssets: { systemPrompt: string; fewShotTarget: string } | null = null;

async function loadPromptAssets(): Promise<{ systemPrompt: string; fewShotTarget: string }> {
  if (promptAssets === null) {
    promptAssets = {
      systemPrompt: await readFile(path.join(GENERATOR_DIR, "system-prompt.md"), "utf8"),
      fewShotTarget: await readFile(path.join(GENERATOR_DIR, "example-output.md"), "utf8"),
    };
  }
  return promptAssets;
}

// --- context collection ------------------------------------------------------

interface CampaignContext {
  chapter: string;
  npcs: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  glossary: string;
  npcIds: Set<string>;
  locationIds: Set<string>;
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
 * Returns the campaign directory, so callers do not resolve it twice.
 */
export async function assertGenerateTarget(
  campaign: string,
  chapter: string,
  allowMissingChapter = false,
): Promise<string> {
  const dir = await campaignDir(campaign); // 400 unsafe id, 404 unknown campaign
  assertSafeChapterId(chapter);
  let chapterStats: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    chapterStats = await stat(path.join(dir, chapter));
  } catch {
    // missing — allowed only for the new-chapter flow (checked below)
  }
  if (chapterStats === null) {
    if (!allowMissingChapter) throw new ApiError(404, "chapter not found");
  } else if (!chapterStats.isDirectory()) {
    throw new ApiError(404, "chapter not found");
  }
  return dir;
}

/**
 * Collect the prompt context. Runs the same target checks again (they are
 * cheap and the pipeline must never depend on a caller having done them);
 * the chapter contributes only its id to the context, so nothing else
 * changes when its directory (and _chapter.md) are still missing.
 */
async function collectContext(
  campaign: string,
  chapter: string,
  allowMissingChapter = false,
): Promise<CampaignContext> {
  const dir = await assertGenerateTarget(campaign, chapter, allowMissingChapter);

  const files = await collectCampaignFiles(campaign);
  const pick = (kind: "npc" | "location") =>
    files
      .filter((f) => f.kind === kind)
      .map((f) => ({
        id: String(f.frontmatter.id),
        name: String(f.frontmatter.name ?? f.frontmatter.id),
      }));
  const npcs = pick("npc");
  const locations = pick("location");

  let glossary = "";
  try {
    const raw = await readFile(path.join(dir, "glossary.md"), "utf8");
    glossary = parseMarkdown(raw, "glossary.md", 0).body;
  } catch {
    // no glossary — send an empty one
  }

  return {
    chapter,
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

/** Filename of a campaign-relative path, without the `.md` extension. */
function fileStem(rel: string): string {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

/**
 * "Frontmatter parseable" through the shared parser: the parser never
 * throws, it DEGRADES — a missing or broken block leaves the whole raw text
 * as the body. So: parseable iff the content opens a block and the parser
 * actually split it off.
 */
function parseWithFrontmatter(
  content: string,
  rel: string,
): { parsed: ParsedFile; error?: string } {
  const parsed = parseMarkdown(content, rel, 0);
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { parsed, error: "missing frontmatter block" };
  }
  if (parsed.body === content) return { parsed, error: "frontmatter is not parseable YAML" };
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
  const present = Object.hasOwn(fm, "status");
  if (kind === "location") {
    return present ? ['"status" ist nicht erlaubt — locations haben keinen status'] : [];
  }
  if (!present) return ['"status" fehlt — NPC-Stubs brauchen einen status (im Normalfall "alive")'];
  const status = fm.status;
  if (typeof status !== "string" || !(NPC_STATUSES as readonly string[]).includes(status)) {
    return [
      `"status" muss einer von ${NPC_STATUSES.join(", ")} sein — ` +
        'NPC-Stubs im Normalfall "alive"',
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
  if (!new RegExp(`^${dirName}/[a-z0-9][a-z0-9-]*\\.md$`).test(entry.path)) {
    errors.push(`${label}: path must be "${dirName}/<kebab-case-id>.md"`);
    return null;
  }
  const { parsed, error } = parseWithFrontmatter(entry.content, entry.path);
  if (error !== undefined) {
    errors.push(`${label}: ${error}`);
    return null;
  }
  const id = fileStem(entry.path);
  const fmId = parsed.frontmatter.id;
  if (typeof fmId === "string" && fmId !== id) {
    errors.push(`${label}: frontmatter id "${fmId}" does not match the filename`);
    return null;
  }
  // A status error does not stop the mapping: the stub still resolves the
  // scene's reference, so the correction turn gets the ONE real error
  // instead of a cascade of "npc does not exist".
  for (const msg of stubStatusErrors(kind, parsed.frontmatter)) errors.push(`${label}: ${msg}`);
  return {
    kind,
    id,
    name: typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : id,
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
  ctx: CampaignContext,
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
      assertSafeRelativeMdPath(entry.path);
    } catch {
      errors.push(`${label}: invalid path`);
      continue;
    }
    const segments = entry.path.split("/");
    if (segments[0] !== ctx.chapter || segments.length < 2 || segments.length > 3) {
      errors.push(
        `${label}: path must be "${ctx.chapter}/<scene>.md" or "${ctx.chapter}/<location-slug>/<scene>.md"`,
      );
    }
    if (seenPaths.has(entry.path)) errors.push(`${label}: duplicate path`);
    seenPaths.add(entry.path);

    const { parsed, error } = parseWithFrontmatter(entry.content, entry.path);
    if (error !== undefined) {
      errors.push(`${label}: ${error}`);
      continue;
    }
    const fm = parsed.frontmatter;

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

    scenes.push({ path: entry.path, markdown: entry.content, frontmatter: fm });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, result: { scenes, stubs, warnings: reply.warnings } };
}

// German on purpose: it is part of the (German) prompt conversation.
function buildCorrectionMessage(errors: string[]): string {
  return [
    "Deine letzte Antwort hat die mechanische Validierung nicht bestanden:",
    errors.map((e) => `- ${e}`).join("\n"),
    "Antworte erneut mit dem vollständigen, korrigierten JSON — gleiches Schema, " +
      "alle Szenen und Stubs enthalten, kein Text außerhalb des JSON-Blocks.",
  ].join("\n\n");
}

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
  const ctx = await collectContext(campaign, chapter, newChapter);
  const assets = await loadPromptAssets();
  const provider = getProvider();

  const req: GenerateRequest = {
    systemPrompt: assets.systemPrompt,
    fewShotTarget: assets.fewShotTarget,
    glossary: ctx.glossary,
    context: { chapter: ctx.chapter, npcs: ctx.npcs, locations: ctx.locations },
    sourceText,
  };

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

    const outcome = validateReply(raw, ctx);
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
    corrections.push({ assistant: raw, correction: buildCorrectionMessage(outcome.errors) });
  }
}

// --- POST /api/:campaign/generate/apply -----------------------------------------

const SCENE_ITEM_KEYS = new Set(["path", "markdown", "frontmatter"]);
const STUB_ITEM_KEYS = new Set(["kind", "id", "name", "markdown"]);

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
  assertSafeRelativeMdPath(rel); // 400 on traversal/absolute/non-md
  const segments = rel.split("/");
  if (segments.length < 2 || segments.length > 3 || RESERVED_DIRS.has(segments[0]!)) {
    throw new ApiError(
      400,
      `${label}.path must be "<chapter>/<scene>.md" or "<chapter>/<location-slug>/<scene>.md"`,
    );
  }
  // Re-validation (apply is a separate request — never trust the client):
  // the frontmatter must still parse and the draft must still be a draft.
  const { parsed, error } = parseWithFrontmatter(markdown, rel);
  if (error !== undefined) throw new ApiError(400, `${label}: ${error}`);
  if (parsed.frontmatter.status !== "draft") {
    throw new ApiError(400, `${label}: "status" must be "draft"`);
  }
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
  const rel = `${kind}s/${id}.md`;
  assertSafeRelativeMdPath(rel); // defense in depth — the slug check above rules escapes out
  const { parsed, error } = parseWithFrontmatter(markdown, rel);
  if (error !== undefined) throw new ApiError(400, `${label}: ${error}`);
  // Re-validation, same as for scenes: a client payload must not sneak a
  // stub status past the reply validation (issue #27).
  const statusError = stubStatusErrors(kind, parsed.frontmatter)[0];
  if (statusError !== undefined) throw new ApiError(400, `${label}: ${statusError}`);
  return { rel, markdown };
}

/**
 * The new-chapter flow (issue #12): `chapter` + `chapterTitle` mean "the
 * drafts go into a chapter that does not exist yet". Returns the
 * `<chapter>/_chapter.md` target to create in the same batch, or null when
 * the file is already there (idempotent — an existing chapter is not a
 * conflict). Minimal frontmatter per the examples convention
 * (id/title/status: planned — a generator-created chapter is upcoming,
 * never the active one); the body stays empty and degrades.
 */
async function newChapterTarget(
  dir: string,
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
  const rel = `${chapter}/_chapter.md`;
  try {
    await stat(path.resolve(dir, rel));
    return null; // chapter already has its file — nothing to create
  } catch {
    // missing — create it below
  }
  const yaml = dump(
    { id: chapter, title, status: "planned" },
    { schema: CORE_SCHEMA, flowLevel: 1, lineWidth: -1 },
  );
  return { rel, markdown: `---\n${yaml}---\n` };
}

/**
 * Write reviewed drafts to disk. Validates ALL files first (400), then
 * checks ALL target paths for conflicts (409 with the conflicting paths,
 * nothing partially written), then writes via the shared per-file locks and
 * atomic writes. Returns the written campaign-relative paths.
 *
 * `chapter`/`chapterTitle` (both or neither) add the chapter's `_chapter.md`
 * to the SAME all-or-nothing batch when it does not exist yet — the app's
 * "Neues Kapitel" flow.
 */
export async function applyGenerated(
  campaign: string,
  scenes: unknown,
  stubs: unknown,
  chapter?: unknown,
  chapterTitle?: unknown,
): Promise<{ written: string[] }> {
  const dir = await campaignDir(campaign);

  if (scenes !== undefined && !Array.isArray(scenes)) {
    throw new ApiError(400, "scenes must be an array");
  }
  if (stubs !== undefined && !Array.isArray(stubs)) {
    throw new ApiError(400, "stubs must be an array");
  }
  const targets: ApplyTarget[] = [
    ...((scenes as unknown[] | undefined) ?? []).map(applySceneTarget),
    ...((stubs as unknown[] | undefined) ?? []).map(applyStubTarget),
  ];
  if (targets.length === 0) throw new ApiError(400, "nothing to apply");

  // The chapter file comes first — the drafts live inside it.
  const chapterFile = await newChapterTarget(dir, chapter, chapterTitle);
  if (chapterFile !== null) targets.unshift(chapterFile);

  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.rel)) throw new ApiError(400, `duplicate target path: ${t.rel}`);
    seen.add(t.rel);
  }

  // Validate ALL, then write: collect every conflict before touching disk.
  const conflicts: string[] = [];
  for (const t of targets) {
    try {
      await stat(path.resolve(dir, t.rel));
      conflicts.push(t.rel);
    } catch {
      // does not exist — good
    }
  }
  if (conflicts.length > 0) {
    throw new ApiError(409, "target files already exist", { conflicts });
  }

  const written: string[] = [];
  for (const t of targets) {
    const abs = path.resolve(dir, t.rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await withFileLock(abs, () => atomicWrite(abs, t.markdown));
    written.push(t.rel);
  }
  return { written };
}
