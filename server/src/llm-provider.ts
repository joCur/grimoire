// LLM provider abstraction: Claude API to start with, any OpenAI-compatible
// endpoint (OpenRouter, LM Studio, …) as the alternative — switching is a
// config change, not a code change (DECISIONS #6).
//
// Providers are pure transports: they build the prompt, replay prior
// correction turns, and return the model's RAW text reply. Parsing and
// mechanical validation live in generator.ts — a malformed reply is a
// validation error that goes back to the model as a correction turn, not an
// exception (generator/README.md step 4).

export interface GenerateRequest {
  systemPrompt: string; // generator/system-prompt.md
  fewShotTarget: string; // generator/example-output.md
  glossary: string; // <campaign>/glossary.md body ("" when missing)
  context: {
    chapter: string;
    npcs: Array<{ id: string; name: string }>;
    locations: Array<{ id: string; name: string }>;
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

export interface LLMProvider {
  readonly name: string;
  /** One completion: prompt (+ prior correction turns) -> raw model text. */
  complete(req: GenerateRequest, corrections?: CorrectionTurn[]): Promise<string>;
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
    `chapter: ${req.context.chapter}`,
    `npcs: ${npcList || "(keine)"}`,
    `locations: ${locList || "(keine)"}`,
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

// --- Claude API ------------------------------------------------------------

/** Output cap when nothing is configured — enough for a full scene batch. */
export const DEFAULT_MAX_TOKENS = 8000;

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  constructor(
    private apiKey: string,
    private model = "claude-sonnet-4-6",
    private maxTokens = DEFAULT_MAX_TOKENS,
  ) {}

  async complete(req: GenerateRequest, corrections: CorrectionTurn[] = []): Promise<string> {
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
        messages: buildMessages(req, corrections),
      }),
    });
    if (!res.ok) throw new Error(`Claude API: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n");
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
  private maxTokens?: number;

  constructor(opts: OpenAICompatOptions) {
    this.name = opts.name ?? "openai";
    // A trailing slash would produce "…//chat/completions" on some servers.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.extraHeaders = opts.extraHeaders ?? {};
    this.maxTokens = opts.maxTokens;
  }

  async complete(req: GenerateRequest, corrections: CorrectionTurn[] = []): Promise<string> {
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
      }),
    });
    if (!res.ok) throw new Error(`${this.name}: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
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
 * to the provider default — a truncated reply merely shows up as a
 * validation error, and the fix is one env var away.
 */
function parseMaxTokens(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.LLM_MAX_TOKENS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return undefined;
  return n;
}

// The German "fehlt" messages are deliberate: they surface in the (German) UI
// when the generate endpoint answers 503 because no provider is configured.
export function createProvider(env: NodeJS.ProcessEnv): LLMProvider {
  const kind = env.LLM_PROVIDER ?? "claude";
  const maxTokens = parseMaxTokens(env);
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
      });
    }
    case "lmstudio": {
      // Local, keyless by default — hence no required variables here.
      return new OpenAICompatProvider({
        name: "lmstudio",
        baseUrl: env.LMSTUDIO_URL ?? "http://localhost:1234/v1",
        model: env.LMSTUDIO_MODEL ?? "local-model",
        maxTokens,
      });
    }
    default:
      // Better a 503 naming the typo than silently generating with Claude.
      throw new Error(`Unbekannter LLM_PROVIDER: ${kind}`);
  }
}
