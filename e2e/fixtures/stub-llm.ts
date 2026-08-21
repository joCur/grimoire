// Stub LLM — a standalone, OpenAI-compatible /chat/completions endpoint that
// answers with the canned replies of ./replies.ts.
//
// This is the ONE thing the E2E suite fakes (CLAUDE.md, "Kritische Pfade"):
// the browser talks to the real server, the real server talks to a real HTTP
// LLM endpoint over the real OpenAICompatProvider — only the model behind it
// is canned. Nothing is mocked inside the browser.
//
// Run it standalone (useful while writing a spec):
//
//   bun e2e/fixtures/stub-llm.ts --port 4319
//   PORT=4319 bun e2e/fixtures/stub-llm.ts
//
// then point a server at it:
//
//   LLM_PROVIDER=openai LLM_BASE_URL=http://127.0.0.1:4319/v1 \
//   LLM_MODEL=stub bun run --cwd server src/server.ts
//
// node:http instead of Bun.serve on purpose: the same runtime-neutrality rule
// the server follows (DECISIONS #7) — this script runs under Bun and Node.
//
// Which reply comes back is decided by the PROMPT, never by hidden state, so
// the stub stays stateless and can serve several test workers at once:
//
//   - a `chapter: <id>` line in the prompt's "## Kontext" block  -> scene run
//     (the reply's scene path uses exactly that chapter)
//   - no chapter line                                            -> npc run
//     (a `vorgegebene id: <id>` line pins the target file name)
//   - TRIGGER.invalid in the source text   -> a reply that fails validation
//     (also for the replayed correction turn, so the run ends in a 422)
//   - TRIGGER.truncated in the source text -> finish_reason "length"

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  TRIGGER,
  invalidNpcReply,
  invalidSceneReply,
  npcReply,
  sceneReply,
} from "./replies";

/** Fake token counts — the UI shows them, so they must look plausible. */
const USAGE = { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 };

interface ChatMessage {
  role: string;
  content: string;
}

/** The first user turn: prompt + context + source text (llm-provider.ts). */
function firstUserPrompt(messages: ChatMessage[]): string {
  return messages.find((m) => m.role === "user")?.content ?? "";
}

function matchLine(prompt: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(prompt);
  return match?.[1]?.trim();
}

/** Everything below the "## Quelltext" heading of the prompt. */
function sourceText(prompt: string): string {
  const index = prompt.indexOf("## Quelltext");
  return index === -1 ? prompt : prompt.slice(index);
}

export interface StubDecision {
  /** The reply body (a JSON object, serialized into the message content). */
  reply: unknown;
  /** The endpoint reports the reply as cut off. */
  truncated: boolean;
  kind: "scene" | "npc";
}

/** The whole stub logic: prompt in, canned reply out. Exported for reuse. */
export function decide(messages: ChatMessage[]): StubDecision {
  const prompt = firstUserPrompt(messages);
  const source = sourceText(prompt);
  const invalid = source.includes(TRIGGER.invalid);
  const truncated = source.includes(TRIGGER.truncated);
  const chapter = matchLine(prompt, "chapter");

  if (chapter === undefined) {
    const pinned = matchLine(prompt, "vorgegebene id");
    return {
      kind: "npc",
      truncated,
      reply: invalid ? invalidNpcReply(pinned) : npcReply(pinned),
    };
  }
  return {
    kind: "scene",
    truncated,
    reply: invalid ? invalidSceneReply(chapter) : sceneReply(chapter),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(payload)),
  });
  res.end(payload);
}

/**
 * Start the stub on `port` (0 = an ephemeral one). Resolves with the port it
 * actually listens on and a close() that shuts it down.
 */
export function startStubLlm(port = 0): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    // A tiny health route, so a starter can wait for readiness without
    // sending a completion request.
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method !== "POST" || !(req.url ?? "").endsWith("/chat/completions")) {
      json(res, 404, { error: { message: `stub-llm: no route for ${req.method} ${req.url}` } });
      return;
    }
    void (async () => {
      try {
        const body = JSON.parse(await readBody(req)) as { messages?: ChatMessage[] };
        const decision = decide(body.messages ?? []);
        console.log(`stub-llm: ${decision.kind} run${decision.truncated ? " (truncated)" : ""}`);
        json(res, 200, {
          id: "chatcmpl-stub",
          object: "chat.completion",
          model: "grimoire-e2e-stub",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify(decision.reply, null, 2) },
              finish_reason: decision.truncated ? "length" : "stop",
            },
          ],
          usage: USAGE,
        });
      } catch (err) {
        console.error("stub-llm: bad request", err);
        json(res, 400, { error: { message: "stub-llm: request body must be JSON" } });
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: actual,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/** CLI entry: `bun e2e/fixtures/stub-llm.ts --port 4319` (or PORT=4319). */
async function main(): Promise<void> {
  const argIndex = process.argv.indexOf("--port");
  const raw = argIndex === -1 ? process.env.PORT : process.argv[argIndex + 1];
  const { port } = await startStubLlm(Number(raw ?? 0));
  console.log(`stub-llm listening on http://127.0.0.1:${port}/v1 (POST /chat/completions)`);
}

// Only when this file IS the process (import.meta.main works on Bun and
// Node >= 24; the suite imports startStubLlm instead of spawning it).
if (import.meta.main) {
  void main();
}
