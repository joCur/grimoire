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
  KNOWLEDGE_HEADING,
  OUTLINE_HEADING,
  OpenAICompatProvider,
  buildPrompt,
  buildPromptParts,
  createProvider,
  resetJsonSchemaSupportForTests,
} from "../src/llm-provider";
import type { GenerateRequest } from "../src/llm-provider";
import {
  OUTLINE_SCHEMA_DESCRIPTION,
  OUTLINE_SCHEMA_NAME,
  outlineJsonSchema,
} from "@grimoire/shared/outline-schema";

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
      "LLM_MODEL fehlt (z. B. anthropic/claude-sonnet-5)",
    );
    const p = createProvider({
      ...base,
      OPENROUTER_API_KEY: "sk-or-test",
      LLM_MODEL: "anthropic/claude-sonnet-5",
    });
    expect(p).toBeInstanceOf(OpenAICompatProvider);
    expect(p.name).toBe("openrouter");
  });

  test("openai needs a base url and a model, the key is optional", () => {
    const base = { LLM_PROVIDER: "openai" } as NodeJS.ProcessEnv;
    expect(() => createProvider(base)).toThrow("LLM_BASE_URL fehlt");
    expect(() => createProvider({ ...base, LLM_BASE_URL: "http://x/v1" })).toThrow(
      "LLM_MODEL fehlt (z. B. anthropic/claude-sonnet-5)",
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
  knowledge: "",
  glossary: "Glossar",
  context: { chapter: "01-salzhafen", npcs: [{ id: "fenn", name: "Fenn" }], locations: [] },
  sourceText: "Fenn waits at the docks.",
};

/**
 * The OUTLINE request (issue #107): the one call that wants JSON back, and
 * therefore the only one either transport forces anything for. Every other
 * request — every DOCUMENT call — is REQ above, with no `jsonSchema`.
 */
const OUTLINE_REQ: GenerateRequest = {
  ...REQ,
  jsonSchema: {
    name: OUTLINE_SCHEMA_NAME,
    description: OUTLINE_SCHEMA_DESCRIPTION,
    schema: outlineJsonSchema(),
  },
};

// --- prompt assembly (issue #53 AK2) --------------------------------------------
//
// The ORDER of the prompt's sections is the contract the ticket writes down:
// the campaign knowledge stands above the glossary and is introduced by a
// heading that says it wins against the source material. A unit test rather
// than only an E2E assertion, because this is the one place that order is
// decided for BOTH run kinds.

describe("buildPrompt", () => {
  const KNOWLEDGE = '- Namenskonvention: schreibe „Salt Harbour“ immer als „Salzhafen“.';

  test("no knowledge: the prompt starts with the glossary, exactly as before", () => {
    const prompt = buildPrompt(REQ);
    expect(prompt.startsWith("## Glossar")).toBe(true);
    expect(prompt).not.toContain("Kampagnenwissen");
  });

  test("blank knowledge is treated as none — no empty binding section", () => {
    expect(buildPrompt({ ...REQ, knowledge: "  \n " })).not.toContain("Kampagnenwissen");
  });

  test("the knowledge block comes FIRST, with the binding heading", () => {
    const prompt = buildPrompt({ ...REQ, knowledge: KNOWLEDGE });
    expect(prompt.startsWith(`${KNOWLEDGE_HEADING}\n\n${KNOWLEDGE}\n\n## Glossar`)).toBe(true);
  });

  test("the heading is the wording the ticket demands", () => {
    expect(KNOWLEDGE_HEADING).toBe(
      "## Kampagnenwissen — immer anwenden, auch wenn das Quellmaterial anders lautet",
    );
  });

  test("knowledge sits above the glossary in an NPC run too (no chapter)", () => {
    const prompt = buildPrompt({
      ...REQ,
      knowledge: KNOWLEDGE,
      context: { npcs: [], locations: [], targetId: "brakk" },
    });
    expect(prompt.indexOf(KNOWLEDGE_HEADING)).toBeLessThan(prompt.indexOf("## Glossar"));
    expect(prompt.indexOf("## Glossar")).toBeLessThan(prompt.indexOf("## Kontext"));
    expect(prompt).toContain("vorgegebene id: brakk");
    expect(prompt).not.toContain("chapter:");
  });

  test("the sections after it are unchanged and in their old order", () => {
    const prompt = buildPrompt({ ...REQ, knowledge: KNOWLEDGE });
    const order = ["## Glossar", "## Kontext", "## Referenz-Zieldatei", "## Quelltext"].map((h) =>
      prompt.indexOf(h),
    );
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

interface Captured {
  path: string;
  headers: IncomingHttpHeaders;
  body: {
    model: string;
    temperature: number;
    max_tokens?: number;
    response_format?: { type: string };
    // `content` is a string on the uncached path and content PARTS when a
    // cache breakpoint is in play (issue #110) — hence unknown here.
    messages: Array<{ role: string; content: unknown }>;
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
      LLM_MODEL: "anthropic/claude-sonnet-5",
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
    expect(cap.body.model).toBe("anthropic/claude-sonnet-5");
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
    // On the OpenRouter path the first user turn arrives as content parts
    // (issue #110); read as one text it is the prompt it always was.
    const parts = cap.body.messages[1]!.content as Array<{ text: string }>;
    const prompt = parts.map((part) => part.text).join("\n\n");
    expect(prompt).toContain("Fenn waits at the docks.");
    expect(prompt).toContain("fenn (Fenn)");
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

  // --- the reply shape (issue #20, rebuilt by #107) --------------------------

  test("a DOCUMENT call forces nothing — no response_format at all", async () => {
    resetJsonSchemaSupportForTests();
    const { baseUrl, next } = await captureServer();
    const provider = createProvider({
      LLM_PROVIDER: "lmstudio",
      LMSTUDIO_URL: baseUrl,
    } as NodeJS.ProcessEnv);
    await provider.complete(REQ);
    // The reply is markdown: asking the endpoint for JSON would ask for the
    // one thing the prompt forbids.
    expect("response_format" in (await next).body).toBe(false);
  });

  test("the OUTLINE call sends json_schema with strict on every path", async () => {
    const envs: NodeJS.ProcessEnv[] = [
      { LLM_PROVIDER: "lmstudio" } as NodeJS.ProcessEnv,
      {
        LLM_PROVIDER: "openrouter",
        OPENROUTER_API_KEY: "sk-or-test",
        LLM_MODEL: "anthropic/claude-sonnet-5",
      } as NodeJS.ProcessEnv,
      { LLM_PROVIDER: "openai", LLM_MODEL: "m" } as NodeJS.ProcessEnv,
    ];
    for (const env of envs) {
      resetJsonSchemaSupportForTests();
      const { baseUrl, next } = await captureServer();
      // every path takes its base url from a different variable
      const provider = createProvider({
        ...env,
        LMSTUDIO_URL: baseUrl,
        LLM_BASE_URL: baseUrl,
      });
      await provider.complete(OUTLINE_REQ);
      const format = (await next).body.response_format as {
        type: string;
        json_schema: { name: string; strict: boolean; schema: Record<string, unknown> };
      };
      expect(format.type).toBe("json_schema");
      expect(format.json_schema.name).toBe(OUTLINE_SCHEMA_NAME);
      expect(format.json_schema.strict).toBe(true);
      // The SHARED schema, not a copy assembled in the transport.
      expect(format.json_schema.schema).toEqual(outlineJsonSchema());
      const s = server;
      server = null;
      if (s !== null) await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  test("a 400 on json_schema falls back to json_object — once per process", async () => {
    resetJsonSchemaSupportForTests();
    const bodies: Array<Record<string, unknown>> = [];
    const s = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        bodies.push(body);
        const format = body.response_format as { type?: string } | undefined;
        if (format?.type === "json_schema") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end('{"error":"response_format.type json_schema is not supported"}');
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
      });
    });
    server = s;
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", () => resolve()));
    const addr = s.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    const provider = new OpenAICompatProvider({
      name: "lmstudio",
      baseUrl: `http://127.0.0.1:${addr.port}/v1`,
      model: "local-model",
    });

    // First outline call: the schema is tried, refused, and retried plain.
    expect((await provider.complete(OUTLINE_REQ)).text).toBe("{}");
    expect(bodies.map((b) => (b.response_format as { type: string }).type)).toEqual([
      "json_schema",
      "json_object",
    ]);

    // The downgrade is remembered: the NEXT call costs one request, not two.
    expect((await provider.complete(OUTLINE_REQ)).text).toBe("{}");
    expect(bodies).toHaveLength(3);
    expect((bodies[2]!.response_format as { type: string }).type).toBe("json_object");

    // …and a document call is still forced into nothing at all.
    await provider.complete(REQ);
    expect("response_format" in bodies[3]!).toBe(false);
    resetJsonSchemaSupportForTests();
  });

  test("a 400 that is NOT about the format does not latch the downgrade", async () => {
    resetJsonSchemaSupportForTests();
    const bodies: Array<Record<string, unknown>> = [];
    const s = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
        res.writeHead(400, { "content-type": "application/json" });
        res.end('{"error":{"message":"prompt is too long: 250000 tokens"}}');
      });
    });
    server = s;
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", () => resolve()));
    const addr = s.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    const provider = new OpenAICompatProvider({
      name: "lmstudio",
      baseUrl: `http://127.0.0.1:${addr.port}/v1`,
      model: "local-model",
    });

    // The caller sees the REAL error, body included — not a schema verdict.
    await expect(provider.complete(OUTLINE_REQ)).rejects.toThrow("prompt is too long");
    // …and the next outline call still asks for the schema.
    await expect(provider.complete(OUTLINE_REQ)).rejects.toThrow("lmstudio: 400");
    expect(bodies.map((b) => (b.response_format as { type: string }).type)).toEqual([
      "json_schema",
      "json_object",
      "json_schema",
      "json_object",
    ]);
    resetJsonSchemaSupportForTests();
  });

  test("a 400 with no format hint latches when the json_object retry SUCCEEDS", async () => {
    resetJsonSchemaSupportForTests();
    const bodies: Array<Record<string, unknown>> = [];
    const s = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        bodies.push(body);
        const format = body.response_format as { type?: string } | undefined;
        if (format?.type === "json_schema") {
          res.writeHead(400, { "content-type": "application/json" });
          // No mention of the field at all — only the retry can tell.
          res.end('{"error":{"message":"Bad Request"}}');
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
      });
    });
    server = s;
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", () => resolve()));
    const addr = s.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    const provider = new OpenAICompatProvider({
      name: "lmstudio",
      baseUrl: `http://127.0.0.1:${addr.port}/v1`,
      model: "local-model",
    });

    expect((await provider.complete(OUTLINE_REQ)).text).toBe("{}");
    expect((await provider.complete(OUTLINE_REQ)).text).toBe("{}");
    expect(bodies.map((b) => (b.response_format as { type: string }).type)).toEqual([
      "json_schema",
      "json_object",
      "json_object",
    ]);
    resetJsonSchemaSupportForTests();
  });

  test("an error status that is NOT 400 is not retried", async () => {
    resetJsonSchemaSupportForTests();
    let requests = 0;
    const s = createServer((_req, res) => {
      requests += 1;
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"boom"}');
    });
    server = s;
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", () => resolve()));
    const addr = s.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    const provider = new OpenAICompatProvider({
      name: "lmstudio",
      baseUrl: `http://127.0.0.1:${addr.port}/v1`,
      model: "local-model",
    });
    await expect(provider.complete(OUTLINE_REQ)).rejects.toThrow("lmstudio: 500");
    expect(requests).toBe(1);
  });

  test("LLM_FORCE_JSON=0 drops the outline's response_format, junk keeps it on", async () => {
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
      resetJsonSchemaSupportForTests();
      const { baseUrl, next } = await captureServer();
      const provider = createProvider({
        LLM_PROVIDER: "lmstudio",
        LMSTUDIO_URL: baseUrl,
        ...(raw === undefined ? {} : { LLM_FORCE_JSON: raw }),
      } as NodeJS.ProcessEnv);
      await provider.complete(OUTLINE_REQ);
      expect("response_format" in (await next).body).toBe(expected);
      const s = server;
      server = null;
      if (s !== null) await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  // --- prompt caching (issue #110) ------------------------------------------

  test("openrouter marks the constant prompt half with a cache breakpoint", async () => {
    const { baseUrl, next } = await captureServer();
    const provider = createProvider({
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sk-or-test",
      LLM_MODEL: "anthropic/claude-sonnet-5",
      LLM_BASE_URL: baseUrl,
    } as NodeJS.ProcessEnv);
    await provider.complete(REQ, [
      { assistant: "kaputte Antwort", correction: "bitte korrigieren" },
    ]);

    const cap = await next;
    const parts = cap.body.messages[1]!.content as Array<{
      type: string;
      text: string;
      cache_control?: { type: string };
    }>;
    // The constant half stands first and is the ONLY marked part: it is what
    // repeats across the calls of one chapter run.
    expect(parts[0]!.type).toBe("text");
    expect(parts[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(parts[0]!.text).toContain("fenn (Fenn)");
    expect(parts[1]!.cache_control).toBeUndefined();
    expect(parts[1]!.text).toContain("Fenn waits at the docks.");
    // The two halves joined are byte for byte the prompt buildPrompt builds —
    // caching must not change a single character the model reads.
    expect(parts.map((part) => part.text).join("\n\n")).toBe(buildPrompt(REQ));
    // A correction turn is unique per attempt: marking it would only ever
    // spend a cache write.
    expect(cap.body.messages[3]!.content).toBe("bitte korrigieren");
  });

  test("LLM_PROMPT_CACHE overrides the per-provider default in both directions", async () => {
    for (const [env, raw, cached] of [
      // OpenRouter caches by default, and only an explicit no turns it off
      [{ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", LLM_MODEL: "m" }, undefined, true],
      [{ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", LLM_MODEL: "m" }, "0", false],
      [{ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", LLM_MODEL: "m" }, "nonsense", true],
      // a local or generic endpoint has no cache to hit: off unless asked
      [{ LLM_PROVIDER: "lmstudio" }, undefined, false],
      [{ LLM_PROVIDER: "lmstudio" }, "1", true],
      [{ LLM_PROVIDER: "openai", LLM_MODEL: "m" }, undefined, false],
      [{ LLM_PROVIDER: "openai", LLM_MODEL: "m" }, "on", true],
    ] as Array<[NodeJS.ProcessEnv, string | undefined, boolean]>) {
      const { baseUrl, next } = await captureServer();
      const provider = createProvider({
        ...env,
        LMSTUDIO_URL: baseUrl,
        LLM_BASE_URL: baseUrl,
        ...(raw === undefined ? {} : { LLM_PROMPT_CACHE: raw }),
      } as NodeJS.ProcessEnv);
      await provider.complete(REQ);
      const content = (await next).body.messages[1]!.content;
      // Off means the plain string every OpenAI-compatible server accepts.
      expect(Array.isArray(content)).toBe(cached);
      if (!cached) expect(content).toBe(buildPrompt(REQ));
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
      model: "anthropic/claude-sonnet-5",
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

  test("cached prompt tokens are reported but NOT added to the input count", async () => {
    const { baseUrl } = await captureServer("ganzes JSON", {
      // OpenRouter/OpenAI shape: prompt_tokens already INCLUDES the cache hit
      usage: {
        prompt_tokens: 9000,
        completion_tokens: 2000,
        prompt_tokens_details: { cached_tokens: 7000 },
      },
    });
    expect((await provider(baseUrl).complete(REQ)).usage).toEqual({
      inputTokens: 9000,
      outputTokens: 2000,
      cachedInputTokens: 7000,
    });
  });

  test("an endpoint without cache details reports no cached bucket", async () => {
    const { baseUrl } = await captureServer("ganzes JSON", {
      usage: { prompt_tokens: 9000, completion_tokens: 2000 },
    });
    expect((await provider(baseUrl).complete(REQ)).usage).toEqual({
      inputTokens: 9000,
      outputTokens: 2000,
    });
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
        expect(answer.text).toBe("halbes JSON");
        expect(answer.truncated).toBe(true);
        expect(answer.usage).toEqual({ inputTokens: 9123, outputTokens: 8000 });
      },
    );
    // the cap the message will name is the one actually sent
    expect(sent.max_tokens).toBe(8000);
    expect(sent.model).toBe("claude-sonnet-4-6");
  });

  // --- the reply shape (issue #20's prefill, replaced by #107) ---------------

  test("a DOCUMENT call sends no tool and no prefill — the reply is markdown", async () => {
    const document = "---\nid: night-watch-quay\n---\n\n## Flow\n\nText.\n";
    const sent = await withStubbedFetch(
      { content: [{ type: "text", text: document }], stop_reason: "end_turn" },
      async (p) => {
        // Byte for byte: a prefilled `{` in front of this would corrupt it.
        expect((await p.complete(REQ)).text).toBe(document);
      },
    );
    const messages = sent.messages as Array<{ role: string; content: unknown }>;
    expect(messages.map((m) => m.role)).toEqual(["user"]);
    expect("tools" in sent).toBe(false);
    expect("tool_choice" in sent).toBe(false);
  });

  test("the OUTLINE call sends the schema as a tool and FORCES the call", async () => {
    const outline = { scenes: [], entries: [], warnings: [] };
    const sent = await withStubbedFetch(
      {
        content: [
          { type: "text", text: "Ich gliedere den Quelltext:" },
          { type: "tool_use", name: OUTLINE_SCHEMA_NAME, input: outline },
        ],
        stop_reason: "tool_use",
      },
      async (p) => {
        // The tool INPUT is the reply — the validation downstream parses JSON.
        expect(JSON.parse((await p.complete(OUTLINE_REQ)).text)).toEqual(outline);
      },
    );
    expect(sent.tools).toEqual([
      {
        name: OUTLINE_SCHEMA_NAME,
        description: OUTLINE_SCHEMA_DESCRIPTION,
        input_schema: outlineJsonSchema(),
      },
    ]);
    expect(sent.tool_choice).toEqual({ type: "tool", name: OUTLINE_SCHEMA_NAME });
    // Still no prefill: the forced tool call is what guarantees the shape.
    const messages = sent.messages as Array<{ role: string }>;
    expect(messages.map((m) => m.role)).toEqual(["user"]);
  });

  test("an outline reply with no tool block degrades to its text", async () => {
    // A refusal, or an endpoint that ignored `tool_choice`: the text has to
    // reach the validation as text, so the run fails with a message that says
    // what came back — never with an empty reply nobody can explain.
    await withStubbedFetch(
      { content: [{ type: "text", text: "Ich kann das nicht." }], stop_reason: "end_turn" },
      async (p) => {
        expect((await p.complete(OUTLINE_REQ)).text).toBe("Ich kann das nicht.");
      },
    );
  });

  test("the replayed correction turns are the last turns of every attempt", async () => {
    const sent = await withStubbedFetch(
      { content: [{ type: "text", text: "---\nid: x\n---\n" }], stop_reason: "end_turn" },
      async (p) => {
        await p.complete(REQ, [
          { assistant: "kaputtes Dokument", correction: "bitte korrigieren" },
          { assistant: "noch kaputt", correction: "nochmal" },
        ]);
      },
    );
    const messages = sent.messages as Array<{ role: string; content: unknown }>;
    // initial user prompt + two replayed pairs, ending on the correction
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(messages[3]!.content).toBe("noch kaputt");
    expect(messages.at(-1)!.content).toBe("nochmal");
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
        // only text blocks, joined — thinking blocks are not the reply
        expect(answer.text).toBe("ganzes \nJSON");
        expect(answer.truncated).toBe(false);
        expect(answer.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
      },
    );
  });
});

// --- prompt caching (issue #102, AK5) ----------------------------------------
//
// A pipelined run reads the SAME prefix once per part (outline + N scenes + the
// suggested entries). The Claude provider therefore marks the system prompt and
// the constant half of the first user turn with an ephemeral cache breakpoint;
// the OpenAI-compatible path has no such field and relies on implicit prefix
// caching, which only works if that prefix comes FIRST — so that is what these
// tests pin down.

describe("prompt caching", () => {
  const CACHED: GenerateRequest = {
    systemPrompt: "SYS",
    fewShotTarget: "FEWSHOT",
    knowledge: "- Salzhafen heißt immer Salzhafen",
    glossary: "cove → Bucht",
    context: { chapter: "01-salzhafen", npcs: [{ id: "fenn", name: "Fenn" }], locations: [] },
    outline: "night-watch-quay — Nachtwache am Kai (planned)",
    sourceText: "The party watches the quay.",
  };

  test("the constant half carries knowledge, glossary, context, few-shot and outline", () => {
    const { constant, variable } = buildPromptParts(CACHED);
    for (const marker of [KNOWLEDGE_HEADING, "## Glossar", "## Kontext", "FEWSHOT", OUTLINE_HEADING]) {
      expect(constant).toContain(marker);
    }
    // …and the source text is NOT in it: it is what differs per part.
    expect(constant).not.toContain("## Quelltext");
    expect(variable).toContain("## Quelltext");
    // The two halves joined are exactly the prompt buildPrompt produces, so a
    // single-call run sees the prompt it always saw.
    expect(buildPrompt(CACHED)).toBe(`${constant}\n\n${variable}`);
  });

  test("the constant prefix stands FIRST in the OpenAI-compatible prompt", () => {
    const prompt = buildPrompt(CACHED);
    expect(prompt.indexOf(KNOWLEDGE_HEADING)).toBeLessThan(prompt.indexOf("## Quelltext"));
    expect(prompt.indexOf(OUTLINE_HEADING)).toBeLessThan(prompt.indexOf("## Quelltext"));
  });

  test("Claude marks the system prompt and the constant user block, and nothing else", async () => {
    const original = globalThis.fetch;
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "}" }], stop_reason: "end_turn" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await new ClaudeProvider("sk-ant-test").complete(CACHED, [
        { assistant: "{}", correction: "bitte korrigieren" },
      ]);
    } finally {
      globalThis.fetch = original;
    }

    const system = sent.system as Array<Record<string, unknown>>;
    expect(system).toEqual([
      { type: "text", text: "SYS", cache_control: { type: "ephemeral" } },
    ]);

    const messages = sent.messages as Array<{ role: string; content: unknown }>;
    const first = messages[0]!.content as Array<Record<string, unknown>>;
    const { constant, variable } = buildPromptParts(CACHED);
    expect(first[0]).toEqual({
      type: "text",
      text: constant,
      cache_control: { type: "ephemeral" },
    });
    // The variable half is the second block and is NOT marked — it changes
    // with every part, so a breakpoint there would only pay for cache writes.
    expect(first[1]).toEqual({ type: "text", text: variable });
    // Neither is the replayed correction turn: unique per attempt.
    expect(messages[1]).toEqual({ role: "assistant", content: "{}" });
    expect(messages[2]).toEqual({ role: "user", content: "bitte korrigieren" });
    expect(JSON.stringify(messages.slice(1)).includes("cache_control")).toBe(false);
  });

  test("the cache buckets count towards the input tokens", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "}" }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 120,
            output_tokens: 40,
            cache_creation_input_tokens: 900,
            cache_read_input_tokens: 4000,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    try {
      const answer = await new ClaudeProvider("sk-ant-test").complete(CACHED);
      expect(answer.usage).toEqual({ inputTokens: 5020, outputTokens: 40 });
    } finally {
      globalThis.fetch = original;
    }
  });
});
