// LLM provider abstraction: Claude API to start with, any OpenAI-compatible
// endpoint (OpenRouter, LM Studio, …) as the alternative — switching is a
// config change, not a code change (DECISIONS #6).
//
// Providers are pure transports: they build the prompt, replay prior
// correction turns and return the model's RAW text reply. Parsing and
// mechanical validation live in generator.ts — a malformed reply is a
// validation error that goes back to the model as a correction turn, not an
// exception (generator/README.md step 4).
//
// EVERY request carries the schema of the object it wants
// back — the outline its own (shared/outline-schema), an entry call the
// object that mirrors the stored row (shared/entry-schema) — and the
// transports force it, because that is the one guarantee an API can give:
//
//   Claude — the schema travels as a TOOL and `tool_choice` forces the call,
//       so the reply cannot be prose, cannot miss a required key and cannot
//       break on a quotation mark; the reply text is the tool input.
//   OpenAI-compatible — `response_format: json_schema` with `strict: true`,
//       with ONE fallback to plain `json_object` for endpoints that reject
//       the field (detected once per process, and only on a 400 that actually
//       blames the format).
//
// The assistant prefill of `{` is gone for good: a forced tool
// and a forced `response_format` do the job, and a prefilled brace in front
// of a reply the API already shapes is only in the way.
//
// Two facts travel WITH the text, because only the transport can see them:
// whether the model hit its output cap (`finish_reason: length`
// / `stop_reason: max_tokens` — a truncated reply is unfixable by a
// correction turn, so the generator fails fast on it) and the API's token
// usage, normalized so the generator can sum it over a whole run.

import type { GeneratedEntryKind, LocationProposal } from "@grimoire/shared";
import type { JsonSchema } from "@grimoire/shared/outline-schema";

import { toReplyProperties } from "./entry-reply";

export interface GenerateRequest {
  systemPrompt: string; // generator/system-prompt.md (npc run: npc-system-prompt.md)
  fewShotTarget: string; // generator/example-output.json (npc run: npc-example-output.json)
  /**
   * The campaign-knowledge lines, already rendered and with
   * `[[slug]]` references resolved (store/knowledge.ts knowledgeText). `""` means
   * the campaign has none — the prompt then has no knowledge section at all,
   * so a campaign that never uses the feature sees the prompt unchanged.
   */
  knowledge: string;
  glossary: string; // the campaign's glossary as `term → explanation` lines ("" when empty)
  context: {
    /** Target chapter of a scene run; absent for an NPC run. */
    chapter?: string;
    /** The run creates `chapter` — set on the outline call of such a run only. */
    newChapter?: boolean;
    npcs: Array<{ id: string; name: string }>;
    locations: Array<{ id: string; name: string }>;
    /** Id the DM pinned for the generated entry (NPC run) — absent: free choice. */
    targetId?: string;
  };
  sourceText: string; // English source text ("" when a run has none)
  /**
   * The run's OUTLINE, rendered as prompt lines: every scene id
   * with its title/type/location and every suggested entry. It travels with
   * each per-scene and per-entry call so cross references can only ever name
   * ids that exist — and it is part of the CONSTANT prefix, which is what
   * makes prompt caching worth having for a run with many parts.
   *
   * Absent for the single-call runs; then the prompt has no such section.
   */
  outline?: string;
  /**
   * WHICH part of the outline this one call writes, as prompt
   * lines. It belongs to the VARIABLE half on purpose: the outline block is
   * identical for every call of a run and is therefore cacheable, and a
   * per-part marker inside it would make every part's prefix a different
   * one — which is exactly the saving prompt caching is for.
   *
   * Absent for the entry calls (their `vorgegebene id` already says it) and
   * for the single-call runs.
   */
  assignment?: string;
  /**
   * The entry an AUGMENT run works on: its address, its kind and its two
   * halves, the properties and the body, exactly as the store holds them.
   * Absent for the two runs that create something — and then the prompt has
   * no such section.
   *
   * The transport decides how it LOOKS in the prompt
   * (`formatExistingEntry`): the entry travels as data here, and turning it
   * into prompt text is formatting, not a storage format. The `kind` is what
   * that formatting needs to know which properties a reply shapes differently
   * from the store.
   */
  existingEntry?: {
    path: string;
    kind: GeneratedEntryKind;
    properties: Record<string, unknown>;
    body: string;
  };
  /**
   * The location a LOCATION augment run works on, every field of it without
   * its guard — shown as the very object the reply is forced into. Absent
   * for every other run.
   */
  existingLocation?: LocationProposal;
  /**
   * The DM's free instruction of an augment run („Führe einen Handlungsstrang
   * um den Schmuggler-Spitzel ein"). Either this or `sourceText` is there —
   * the dialog requires at least one of them.
   */
  instruction?: string;
  /**
   * The JSON schema the reply must satisfy. Every call sets it —
   * the outline its own, an entry call its kind's. It stays OPTIONAL in the
   * type so a caller that forces nothing (and a test that wants the unforced
   * transport) is still a legal request.
   */
  jsonSchema?: ReplySchema;
}

/** A schema a provider can force a reply into — see GenerateRequest.jsonSchema. */
export interface ReplySchema {
  /** Tool name (Claude) / `json_schema.name` (OpenAI). */
  name: string;
  /** What the tool is for; only the Claude path sends it. */
  description: string;
  schema: JsonSchema;
}

/**
 * One failed attempt, replayed into the next call: the model's previous raw
 * reply as an assistant turn, followed by the validation errors as the next
 * user turn.
 */
export interface CorrectionTurn {
  assistant: string;
  correction: string;
}

/** Token usage of one call, normalized across the APIs' different key names. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /**
   * How many of `inputTokens` came out of the prompt cache.
   * Reporting only — it is what tells us whether caching actually engages on
   * a routed model, and it is absent when the endpoint says nothing about it.
   * NOT part of the job totals: a cached token was still sent, so the run's
   * „~N Tokens" must keep counting it (same reasoning as claudeUsage).
   */
  cachedInputTokens?: number;
}

/** One completion: the raw text plus what only the transport can know. */
export interface CompletionResult {
  /** The model's RAW text reply (unparsed, fences included). */
  text: string;
  /** The reply hit the output cap — it is cut off, not merely malformed. */
  truncated: boolean;
  /** Absent when the endpoint reports no usage (some local servers do not). */
  usage?: TokenUsage;
}

export interface LLMProvider {
  readonly name: string;
  /**
   * Effective output cap in tokens, or undefined when the endpoint's own
   * default applies. Read-only reporting only — the truncation message names
   * it so the DM knows which value to raise.
   */
  readonly maxTokens?: number;
  /** One completion: prompt (+ prior correction turns) -> raw model reply. */
  complete(req: GenerateRequest, corrections?: CorrectionTurn[]): Promise<CompletionResult>;
}

/**
 * Normalize one API's usage object. Absent object -> undefined; a present
 * object with unusable numbers counts as 0 rather than failing the run —
 * cost reporting must never take a successful generation down.
 */
function normalizeUsage(
  raw: unknown,
  inputKey: string,
  outputKey: string,
): TokenUsage | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const inputTokens = num(obj[inputKey]);
  const outputTokens = num(obj[outputKey]);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
}

/**
 * Claude's usage, with the CACHE buckets folded into the input count: with
 * `cache_control` in play the API reports the cached prefix under
 * `cache_read_input_tokens` / `cache_creation_input_tokens` and leaves
 * `input_tokens` with the uncached tail only. Summing them keeps the review's
 * „~N Tokens" the honest size of what was sent — caching makes a run cheaper,
 * it does not make it smaller.
 */
export function claudeUsage(raw: unknown): TokenUsage | undefined {
  const base = normalizeUsage(raw, "input_tokens", "output_tokens");
  if (base === undefined) return undefined;
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    inputTokens:
      base.inputTokens +
      num(obj.cache_creation_input_tokens) +
      num(obj.cache_read_input_tokens),
    outputTokens: base.outputTokens,
  };
}

/**
 * An OpenAI-compatible endpoint's usage. `prompt_tokens` already INCLUDES the
 * cached prefix there (unlike the Messages API, which splits it out), so the
 * only extra thing to pick up is how much of it was a cache hit — OpenRouter
 * and OpenAI both report it under `prompt_tokens_details.cached_tokens`
 *. Absent on endpoints that do not cache, and never fatal.
 */
export function openAIUsage(raw: unknown): TokenUsage | undefined {
  const base = normalizeUsage(raw, "prompt_tokens", "completion_tokens");
  if (base === undefined) return undefined;
  const details = (raw as Record<string, unknown>).prompt_tokens_details;
  if (details === null || typeof details !== "object") return base;
  const cached = (details as Record<string, unknown>).cached_tokens;
  if (typeof cached !== "number" || !Number.isFinite(cached)) return base;
  return { ...base, cachedInputTokens: cached };
}

// ---------------------------------------------------------------------------

/**
 * The heading of the campaign-knowledge block. The WORDING is
 * the contract — it is what makes the block binding rather than advisory, so
 * it is a constant the prompt test asserts on and not an inline string.
 *
 * It stands FIRST, above the glossary: the glossary answers "what is this
 * term called", the knowledge overrides what the source material says, and a
 * model reading top to bottom must meet the override before the vocabulary.
 */
export const KNOWLEDGE_HEADING =
  "## Kampagnenwissen — immer anwenden, auch wenn das Quellmaterial anders lautet";

/**
 * Heading of the augment run's „this is what already stands there" block.
 * A constant for the same reason KNOWLEDGE_HEADING is one: the prompt test
 * asserts on it, and the E2E stub reads the prompt by it.
 */
export const EXISTING_ENTRY_HEADING = "## Bestehender Eintrag — ergänzen, nicht ersetzen";

/** The same block of a location augment run. */
export const EXISTING_LOCATION_HEADING = "## Bestehender Ort — ergänzen, nicht ersetzen";

/** Heading of the DM's free instruction of an augment run. */
export const INSTRUCTION_HEADING = "## Anweisung des DM";

/**
 * Heading of the run's outline block. A constant for the same
 * reason the others are: the prompt test asserts on it and the E2E stub reads
 * the prompt by it — it is how the stub tells an outline call from a
 * per-scene one.
 */
export const OUTLINE_HEADING = "## Gliederung des Durchlaufs — verbindlich, ids unverändert übernehmen";

/**
 * Heading of the line that says WHICH scene of the outline this call writes.
 * It stands in the VARIABLE half, above the excerpt: the
 * outline block above it is byte-identical for every part of a run, which is
 * what makes the cached prefix worth anything. A constant for the same reason
 * the others are — the prompt test asserts on it and the E2E stub reads the
 * prompt by it.
 */
export const ASSIGNMENT_HEADING = "## Diese Szene schreibst du jetzt";

/**
 * The context line of a new-chapter run's outline call: the chapter in the
 * `chapter:` line does not exist yet, so the outline also describes it
 * (`chapterDescription`, outline-system-prompt.md). A constant because the
 * outline schema's description and the prompt name this exact line, and the
 * E2E stub reads the prompt by it.
 */
export const NEW_CHAPTER_LINE = "neues Kapitel: ja";

/**
 * The existing entry of an augment run, as PROMPT TEXT: the `properties` and
 * `body` pair as pretty-printed JSON — the very shape the reply is forced
 * into, so the model reads the entry the way it has to write it back.
 *
 * „The way it has to write it back" is why the properties go through
 * `toReplyProperties` (entry-reply.ts) first: a `pairs` field is STORED as a
 * mapping (`{ "insight": 2 }`) and REPLIED as a `{ key, value }` list, and a
 * model shown the mapping answers with the mapping — which its own schema
 * then rejects.
 *
 * This is formatting and nothing else. Nothing parses this text again: the
 * proposal is validated against the entry's own halves
 * (generator-augment.ts), and the store never sees it.
 */
export function formatExistingEntry(entry: {
  kind: GeneratedEntryKind;
  properties: Record<string, unknown>;
  body: string;
}): string {
  return JSON.stringify(
    { properties: toReplyProperties(entry.kind, entry.properties), body: entry.body },
    null,
    2,
  );
}

// The prompt content is German on purpose — the pipeline's target language
// is German (see generator/system-prompt.md); only code and comments here
// are English.
/**
 * The prompt in TWO halves — the split prompt caching hangs off:
 *
 *   constant  everything that is the same for every call of a run: the
 *             campaign knowledge, the glossary, the context lists, the
 *             few-shot and the run's outline. It stands FIRST, so an
 *             OpenAI-compatible endpoint's implicit prefix caching sees the
 *             same prefix on every part of a run without being told.
 *   variable  what this ONE call is about: the entry an augment run works on,
 *             the DM's instruction, the source text (for a pipeline part: its
 *             excerpt).
 *
 * The Claude provider marks the constant half (and the system prompt) with
 * `cache_control: ephemeral`; everything else joins the two with the same
 * blank line `buildPrompt` joins with, so a single-call run sees one prompt
 * and the split costs it not a single character.
 */
export function buildPromptParts(req: GenerateRequest): { constant: string; variable: string } {
  const npcList = req.context.npcs.map((n) => `${n.id} (${n.name})`).join(", ");
  const locList = req.context.locations
    .map((l) => `${l.id} (${l.name})`)
    .join(", ");
  const constant = [
    // Nothing at all when there is no knowledge — an empty binding section
    // would be a heading the model has to interpret against no content.
    ...(req.knowledge.trim() === "" ? [] : [KNOWLEDGE_HEADING, req.knowledge]),
    "## Glossar",
    req.glossary,
    "## Kontext",
    // Only the lines that HAVE a value: an NPC run has no target chapter,
    // and a pinned id only exists when the DM typed one.
    [
      ...(req.context.chapter === undefined ? [] : [`chapter: ${req.context.chapter}`]),
      ...(req.context.newChapter === true ? [NEW_CHAPTER_LINE] : []),
      `npcs: ${npcList || "(keine)"}`,
      `locations: ${locList || "(keine)"}`,
      ...(req.context.targetId === undefined ? [] : [`vorgegebene id: ${req.context.targetId}`]),
    ].join("\n"),
    "## Referenz-Zieleintrag (Few-Shot)",
    // The few-shot is a REPLY: every prompt's example is the JSON object its
    // schema describes, so the fence says json and the model sees the shape
    // it will be forced into. The augment run's „Bestehender Eintrag" below
    // is shown in that same shape, so the model reads the entry the way it
    // has to answer about it.
    "```json",
    req.fewShotTarget,
    "```",
    // The outline stands below the few-shot and above what this call is
    // about: the model has to know which ids exist before it reads the
    // excerpt it has to write from.
    ...(req.outline === undefined || req.outline.trim() === ""
      ? []
      : [OUTLINE_HEADING, req.outline]),
  ].join("\n\n");
  const variable = [
    // What this call is FOR, first thing in the variable half: the model has
    // read the outline above and now learns which line of it is its job.
    ...(req.assignment === undefined || req.assignment.trim() === ""
      ? []
      : [ASSIGNMENT_HEADING, req.assignment]),
    // The augment run's two extra sections. They stand BELOW the
    // few-shot (which is the FORMAT reference) and ABOVE the source text: the
    // model has to know what the entry is before it reads what to add to it.
    ...(req.existingEntry === undefined
      ? []
      : [
          `${EXISTING_ENTRY_HEADING} (${req.existingEntry.path})`,
          "```json",
          formatExistingEntry(req.existingEntry),
          "```",
        ]),
    ...(req.existingLocation === undefined
      ? []
      : [
          `${EXISTING_LOCATION_HEADING} (${req.existingLocation.id})`,
          "```json",
          JSON.stringify(req.existingLocation, null, 2),
          "```",
        ]),
    ...(req.instruction === undefined || req.instruction.trim() === ""
      ? []
      : [INSTRUCTION_HEADING, req.instruction]),
    // A run may have an instruction and no source text; an empty
    // heading would be one the model has to interpret against nothing.
    ...(req.sourceText.trim() === "" ? [] : ["## Quelltext", req.sourceText]),
  ].join("\n\n");
  return { constant, variable };
}

// The prompt content is German on purpose — the pipeline's target language
// is German (see generator/system-prompt.md); only code and comments here
// are English.
export function buildPrompt(req: GenerateRequest): string {
  const { constant, variable } = buildPromptParts(req);
  return variable === "" ? constant : `${constant}\n\n${variable}`;
}

/** Chat turns: the initial prompt plus one assistant/user pair per retry. */
function buildMessages(
  req: GenerateRequest,
  corrections: CorrectionTurn[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: buildPrompt(req) },
  ];
  for (const turn of corrections) {
    messages.push({ role: "assistant", content: turn.assistant });
    messages.push({ role: "user", content: turn.correction });
  }
  return messages;
}

/**
 * The same turns as `buildMessages`, but with the first user turn SPLIT into
 * content parts so the constant half can carry a `cache_control` breakpoint
 *. OpenRouter passes the field through to the provider; for the
 * routed Anthropic models that breakpoint is the only way to get caching,
 * and a run of a whole chapter re-sends that half once per scene.
 *
 * The split mirrors `claudeMessages` exactly — same halves, same order, same
 * blank-line join when read as one text — so the model sees the prompt it saw
 * before. Correction turns stay plain strings: they are unique per attempt,
 * so marking them would only spend cache writes.
 */
export function cachedMessages(
  req: GenerateRequest,
  corrections: CorrectionTurn[],
): Array<{ role: "user" | "assistant"; content: unknown }> {
  const { constant, variable } = buildPromptParts(req);
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    {
      role: "user",
      content: [
        { type: "text", text: constant, cache_control: EPHEMERAL },
        ...(variable === "" ? [] : [{ type: "text", text: variable }]),
      ],
    },
  ];
  for (const turn of corrections) {
    messages.push({ role: "assistant", content: turn.assistant });
    messages.push({ role: "user", content: turn.correction });
  }
  return messages;
}

// --- JSON forcing: every call, by schema ------------------------------------
//
// An earlier shape forced JSON by prefilling `{` and by `response_format:
// json_object`. Both are replaced by the SCHEMA of the request: a forced tool
// on the Messages API, `json_schema` with `strict: true` on the OpenAI path —
// the shape is guaranteed rather than merely asked for.

// --- Claude API ------------------------------------------------------------

/** The one cache breakpoint kind the Messages API offers. */
export const EPHEMERAL = { type: "ephemeral" } as const;

/**
 * The Claude turns of one attempt: the first user turn is SPLIT into the
 * cacheable constant prefix and this call's own variable tail; the replayed
 * correction turns are plain strings — they are unique per attempt, so
 * marking them would only spend cache writes.
 */
export function claudeMessages(
  req: GenerateRequest,
  corrections: CorrectionTurn[],
): Array<{ role: "user" | "assistant"; content: unknown }> {
  const { constant, variable } = buildPromptParts(req);
  const first = [
    { type: "text", text: constant, cache_control: EPHEMERAL },
    ...(variable === "" ? [] : [{ type: "text", text: variable }]),
  ];
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    { role: "user", content: first },
  ];
  for (const turn of corrections) {
    messages.push({ role: "assistant", content: turn.assistant });
    messages.push({ role: "user", content: turn.correction });
  }
  return messages;
}

/** Output cap when nothing is configured — enough for a full scene batch. */
export const DEFAULT_MAX_TOKENS = 8000;

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  constructor(
    private apiKey: string,
    private model = "claude-sonnet-5",
    // The Messages API requires max_tokens, so this one is never undefined.
    readonly maxTokens: number = DEFAULT_MAX_TOKENS,
  ) {}

  async complete(
    req: GenerateRequest,
    corrections: CorrectionTurn[] = [],
  ): Promise<CompletionResult> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(claudeBody(req, corrections, this.model, this.maxTokens)),
    });
    if (!res.ok) throw new Error(`Claude API: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return {
      text: claudeText(data, req.jsonSchema !== undefined),
      // Messages API: the reply stopped because it ran into max_tokens.
      truncated: data.stop_reason === "max_tokens",
      usage: claudeUsage(data.usage),
    };
  }
}

/**
 * The Messages API request body. Split out of `complete` because the two
 * reply shapes differ HERE and nowhere else: a schema request
 * carries the schema as a forced tool, an entry request carries nothing
 * extra at all.
 */
export function claudeBody(
  req: GenerateRequest,
  corrections: CorrectionTurn[],
  model: string,
  maxTokens: number,
): Record<string, unknown> {
  const schema = req.jsonSchema;
  return {
    model,
    max_tokens: maxTokens,
    // Prompt caching: the system prompt and the CONSTANT half of
    // the user turn are the same for every part of a run, so both carry an
    // ephemeral cache breakpoint. A pipelined run with N scenes reads that
    // prefix N+1 times — paying for it once is the difference between "per
    // scene" being affordable and not.
    system: [{ type: "text", text: req.systemPrompt, cache_control: EPHEMERAL }],
    messages: claudeMessages(req, corrections),
    // The reply's schema: it travels as a TOOL and the call is
    // forced, so the reply cannot be prose and cannot miss a required key —
    // the API validates it before we do. Absent only for a request that
    // deliberately forces nothing.
    ...(schema === undefined
      ? {}
      : {
          tools: [
            {
              name: schema.name,
              description: schema.description,
              input_schema: schema.schema,
            },
          ],
          tool_choice: { type: "tool", name: schema.name },
        }),
  };
}

/**
 * The reply text of one Messages API answer. For a forced tool call that is
 * the tool INPUT re-serialized — the validation downstream reads JSON, and
 * the API hands the arguments over as a parsed object. `text` blocks are the
 * fallback: an API that answered prose anyway must reach the validation as
 * prose, not as an empty reply the run cannot explain.
 */
export function claudeText(data: unknown, wantsTool: boolean): string {
  const blocks = Array.isArray((data as { content?: unknown }).content)
    ? ((data as { content: Array<Record<string, unknown>> }).content)
    : [];
  if (wantsTool) {
    const call = blocks.find((b) => b.type === "tool_use" && b.input !== undefined);
    if (call !== undefined) return JSON.stringify(call.input);
  }
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

// --- OpenAI-compatible endpoints (OpenRouter, LM Studio, vLLM, …) -----------

export interface OpenAICompatOptions {
  /** API root WITHOUT the trailing /chat/completions, e.g. ".../api/v1". */
  baseUrl: string;
  model: string;
  /** Sent as `Authorization: Bearer …`; omitted for keyless local servers. */
  apiKey?: string;
  /** Extra headers, e.g. OpenRouter's attribution headers. */
  extraHeaders?: Record<string, string>;
  /** Output cap; omitted from the body when unset (endpoint's own default). */
  maxTokens?: number;
  /**
   * Force the reply shape of every call that carries a schema:
   * `response_format: json_schema` with a fallback to `json_object`. Default
   * on; the factory turns it off for `LLM_FORCE_JSON=0`, because some routed
   * endpoints reject the field and would fail every single run.
   */
  forceJson?: boolean;
  /**
   * Mark the constant prompt half with an explicit `cache_control` breakpoint
   *. Default OFF, because a plain `/chat/completions` server is
   * free to reject an unknown message field — the factory switches it on for
   * OpenRouter, where it is what makes caching happen at all for the routed
   * Anthropic models (they cache only on an explicit breakpoint).
   */
  promptCache?: boolean;
  /** Shown in error messages ("openrouter: 401 …"). */
  name?: string;
}

/**
 * One transport for every OpenAI-compatible /chat/completions endpoint. The
 * request shape is identical everywhere; only base URL, model and auth
 * differ, and those come from the environment (see createProvider).
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name: string;
  private baseUrl: string;
  private model: string;
  private apiKey?: string;
  private extraHeaders: Record<string, string>;
  private forceJson: boolean;
  private promptCache: boolean;
  readonly maxTokens?: number;

  constructor(opts: OpenAICompatOptions) {
    this.name = opts.name ?? "openai";
    // A trailing slash would produce "…//chat/completions" on some servers.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.extraHeaders = opts.extraHeaders ?? {};
    this.forceJson = opts.forceJson ?? true;
    this.promptCache = opts.promptCache ?? false;
    this.maxTokens = opts.maxTokens;
  }

  async complete(
    req: GenerateRequest,
    corrections: CorrectionTurn[] = [],
  ): Promise<CompletionResult> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.extraHeaders,
    };
    // No key => no auth header at all (LM Studio and friends reject or
    // ignore a bogus one).
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const send = (responseFormat: JsonSchema | undefined): Promise<Response> =>
      fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(this.body(req, corrections, responseFormat)),
      });

    const wanted = this.responseFormat(req);
    let res = await send(wanted);
    // An endpoint that rejects `json_schema` (400) gets ONE retry with plain
    // `json_object` — and the downgrade is remembered for the process, so the
    // next outline call does not pay for the discovery again.
    // Only a 400 counts: a 401 or a 500 says nothing about the field, and
    // retrying those would double every failing request.
    //
    // But not EVERY 400 is about the field, and the latch is permanent: a
    // request that was too long, a model id that does not exist, a content
    // filter all answer 400 too, and latching on those would throw the
    // forced shape away for the rest of the process over an unrelated error
    // — so the downgrade is only remembered when the error
    // body actually talks about the format — or when the plain retry proves
    // it by succeeding. Otherwise the original 400 is what the caller sees.
    if (!res.ok && res.status === 400 && isJsonSchemaFormat(wanted)) {
      const body = await res.text();
      const retry = await send(JSON_OBJECT_FORMAT);
      if (!retry.ok && !mentionsResponseFormat(body)) {
        throw new Error(`${this.name}: 400 ${body}`);
      }
      jsonSchemaRejected = true;
      console.log(
        `${this.name}: response_format json_schema was rejected (400) — ` +
          "falling back to json_object for this process",
      );
      res = retry;
    }
    if (!res.ok) throw new Error(`${this.name}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const choice = data.choices[0];
    const content = choice?.message?.content;
    return {
      text: typeof content === "string" ? content : "",
      // OpenAI-compatible: "length" means the cap cut the reply off.
      truncated: choice?.finish_reason === "length",
      usage: openAIUsage(data.usage),
    };
  }

  /** The request body, `response_format` included as given. */
  body(
    req: GenerateRequest,
    corrections: CorrectionTurn[],
    responseFormat: JsonSchema | undefined,
  ): Record<string, unknown> {
    return {
      model: this.model,
      messages: [
        { role: "system", content: req.systemPrompt },
        // Prompt caching: with an explicit breakpoint the
        // constant half of the prompt travels as its own content part, so a
        // chapter run pays for it once instead of once per scene. Orthogonal
        // to `response_format` — the split is about the message content, the
        // format about the reply shape.
        ...(this.promptCache
          ? cachedMessages(req, corrections)
          : buildMessages(req, corrections)),
      ],
      temperature: 0.3,
      // Unset means "endpoint default" — local servers and routed models
      // disagree about sensible caps, so we do not invent one.
      ...(this.maxTokens === undefined ? {} : { max_tokens: this.maxTokens }),
      ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
    };
  }

  /**
   * What this call asks the endpoint to guarantee:
   * `json_schema` with `strict: true` for every request that carries a
   * schema — or plain `json_object` once an endpoint has been seen to reject
   * the schema form, and nothing at all for a request without one.
   *
   * `LLM_FORCE_JSON=0` turns it off for endpoints that reject the field
   * altogether; the tolerant reader in ./entry-reply (fence, brace span,
   * one `jsonrepair` pass) stays the safety net for endpoints that accept the
   * field and ignore it.
   */
  responseFormat(req: GenerateRequest): JsonSchema | undefined {
    const schema = req.jsonSchema;
    if (schema === undefined || !this.forceJson) return undefined;
    if (jsonSchemaRejected) return JSON_OBJECT_FORMAT;
    return {
      type: "json_schema",
      json_schema: { name: schema.name, schema: schema.schema, strict: true },
    };
  }
}

/** `response_format` of an endpoint that only does plain JSON mode. */
const JSON_OBJECT_FORMAT: JsonSchema = { type: "json_object" };

/**
 * Whether ANY endpoint of this process has rejected `json_schema`. One flag
 * for the process, not per instance: a provider is built per request
 * (`obtainProvider`), so an instance-local memory would forget the answer
 * immediately and every single outline call would pay for the discovery.
 * A deployment talks to one endpoint — that is what makes one flag honest.
 */
let jsonSchemaRejected = false;

/** Test-only: forget the downgrade, so a case can exercise either path. */
export function resetJsonSchemaSupportForTests(): void {
  jsonSchemaRejected = false;
}

function isJsonSchemaFormat(format: JsonSchema | undefined): boolean {
  return format?.type === "json_schema";
}

/**
 * Whether a 400 body blames the response format. Endpoints word it
 * differently ("response_format.type json_schema is not supported",
 * "Invalid schema for response_format"), so the three words they all use are
 * what is looked for.
 */
function mentionsResponseFormat(body: string): boolean {
  return /response_format|json_schema|schema/i.test(body);
}

// --- factory ----------------------------------------------------------------

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** OpenRouter's optional attribution headers (identify this app in their UI). */
const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://github.com/joCur/grimoire",
  "X-Title": "Grimoire",
};

// OpenRouter and generic endpoints have no sensible default model — the id is
// vendor-prefixed and picking one for the user would silently bill the wrong
// model.
function requireModel(env: NodeJS.ProcessEnv): string {
  if (!env.LLM_MODEL) throw new Error("LLM_MODEL fehlt (z. B. anthropic/claude-sonnet-5)");
  return env.LLM_MODEL;
}

/**
 * Optional output cap. Providers get it from here (never from the env
 * themselves) so the whole configuration lives in one place. A junk value is
 * NOT an error: a bad cap must not take the generator down, so it falls back
 * to the provider default — a reply that then gets truncated fails fast with
 * a message naming the effective cap, and the fix is one env var away.
 */
function parseMaxTokens(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.LLM_MAX_TOKENS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return undefined;
  return n;
}

/**
 * `LLM_FORCE_JSON`: JSON mode is ON unless it is explicitly
 * switched off. Off wins only for the unambiguous "no" values — an
 * unrecognized value keeps the default instead of silently disabling the
 * forcing (same spirit as parseMaxTokens: config junk must not change
 * behaviour in a surprising direction).
 */
function parseForceJson(env: NodeJS.ProcessEnv): boolean {
  const raw = env.LLM_FORCE_JSON?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

/**
 * `LLM_PROMPT_CACHE`: explicit cache breakpoints are ON for
 * OpenRouter and OFF for every other OpenAI-compatible endpoint, and this
 * variable overrides that either way. Two reasons for a switch rather than a
 * hard-coded yes: a routed model may reject the extra message field (same
 * failure mode LLM_FORCE_JSON exists for), and a local server has no cache to
 * hit anyway. Unrecognized values keep the default (as with parseForceJson).
 */
function parsePromptCache(env: NodeJS.ProcessEnv, fallback: boolean): boolean {
  const raw = env.LLM_PROMPT_CACHE?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return fallback;
}

// The German "fehlt" messages are deliberate: they surface in the (German) UI
// when the generate endpoint answers 503 because no provider is configured.
export function createProvider(env: NodeJS.ProcessEnv): LLMProvider {
  const kind = env.LLM_PROVIDER ?? "claude";
  const maxTokens = parseMaxTokens(env);
  const forceJson = parseForceJson(env);
  switch (kind) {
    case "claude": {
      if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY fehlt");
      // The Messages API requires max_tokens — hence the default here, while
      // the OpenAI-compatible cases may leave it to the endpoint.
      return new ClaudeProvider(
        env.ANTHROPIC_API_KEY,
        env.CLAUDE_MODEL,
        maxTokens ?? DEFAULT_MAX_TOKENS,
      );
    }
    case "openrouter": {
      if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY fehlt");
      return new OpenAICompatProvider({
        name: "openrouter",
        baseUrl: env.LLM_BASE_URL ?? OPENROUTER_BASE_URL,
        model: requireModel(env),
        apiKey: env.OPENROUTER_API_KEY,
        extraHeaders: OPENROUTER_HEADERS,
        maxTokens,
        forceJson,
        // On by default: this is the one endpoint where the breakpoint pays
        // for itself on every run (one call per scene, same constant half).
        promptCache: parsePromptCache(env, true),
      });
    }
    case "openai": {
      if (!env.LLM_BASE_URL) throw new Error("LLM_BASE_URL fehlt");
      return new OpenAICompatProvider({
        name: "openai",
        baseUrl: env.LLM_BASE_URL,
        model: requireModel(env),
        apiKey: env.LLM_API_KEY,
        maxTokens,
        forceJson,
        promptCache: parsePromptCache(env, false),
      });
    }
    case "lmstudio": {
      // Local, keyless by default — hence no required variables here.
      return new OpenAICompatProvider({
        name: "lmstudio",
        baseUrl: env.LMSTUDIO_URL ?? "http://localhost:1234/v1",
        model: env.LMSTUDIO_MODEL ?? "local-model",
        maxTokens,
        forceJson,
        promptCache: parsePromptCache(env, false),
      });
    }
    default:
      // Better a 503 naming the typo than silently generating with Claude.
      throw new Error(`Unbekannter LLM_PROVIDER: ${kind}`);
  }
}
