// LLM-Provider-Abstraktion: Claude API zum Start, LM Studio als
// local-first-Option später — Umschalten per Config, nicht per Code.

export interface GenerateRequest {
  systemPrompt: string;   // generator/system-prompt.md
  fewShotTarget: string;  // generator/example-output.md
  glossary: string;       // campaigns/<c>/glossary.md
  context: {
    chapter: string;
    npcs: Array<{ id: string; name: string }>;
    locations: Array<{ id: string; name: string }>;
  };
  sourceText: string;     // englischer Quelltext
}

export interface GeneratedScene {
  path: string;    // relativ zur Kampagne, z. B. "02-raiders-camp/camp/captured.md"
  content: string; // vollständige Markdown-Datei inkl. Frontmatter
}

export interface GenerateResult {
  scenes: GeneratedScene[];
  npc_stubs: Array<GeneratedScene & { reason: string }>;
  location_stubs: Array<GeneratedScene & { reason: string }>;
  warnings: string[];
}

export interface LLMProvider {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

// ---------------------------------------------------------------------------

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

function parseResult(raw: string): GenerateResult {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  return {
    scenes: parsed.scenes ?? [],
    npc_stubs: parsed.npc_stubs ?? [],
    location_stubs: parsed.location_stubs ?? [],
    warnings: parsed.warnings ?? [],
  };
}

// --- Claude API ------------------------------------------------------------

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";
  constructor(
    private apiKey: string,
    private model = "claude-sonnet-4-6",
  ) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
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
        messages: [{ role: "user", content: buildPrompt(req) }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const text = data.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n");
    return parseResult(text);
  }
}

// --- LM Studio (OpenAI-kompatibel) ------------------------------------------

export class LMStudioProvider implements LLMProvider {
  readonly name = "lmstudio";
  constructor(
    private baseUrl = "http://localhost:1234/v1",
    private model = "local-model",
  ) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: buildPrompt(req) },
        ],
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error(`LM Studio: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return parseResult(data.choices[0].message.content);
  }
}

// --- Factory ----------------------------------------------------------------

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
