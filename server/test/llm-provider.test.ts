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

import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import {
  ClaudeProvider,
  DEFAULT_MAX_TOKENS,
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

  // ClaudeProvider talks to a hardcoded api.anthropic.com, so the cap cannot
  // be observed through a capture server like the OpenAI-compatible one —
  // checked on the instance instead, since the Messages API REQUIRES the
  // field and a silently wrong default would be expensive.
  test("LLM_MAX_TOKENS overrides claude's default, junk keeps it", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-test" } as NodeJS.ProcessEnv;
    const capOf = (e: NodeJS.ProcessEnv) =>
      (createProvider(e) as unknown as { maxTokens: number }).maxTokens;
    expect(capOf(env)).toBe(DEFAULT_MAX_TOKENS);
    expect(capOf({ ...env, LLM_MAX_TOKENS: "16000" })).toBe(16000);
    expect(capOf({ ...env, LLM_MAX_TOKENS: "nope" })).toBe(DEFAULT_MAX_TOKENS);
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

/** Start a one-shot capture server; resolves with `{ baseUrl, next }`. */
async function captureServer(reply = "OK vom Modell"): Promise<{
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
      res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
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
    expect(answer).toBe("OK vom Modell");

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
