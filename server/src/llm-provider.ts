// LLM provider abstraction: Claude API to start with, any OpenAI-compatible
// endpoint (OpenRouter, LM Studio, …) as the alternative — switching is a
// config change, not a code change (DECISIONS #6).
//
// Providers are pure transports: they build the prompt, replay prior
// correction turns, force JSON the way their API allows (issue #20:
// `response_format` on the OpenAI-compatible path, an assistant prefill on
// the Messages API) and return the model's RAW text reply. Parsing and
// mechanical validation live in generator.ts — a malformed reply is a
// validation error that goes back to the model as a correction turn, not an
// exception (generator/README.md step 4).
//
// Two facts travel WITH the text, because only the transport can see them
// (issue #18): whether the model hit its output cap (`finish_reason: length`
// / `stop_reason: max_tokens` — a truncated reply is unfixable by a
// correction turn, so the generator fails fast on it) and the API's token
// usage, normalized so the generator can sum it over a whole run.

export interface GenerateRequest {
  systemPrompt: string; // generator/system-prompt.md (npc run: npc-system-prompt.md)
  fewShotTarget: string; // generator/example-output.md (npc run: npc-example-output.md)
  glossary: string; // <campaign>/glossary.md body ("" when missing)
  context: {
    /** Target chapter of a scene run; absent for an NPC run (issue #21). */
    chapter?: string;
    npcs: Array<{ id: string; name: string }>;
    locations: Array<{ id: string; name: string }>;
    /** Id the DM pinned for the generated file (NPC run) — absent: free choice. */
    targetId?: string;
  };
  sourceText: string; // English source text
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
   * it so the DM knows which value to raise (issue #18).
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

// ---------------------------------------------------------------------------

// The prompt content is German on purpose — the pipeline's target language
// is German (see generator/system-prompt.md); only code and comments here
// are English.
function buildPrompt(req: GenerateRequest): string {
  const npcList = req.context.npcs.map((n) => `${n.id} (${n.name})`).join(", ");
  const locList = req.context.locations
    .map((l) => `${l.id} (${l.name})`)
    .join(", ");
  return [
    "## Glossar",
    req.glossary,
    "## Kontext",
    // Only the lines that HAVE a value: an NPC run has no target chapter,
    // and a pinned id only exists when the DM typed one (issue #21).
    [
      ...(req.context.chapter === undefined ? [] : [`chapter: ${req.context.chapter}`]),
      `npcs: ${npcList || "(keine)"}`,
      `locations: ${locList || "(keine)"}`,
      ...(req.context.targetId === undefined ? [] : [`vorgegebene id: ${req.context.targetId}`]),
    ].join("\n"),
    "## Referenz-Zieldatei (Few-Shot)",
    "```markdown",
    req.fewShotTarget,
    "```",
    "## Quelltext",
    req.sourceText,
  ].join("\n\n");
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

// --- JSON forcing (issue #20, AK 6) -----------------------------------------

/**
 * Assistant prefill for the Messages API: an open brace as the last turn
 * forces the model to CONTINUE a JSON object instead of writing an explainer
 * sentence first. The API returns only the continuation, so the provider puts
 * the brace back in front of the reply (see ClaudeProvider.complete).
 */
export const JSON_PREFILL = "{";

// --- Claude API ------------------------------------------------------------

/** Output cap when nothing is configured — enough for a full scene batch. */
export const DEFAULT_MAX_TOKENS = 8000;

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  constructor(
    private apiKey: string,
    private model = "claude-sonnet-4-6",
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
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: req.systemPrompt,
        // The prefill has to be the LAST turn of every attempt — after the
        // replayed correction turns, which end with a user message.
        messages: [
          ...buildMessages(req, corrections),
          { role: "assistant", content: JSON_PREFILL },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Claude API: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const text = data.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n");
    return {
      // What came back is the CONTINUATION of the prefill, so exactly what
      // was prefilled goes back in front — never conditionally on the reply's
      // first character: a nested object legitimately continues with `{`, and
      // dropping the brace there would corrupt a perfectly good reply.
      text: JSON_PREFILL + text,
      // Messages API: the reply stopped because it ran into max_tokens.
      truncated: data.stop_reason === "max_tokens",
      usage: normalizeUsage(data.usage, "input_tokens", "output_tokens"),
    };
  }
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
   * Send `response_format: { type: "json_object" }` (issue #20). Default on;
   * the factory turns it off for `LLM_FORCE_JSON=0`, because some routed
   * models reject the field and would fail every single run.
   */
  forceJson?: boolean;
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
  readonly maxTokens?: number;

  constructor(opts: OpenAICompatOptions) {
    this.name = opts.name ?? "openai";
    // A trailing slash would produce "…//chat/completions" on some servers.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.extraHeaders = opts.extraHeaders ?? {};
    this.forceJson = opts.forceJson ?? true;
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

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: req.systemPrompt },
          ...buildMessages(req, corrections),
        ],
        temperature: 0.3,
        // Unset means "endpoint default" — local servers and routed models
        // disagree about sensible caps, so we do not invent one.
        ...(this.maxTokens === undefined ? {} : { max_tokens: this.maxTokens }),
        // JSON mode (issue #20): the extraction in generator.ts stays the
        // safety net for endpoints that accept the field and ignore it.
        ...(this.forceJson ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`${this.name}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const choice = data.choices[0];
    const content = choice?.message?.content;
    return {
      text: typeof content === "string" ? content : "",
      // OpenAI-compatible: "length" means the cap cut the reply off.
      truncated: choice?.finish_reason === "length",
      usage: normalizeUsage(data.usage, "prompt_tokens", "completion_tokens"),
    };
  }
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
  if (!env.LLM_MODEL) throw new Error("LLM_MODEL fehlt (z. B. anthropic/claude-sonnet-4.6)");
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
 * `LLM_FORCE_JSON` (issue #20): JSON mode is ON unless it is explicitly
 * switched off. Off wins only for the unambiguous "no" values — an
 * unrecognized value keeps the default instead of silently disabling the
 * forcing (same spirit as parseMaxTokens: config junk must not change
 * behaviour in a surprising direction).
 */
function parseForceJson(env: NodeJS.ProcessEnv): boolean {
  const raw = env.LLM_FORCE_JSON?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
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
      });
    }
    default:
      // Better a 503 naming the typo than silently generating with Claude.
      throw new Error(`Unbekannter LLM_PROVIDER: ${kind}`);
  }
}
