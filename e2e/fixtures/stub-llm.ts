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
//   - a "## Bestehender Eintrag" section in the prompt        -> augment run
//     (issue #36; the reply echoes that entry and adds to it)
//   - a `chapter: <id>` line in the prompt's "## Kontext" block  -> scene run
//     (the reply's scene path uses exactly that chapter)
//   - no chapter line                                            -> npc run
//     (a `vorgegebene id: <id>` line pins the target file name)
//   - TRIGGER.invalid in the source text   -> a reply that fails validation
//     (also for the replayed correction turn, so the run ends in a 422)
//   - TRIGGER.truncated in the source text -> finish_reason "length"
//   - TRIGGER.slow in the source text      -> the reply is HELD (SLOW_REPLY_MS)
//     so a spec can observe a job while it is really running (issue #23)
//
// Since issue #102 a SCENE run is not one call any more but a pipeline, and
// the stub answers each of its calls (told apart by the prompt):
//
//   - the system prompt is the OUTLINE prompt                 -> outline call
//   - the prompt carries the outline and a `chapter:` line    -> a SCENE part
//     (the assigned scene is the one the outline block marks)
//   - the prompt carries the outline and a `vorgegebene id`   -> an ENTRY part
//     (npc or location, by which prompt the system message is)
//   - TRIGGER.threeScenes  -> the outline has three scenes and no entries
//   - TRIGGER.partFail:<nonce> -> the middle scene fails its whole FIRST
//     ROUND for that nonce — the initial call AND the correction turn the
//     server spends on it — and succeeds from the second round on. That is
//     what makes the part end up `failed` (a failure the correction turn
//     repairs is not a failed part) and what „Erneut versuchen“ then fixes.
//     The round counter is the stub's only state and is keyed by the nonce,
//     so parallel workers cannot consume each other's failure.
//   - TRIGGER.slowPart -> only the LAST scene's reply is held, so a spec can
//     restart a run that has finished parts AND one in flight.
//   - TRIGGER.asciiQuotes -> the scene body carries German quotation marks
//     closed with an ASCII `"` (issue #107 AK5). Under the old JSON wrapper
//     that ended the string; as a raw document the run must reach `done`
//     without a single correction turn.
//
// REPLY SHAPE (issue #107): a DOCUMENT reply is a STRING — the document plus
// its warnings block, exactly as replies.ts assembles it — and goes into the
// message content verbatim. The OUTLINE is the one object left, and it is
// serialized as JSON. The stub answers the schema-forced request of the
// Claude path in neither form: it is an OpenAI-compatible endpoint and simply
// ignores `response_format`, which is also what the real fallback path
// exercises.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  EXISTING_ENTRY_HEADING,
  FAILING_SCENE_ID,
  LATE_REPLY_MS,
  SLOW_REPLY_MS,
  THREE_SCENES,
  TRIGGER,
  augmentReply,
  entryPartReply,
  invalidAugmentReply,
  invalidNpcReply,
  invalidRunOutline,
  invalidScenePartReply,
  npcReply,
  outlineReply,
  partFailNonce,
  scenePartReply,
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

/**
 * The campaign-knowledge block of the prompt (issue #53), or "" when the
 * prompt has no such section — which is the normal case and what every
 * campaign without knowledge produces.
 *
 * The stub ECHOES this back in a warning (replies.ts contextEchoWarnings), so
 * a spec can assert what the server sent by reading the review screen. That
 * is the only honest way round: the browser cannot see the prompt, and a spec
 * that reached into the server would stop testing the real path.
 */
function knowledgeBlock(prompt: string): string {
  const start = prompt.indexOf(KNOWLEDGE_HEADING);
  if (start === -1) return "";
  const after = prompt.slice(start + KNOWLEDGE_HEADING.length);
  const end = after.indexOf("## Glossar");
  return (end === -1 ? after : after.slice(0, end)).trim();
}

/**
 * The knowledge section's heading, as server/src/llm-provider.ts writes it.
 * Duplicated on purpose: the stub is a fake MODEL and reads the prompt as a
 * model would — importing the server's constant would make the fixture agree
 * with the server by construction instead of by assertion.
 */
const KNOWLEDGE_HEADING =
  "## Kampagnenwissen — immer anwenden, auch wenn das Quellmaterial anders lautet";

/**
 * The heading the run's OUTLINE travels under (server/src/llm-provider.ts
 * OUTLINE_HEADING) and the one that says which scene THIS call writes
 * (ASSIGNMENT_HEADING — its own section in the prompt's VARIABLE half, so the
 * outline block stays byte-identical across a run and stays cacheable).
 * Duplicated on purpose, like KNOWLEDGE_HEADING: the stub reads the prompt
 * the way a model does.
 */
const OUTLINE_HEADING = "## Gliederung des Durchlaufs";
const ASSIGNED_SCENE = /## Diese Szene schreibst du jetzt\n+([a-z0-9-]+) /;

/**
 * How many ROUNDS a scene part has been asked for, per failure nonce. The stub's
 * ONLY state — and the reason it can still serve several workers at once: the
 * nonce comes out of the source text a spec wrote, so two runs never share a
 * counter. A spec that uses no failure trigger touches this at all.
 */
const partCalls = new Map<string, number>();

/**
 * The augment run's target (issue #36): the address out of the „Bestehender
 * Eintrag" heading, and the entry's markdown out of the fenced block right
 * below it. Returns null when the prompt has no such section — which is
 * every create run, and then nothing about the stub changes.
 */
function existingEntry(prompt: string): { path: string; markdown: string } | null {
  const start = prompt.indexOf(EXISTING_ENTRY_HEADING);
  if (start === -1) return null;
  const rest = prompt.slice(start + EXISTING_ENTRY_HEADING.length);
  const address = /^[ \t]*\(([^)]+)\)/.exec(rest);
  const fence = /```markdown\n([\s\S]*?)```/.exec(rest);
  if (address === null || fence === null) return null;
  // buildPrompt joins its sections with a blank line, so the fenced block
  // arrives padded. The entry itself starts at its properties block.
  const markdown = fence[1]!.replace(/^\n+/, "").replace(/\n+$/, "\n");
  return { path: address[1]!.trim(), markdown };
}

export interface StubDecision {
  /**
   * The reply. A STRING goes into the message content verbatim — that is a
   * document reply (issue #107); anything else is serialized as JSON, which
   * is the outline and only the outline.
   */
  reply: unknown;
  /** The endpoint reports the reply as cut off. */
  truncated: boolean;
  kind: "outline" | "scene" | "entry" | "npc" | "augment";
  /** Milliseconds to hold the reply before sending it (TRIGGER.slow). */
  delayMs: number;
  /**
   * Milliseconds to WAIT and then answer normally (TRIGGER.latePart) — a
   * slow model, not a dead one: the part really finishes, just not before
   * the browser has seen the run without it.
   */
  pauseMs?: number;
}

/** The system message of the request — which PROMPT the call is (issue #102). */
function systemPrompt(messages: ChatMessage[]): string {
  return messages.find((m) => m.role === "system")?.content ?? "";
}

/** The whole stub logic: prompt in, canned reply out. Exported for reuse. */
export function decide(messages: ChatMessage[]): StubDecision {
  const prompt = firstUserPrompt(messages);
  const system = systemPrompt(messages);
  const source = sourceText(prompt);
  const invalid = source.includes(TRIGGER.invalid);
  const truncated = source.includes(TRIGGER.truncated);
  const chapter = matchLine(prompt, "chapter");
  const delayMs = source.includes(TRIGGER.slow) ? SLOW_REPLY_MS : 0;
  const knowledge = knowledgeBlock(prompt);
  const oldName = source.includes(TRIGGER.oldName);
  const three = source.includes(TRIGGER.threeScenes);
  const asciiQuotes = source.includes(TRIGGER.asciiQuotes);
  // Only the PARTS are late; the outline answers at once, so the run reaches
  // `running` with its parts still pending (issue #102 review).
  const latePart = source.includes(TRIGGER.latePart) ? LATE_REPLY_MS : 0;

  // Issue #36: an augment run is the one prompt that carries an EXISTING
  // entry. It is checked FIRST — a scene augment also carries a `chapter:`
  // line, and that line is what tells a create run apart from an npc one.
  const existing = existingEntry(prompt);
  if (existing !== null) {
    return {
      kind: "augment",
      truncated,
      delayMs,
      reply: invalid
        ? invalidAugmentReply(existing.path)
        : augmentReply(existing.path, existing.markdown, knowledge),
    };
  }

  // Issue #102: the OUTLINE call. Recognized by its own system prompt, which
  // is the honest signal — it is the only call that has no outline to read.
  if (system.includes("System-Prompt: Gliederung")) {
    return {
      kind: "outline",
      truncated,
      delayMs,
      // The „invalid" trigger belongs to the SCENE document, so the outline
      // it gets is a well-formed one with a single part.
      reply: invalid
        ? invalidRunOutline(source)
        : outlineReply({ source, knowledge, three, oldName, asciiQuotes }),
    };
  }

  // A per-PART call carries the run's outline. Which part it is: a scene when
  // the outline marks one, an entry otherwise (the entry prompts carry no
  // chapter and name their target id).
  if (prompt.includes(OUTLINE_HEADING)) {
    const assigned = ASSIGNED_SCENE.exec(prompt)?.[1];
    if (assigned !== undefined && chapter !== undefined) {
      const nonce = partFailNonce(source);
      // The first ROUND fails whole — initial call and correction turn — so
      // the part really ends up `failed`; from the second round on (that is:
      // after „Erneut versuchen“) the same prompt gets a good document.
      let fails = false;
      if (nonce !== "" && assigned === FAILING_SCENE_ID) {
        const key = `${nonce}:${assigned}`;
        // A correction turn carries the previous reply as an assistant turn;
        // it belongs to the round that is already counted.
        if (!messages.some((m) => m.role === "assistant")) {
          partCalls.set(key, (partCalls.get(key) ?? 0) + 1);
        }
        fails = (partCalls.get(key) ?? 0) <= 1;
      }
      const last = THREE_SCENES.at(-1)?.id;
      return {
        kind: "scene",
        truncated,
        // Only the LAST scene is held, so a restart has finished parts to keep.
        delayMs:
          delayMs > 0 || (source.includes(TRIGGER.slowPart) && assigned === last)
            ? SLOW_REPLY_MS
            : 0,
        // A FAILING part answers at once even when the others are late: that
        // is the shape in which the only reviewable thing is an error
        // (issue #102 review).
        pauseMs: fails ? 0 : latePart,
        reply:
          invalid || fails
            ? invalidScenePartReply(chapter, assigned)
            : scenePartReply(chapter, assigned, oldName, asciiQuotes),
      };
    }
    const kind = system.includes("System-Prompt: Ort-Generator") ? "location" : "npc";
    return { kind: "entry", truncated, delayMs, reply: entryPartReply(kind) };
  }

  // Everything left is the single-call NPC run (issue #21): no chapter, and a
  // `vorgegebene id` line when the DM pinned the file name.
  const pinned = matchLine(prompt, "vorgegebene id");
  return {
    kind: "npc",
    truncated,
    delayMs,
    reply: invalid ? invalidNpcReply(pinned) : npcReply(pinned, knowledge),
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
        if (decision.delayMs > 0) {
          // Held on purpose (TRIGGER.slow): the caller is a background job a
          // spec wants to catch WHILE it runs, and the provider has no client
          // timeout — so the reply simply never comes. The socket dies with
          // the server process that asked, which is exactly the restart the
          // spec is testing (issue #23).
          console.log(`stub-llm: holding the reply (${decision.delayMs}ms budget)`);
          const held = setTimeout(() => res.destroy(), decision.delayMs);
          held.unref?.();
          req.on("close", () => clearTimeout(held));
          return;
        }
        if (decision.pauseMs !== undefined && decision.pauseMs > 0) {
          // A slow but working model (TRIGGER.latePart): the reply comes,
          // just late enough for the browser to have rendered the run
          // without it first.
          await new Promise((resolve) => setTimeout(resolve, decision.pauseMs));
        }
        json(res, 200, {
          id: "chatcmpl-stub",
          object: "chat.completion",
          model: "grimoire-e2e-stub",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                // A document reply IS the content (issue #107); the outline
                // is the one reply left that gets serialized.
                content:
                  typeof decision.reply === "string"
                    ? decision.reply
                    : JSON.stringify(decision.reply, null, 2),
              },
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
