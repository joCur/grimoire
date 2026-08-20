// LLM provider abstraction: Claude API to start with, LM Studio as the
// local-first option later — switching is a config change, not a code change
// (DECISIONS #6).
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

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  constructor(
    private apiKey: string,
    private model = "claude-sonnet-4-6",
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
        max_tokens: 8000,
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

// --- LM Studio (OpenAI-compatible) ------------------------------------------

export class LMStudioProvider implements LLMProvider {
  readonly name = "lmstudio";
  constructor(
    private baseUrl = "http://localhost:1234/v1",
    private model = "local-model",
  ) {}

  async complete(req: GenerateRequest, corrections: CorrectionTurn[] = []): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: req.systemPrompt },
          ...buildMessages(req, corrections),
        ],
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error(`LM Studio: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }
}

// --- factory ----------------------------------------------------------------

// The German "fehlt" message is deliberate: it surfaces in the (German) UI
// when the generate endpoint answers 503 because no provider is configured.
export function createProvider(env: NodeJS.ProcessEnv): LLMProvider {
  switch (env.LLM_PROVIDER ?? "claude") {
    case "lmstudio":
      return new LMStudioProvider(env.LMSTUDIO_URL, env.LMSTUDIO_MODEL);
    case "claude":
    default: {
      if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY fehlt");
      return new ClaudeProvider(env.ANTHROPIC_API_KEY, env.CLAUDE_MODEL);
    }
  }
}
