// Provider factory and OpenAI-compatible transport (DECISIONS #6).
//
// Two kinds of test, no network and no new dependencies:
//
//   1. createProvider(env) — selection and every "… fehlt" message. The env
//      is passed in explicitly (the factory takes it as an argument), so
//      process.env stays untouched here.
//   2. Request shape — a throwaway node:http server captures exactly ONE
//      request per case and answers with a minimal OpenAI-style body. Plain
//      node:http keeps this runtime-neutral (DECISIONS #7: no Bun-only APIs).
//   3. Reply parsing — the same capture server answers with the truncation
//      and usage fields the real APIs send, so `truncated`/`usage` of the
//      CompletionResult are covered (issue #18). ClaudeProvider talks to a
//      hardcoded api.anthropic.com, so its Messages-API body is fed through
//      a temporarily replaced global fetch instead.

import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import {
  ClaudeProvider,
  DEFAULT_MAX_TOKENS,
  JSON_PREFILL,
  OpenAICompatProvider,
  createProvider,
} from "../src/llm-provider";
import type { GenerateRequest } from "../src/llm-provider";

// --- factory ------------------------------------------------------------------

describe("createProvider", () => {
  test("default and explicit claude", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" } as NodeJS.ProcessEnv;
    for (const provider of [undefined, "claude"]) {
      const p = createProvider({ ...env, LLM_PROVIDER: provider });
      expect(p).toBeInstanceOf(ClaudeProvider);
      expect(p.name).toBe("claude");
    }
  });

  test("claude without a key throws the 503 message", () => {
    expect(() => createProvider({} as NodeJS.ProcessEnv)).toThrow("ANTHROPIC_API_KEY fehlt");
    expect(() => createProvider({ LLM_PROVIDER: "claude" } as NodeJS.ProcessEnv)).toThrow(
      "ANTHROPIC_API_KEY fehlt",
    );
  });

  test("openrouter needs key and model", () => {
    const base = { LLM_PROVIDER: "openrouter" } as NodeJS.ProcessEnv;
    expect(() => createProvider(base)).toThrow("OPENROUTER_API_KEY fehlt");
    expect(() => createProvider({ ...base, OPENROUTER_API_KEY: "sk-or-test" })).toThrow(
      "LLM_MODEL fehlt (z. B. anthropic/claude-sonnet-4.6)",
    );
    const p = createProvider({
      ...base,
      OPENROUTER_API_KEY: "sk-or-test",
      LLM_MODEL: "anthropic/claude-sonnet-4.6",
    });
    expect(p).toBeInstanceOf(OpenAICompatProvider);
    expect(p.name).toBe("openrouter");
  });

  test("openai needs a base url and a model, the key is optional", () => {
    const base = { LLM_PROVIDER: "openai" } as NodeJS.ProcessEnv;
    expect(() => createProvider(base)).toThrow("LLM_BASE_URL fehlt");
    expect(() => createProvider({ ...base, LLM_BASE_URL: "http://x/v1" })).toThrow(
      "LLM_MODEL fehlt (z. B. anthropic/claude-sonnet-4.6)",
    );
    const p = createProvider({ ...base, LLM_BASE_URL: "http://x/v1", LLM_MODEL: "m" });
    expect(p).toBeInstanceOf(OpenAICompatProvider);
    expect(p.name).toBe("openai");
  });

  test("lmstudio needs nothing — local defaults", () => {
    const p = createProvider({ LLM_PROVIDER: "lmstudio" } as NodeJS.ProcessEnv);
    expect(p).toBeInstanceOf(OpenAICompatProvider);
    expect(p.name).toBe("lmstudio");
  });

  // The effective cap is part of the provider contract (issue #18): the
  // truncation message names it, so a wrong value would be doubly expensive.
  test("LLM_MAX_TOKENS overrides claude's default, junk keeps it", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" } as NodeJS.ProcessEnv;
    const capOf = (e: NodeJS.ProcessEnv) => createProvider(e).maxTokens;
    expect(capOf(env)).toBe(DEFAULT_MAX_TOKENS);
    expect(capOf({ ...env, LLM_MAX_TOKENS: "16000" })).toBe(16000);
    expect(capOf({ ...env, LLM_MAX_TOKENS: "nope" })).toBe(DEFAULT_MAX_TOKENS);
  });

  test("an OpenAI-compatible endpoint without a cap reports none", () => {
    const base = { LLM_PROVIDER: "lmstudio" } as NodeJS.ProcessEnv;
    expect(createProvider(base).maxTokens).toBeUndefined();
    expect(createProvider({ ...base, LLM_MAX_TOKENS: "12000" }).maxTokens).toBe(12000);
  });

  test("an unknown provider throws instead of defaulting to claude", () => {
    expect(() =>
      createProvider({
        LLM_PROVIDER: "gemini",
        ANTHROPIC_API_KEY: "sk-ant-test",
      } as NodeJS.ProcessEnv),
    ).toThrow("Unbekannter LLM_PROVIDER: gemini");
  });
});

// --- request shape --------------------------------------------------------------

const REQ: GenerateRequest = {
  systemPrompt: "System-Prompt",
  fewShotTarget: "# Few-Shot",
  glossary: "Glossar",
  context: { chapter: "01-salzhafen", npcs: [{ id: "fenn", name: "Fenn" }], locations: [] },
  sourceText: "Fenn waits at the docks.",
};

interface Captured {
  path: string;
  headers: IncomingHttpHeaders;
  body: {
    model: string;
    temperature: number;
    max_tokens?: number;
    response_format?: { type: string };
    messages: Array<{ role: string; content: string }>;
  };
}

let server: Server | null = null;

afterEach(async () => {
  if (server !== null) {
    const s = server;
    server = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

/** What the capture server answers with, beyond the message content. */
interface ReplyFields {
  /** OpenAI-compatible stop reason: "stop", "length", … (omitted when unset). */
  finish_reason?: string;
  usage?: Record<string, unknown>;
}

/** Start a one-shot capture server; resolves with `{ baseUrl, next }`. */
async function captureServer(
  reply = "OK vom Modell",
  fields: ReplyFields = {},
): Promise<{
  baseUrl: string;
  next: Promise<Captured>;
}> {
  let resolveCaptured: (c: Captured) => void;
  const next = new Promise<Captured>((resolve) => {
    resolveCaptured = resolve;
  });

  const s = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      resolveCaptured({
        path: req.url ?? "",
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: reply },
              ...(fields.finish_reason === undefined
                ? {}
                : { finish_reason: fields.finish_reason }),
            },
          ],
          ...(fields.usage === undefined ? {} : { usage: fields.usage }),
        }),
      );
    });
  });
  server = s;
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", () => resolve()));
  const addr = s.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  return { baseUrl: `http://127.0.0.1:${addr.port}/v1`, next };
}

describe("OpenAICompatProvider request", () => {
  test("openrouter: bearer auth, attribution headers, model, cap and prompt shape", async () => {
    const { baseUrl, next } = await captureServer();
    const provider = createProvider({
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sk-or-test",
      LLM_MODEL: "anthropic/claude-sonnet-4.6",
      LLM_BASE_URL: baseUrl, // point the OpenRouter path at the local capture
      LLM_MAX_TOKENS: "12000",
    } as NodeJS.ProcessEnv);

    const answer = await provider.complete(REQ, [
      { assistant: "kaputte Antwort", correction: "bitte korrigieren" },
    ]);
    expect(answer.text).toBe("OK vom Modell");

    const cap = await next;
    expect(cap.path).toBe("/v1/chat/completions");
    expect(cap.headers.authorization).toBe("Bearer sk-or-test");
    expect(cap.headers["http-referer"]).toBe("https://github.com/joCur/grimoire");
    expect(cap.headers["x-title"]).toBe("Grimoire");
    expect(cap.body.model).toBe("anthropic/claude-sonnet-4.6");
    expect(cap.body.temperature).toBe(0.3);
    expect(cap.body.max_tokens).toBe(12000);

    // system turn + initial user prompt + the replayed correction pair
    expect(cap.body.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(cap.body.messages[0]!.content).toBe("System-Prompt");
    expect(cap.body.messages[1]!.content).toContain("Fenn waits at the docks.");
    expect(cap.body.messages[1]!.content).toContain("fenn (Fenn)");
    expect(cap.body.messages[2]!.content).toBe("kaputte Antwort");
    expect(cap.body.messages[3]!.content).toBe("bitte korrigieren");
  });

  test("lmstudio: no authorization header, no attribution headers", async () => {
    const { baseUrl, next } = await captureServer();
    const provider = createProvider({
      LLM_PROVIDER: "lmstudio",
      LMSTUDIO_URL: baseUrl,
      LMSTUDIO_MODEL: "local-model",
    } as NodeJS.ProcessEnv);

    await provider.complete(REQ);

    const cap = await next;
    expect(cap.path).toBe("/v1/chat/completions");
    expect(cap.headers.authorization).toBeUndefined();
    expect(cap.headers["http-referer"]).toBeUndefined();
    expect(cap.headers["x-title"]).toBeUndefined();
    expect(cap.body.model).toBe("local-model");
    // no LLM_MAX_TOKENS => no cap in the body, the endpoint decides
    expect("max_tokens" in cap.body).toBe(false);
    expect(cap.body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  test("an unusable LLM_MAX_TOKENS falls back to no cap instead of failing", async () => {
    for (const raw of ["abc", "0", "-5", "8k", "1.5", " "]) {
      const { baseUrl, next } = await captureServer();
      const provider = createProvider({
        LLM_PROVIDER: "lmstudio",
        LMSTUDIO_URL: baseUrl,
        LLM_MAX_TOKENS: raw,
      } as NodeJS.ProcessEnv);
      await provider.complete(REQ);
      expect("max_tokens" in (await next).body).toBe(false);
      // close before the next iteration reassigns the module-level handle
      const s = server;
      server = null;
      if (s !== null) await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  test("a trailing slash in the base url does not double up the path", async () => {
    const { baseUrl, next } = await captureServer();
    const provider = new OpenAICompatProvider({
      name: "openai",
      baseUrl: `${baseUrl}/`,
      model: "m",
    });
    await provider.complete(REQ);
    expect((await next).path).toBe("/v1/chat/completions");
  });

  // --- JSON mode (issue #20, AK 6) ------------------------------------------

  test("response_format is sent by default on every OpenAI-compatible path", async () => {
    const envs: NodeJS.ProcessEnv[] = [
      { LLM_PROVIDER: "lmstudio" } as NodeJS.ProcessEnv,
      {
        LLM_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-test",
        LLM_MODEL: "anthropic/claude-sonnet-4.6",
      } as NodeJS.ProcessEnv,
      { LLM_PROVIDER: "openai", LLM_MODEL: "m" } as NodeJS.ProcessEnv,
    ];
    for (const env of envs) {
      const { baseUrl, next } = await captureServer();
      // every path takes its base url from a different variable
      const provider = createProvider({
        ...env,
        LMSTUDIO_URL: baseUrl,
        LLM_BASE_URL: baseUrl,
      });
      await provider.complete(REQ);
      expect((await next).body.response_format).toEqual({ type: "json_object" });
      const s = server;
      server = null;
      if (s !== null) await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  test("LLM_FORCE_JSON=0 drops response_format, junk keeps it on", async () => {
    for (const [raw, expected] of [
      ["0", false],
      ["false", false],
      ["off", false],
      ["no", false],
      ["1", true],
      ["yes", true],
      ["nonsense", true],
      [undefined, true],
    ] as Array<[string | undefined, boolean]>) {
      const { baseUrl, next } = await captureServer();
      const provider = createProvider({
        LLM_PROVIDER: "lmstudio",
        LMSTUDIO_URL: baseUrl,
        ...(raw === undefined ? {} : { LLM_FORCE_JSON: raw }),
      } as NodeJS.ProcessEnv);
      await provider.complete(REQ);
      expect("response_format" in (await next).body).toBe(expected);
      const s = server;
      server = null;
      if (s !== null) await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  test("an error status surfaces provider name, status and body", async () => {
    const s = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"error":"no credits"}');
    });
    server = s;
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", () => resolve()));
    const addr = s.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");

    const provider = new OpenAICompatProvider({
      name: "openrouter",
      baseUrl: `http://127.0.0.1:${addr.port}/v1`,
      model: "anthropic/claude-sonnet-4.6",
      apiKey: "sk-or-test",
    });
    await expect(provider.complete(REQ)).rejects.toThrow('openrouter: 401 {"error":"no credits"}');
  });
});

// --- reply parsing: truncation + usage (issue #18) ----------------------------

describe("OpenAICompatProvider reply", () => {
  const provider = (baseUrl: string) =>
    new OpenAICompatProvider({ name: "openai", baseUrl, model: "m" });

  test('finish_reason "length" is a truncated reply, usage is normalized', async () => {
    const { baseUrl } = await captureServer("halbes JSON", {
      finish_reason: "length",
      usage: { prompt_tokens: 9123, completion_tokens: 8000, total_tokens: 17123 },
    });
    const answer = await provider(baseUrl).complete(REQ);
    expect(answer.text).toBe("halbes JSON");
    expect(answer.truncated).toBe(true);
    expect(answer.usage).toEqual({ inputTokens: 9123, outputTokens: 8000 });
  });

  test('finish_reason "stop" is a complete reply', async () => {
    const { baseUrl } = await captureServer("ganzes JSON", {
      finish_reason: "stop",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    const answer = await provider(baseUrl).complete(REQ);
    expect(answer.truncated).toBe(false);
    expect(answer.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  test("an endpoint that reports no usage yields no usage at all", async () => {
    const { baseUrl } = await captureServer("ganzes JSON");
    const answer = await provider(baseUrl).complete(REQ);
    expect(answer.truncated).toBe(false);
    expect(answer.usage).toBeUndefined();
  });

  test("a partial usage object counts the missing half as zero", async () => {
    const { baseUrl } = await captureServer("ganzes JSON", {
      usage: { prompt_tokens: 42, completion_tokens: "viele" },
    });
    expect((await provider(baseUrl).complete(REQ)).usage).toEqual({
      inputTokens: 42,
      outputTokens: 0,
    });
  });
});

describe("ClaudeProvider reply", () => {
  /** Answer the next fetch with `body`; returns the captured request body. */
  async function withStubbedFetch(
    body: unknown,
    run: (provider: ClaudeProvider) => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const original = globalThis.fetch;
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await run(new ClaudeProvider("sk-ant-test", "claude-sonnet-4-6", 8000));
    } finally {
      globalThis.fetch = original;
    }
    return sent;
  }

  test('stop_reason "max_tokens" is a truncated reply, usage is normalized', async () => {
    const sent = await withStubbedFetch(
      {
        content: [{ type: "text", text: "halbes JSON" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 9123, output_tokens: 8000 },
      },
      async (p) => {
        const answer = await p.complete(REQ);
        // the prefilled brace is part of the reply (issue #20)
        expect(answer.text).toBe(`${JSON_PREFILL}halbes JSON`);
        expect(answer.truncated).toBe(true);
        expect(answer.usage).toEqual({ inputTokens: 9123, outputTokens: 8000 });
      },
    );
    // the cap the message will name is the one actually sent
    expect(sent.max_tokens).toBe(8000);
    expect(sent.model).toBe("claude-sonnet-4-6");
  });

  // --- JSON mode: assistant prefill (issue #20, AK 6) ------------------------

  test("the assistant prefill is the last turn and comes back in front of the reply", async () => {
    const sent = await withStubbedFetch(
      {
        // the API returns the CONTINUATION of the prefill, without the brace
        content: [{ type: "text", text: '"scenes": [], "warnings": []}' }],
        stop_reason: "end_turn",
      },
      async (p) => {
        const answer = await p.complete(REQ);
        expect(answer.text).toBe('{"scenes": [], "warnings": []}');
        expect(JSON.parse(answer.text)).toEqual({ scenes: [], warnings: [] });
      },
    );
    const messages = sent.messages as Array<{ role: string; content: string }>;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1]).toEqual({ role: "assistant", content: JSON_PREFILL });
  });

  test("the prefill stays the LAST turn after replayed correction turns", async () => {
    const sent = await withStubbedFetch(
      { content: [{ type: "text", text: '"scenes": []}' }], stop_reason: "end_turn" },
      async (p) => {
        const answer = await p.complete(REQ, [
          { assistant: '{"scenes": "kaputt"}', correction: "bitte korrigieren" },
          { assistant: '{"scenes": 0}', correction: "nochmal" },
        ]);
        expect(answer.text).toBe('{"scenes": []}');
      },
    );
    const messages = sent.messages as Array<{ role: string; content: string }>;
    // initial user prompt + two replayed pairs + the prefill at the very end
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages.at(-1)).toEqual({ role: "assistant", content: JSON_PREFILL });
    expect(messages[3]!.content).toBe('{"scenes": 0}');
  });

  test("exactly what was prefilled is prepended — a nested continuation keeps both braces", async () => {
    await withStubbedFetch(
      { content: [{ type: "text", text: '{"a": 1}}' }], stop_reason: "end_turn" },
      async (p) => {
        // the model continued with a nested object; dropping the brace here
        // would corrupt a perfectly good reply
        expect((await p.complete(REQ)).text).toBe('{{"a": 1}}');
      },
    );
  });

  test('stop_reason "end_turn" is a complete reply', async () => {
    await withStubbedFetch(
      {
        content: [{ type: "text", text: "ganzes " }, { type: "thinking", thinking: "…" }, { type: "text", text: "JSON" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      async (p) => {
        const answer = await p.complete(REQ);
        // only text blocks, joined — behind the prefilled brace
        expect(answer.text).toBe(`${JSON_PREFILL}ganzes \nJSON`);
        expect(answer.truncated).toBe(false);
        expect(answer.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
      },
    );
  });
});
