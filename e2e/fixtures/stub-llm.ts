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
// the server follows (decisions/stack) — this script runs under Bun and Node.
//
// Which reply comes back is decided by the PROMPT, never by hidden state, so
// the stub stays stateless and can serve several test workers at once:
//
//   - a "## Bestehende Szene" section in the prompt           -> scene augment run
//   - a "## Bestehender NPC" section in the prompt            -> npc augment run
//   - a "## Bestehender Ort" section in the prompt            -> location augment run
//     (the reply echoes that scene, npc or location and adds to it)
//   - a `chapter: <id>` line in the prompt's "## Kontext" block  -> scene run
//     (the reply's scene names exactly that chapter)
//   - no chapter line                                            -> npc run
//     (a `vorgegebene id: <id>` line pins the id of the npc)
//   - TRIGGER.invalid in the source text   -> a reply that fails validation
//     (also for the replayed correction turn, so the run ends in a 422)
//   - TRIGGER.unknownRef in the source text -> an npc or augment run's first
//     reply names an id nobody has; the correction turn (the call that
//     carries an assistant turn) gets the good reply
//   - TRIGGER.truncated in the source text -> finish_reason "length"
//   - TRIGGER.slow in the source text      -> the reply is HELD (SLOW_REPLY_MS)
//     so a spec can observe a job while it is really running
//
// A SCENE run is not one call but a pipeline, and the stub answers each of its
// calls (told apart by the prompt):
//
//   - the system prompt is the OUTLINE prompt                 -> outline call
//   - the prompt carries the outline and a `chapter:` line    -> a SCENE part
//     (the assigned scene is the one the outline block marks)
//   - the prompt carries the outline and a `vorgegebene id`   -> an NPC or a
//     LOCATION part (by which prompt the system message is)
//   - TRIGGER.threeScenes  -> the outline has three scenes, no npc, no location
//   - TRIGGER.partFail:<nonce> -> the middle scene fails its whole FIRST
//     ROUND for that nonce — the initial call AND the correction turn the
//     server spends on it — and succeeds from the second round on. That is
//     what makes the part end up `failed` (a failure the correction turn
//     repairs is not a failed part) and what „Erneut versuchen“ then fixes.
//     The round counter is the stub's only state and is keyed by the nonce,
//     so parallel workers cannot consume each other's failure.
//   - TRIGGER.slowPart -> only the LAST scene's reply is held, so a spec can
//     restart a run that has finished parts AND one in flight.
//   - TRIGGER.latePart -> the scene PARTS (and an augment reply) answer late
//     but normally, so a spec can watch a job that is genuinely running
//     finish on a poll instead of being done before the first one answers.
//   - TRIGGER.asciiQuotes -> the scene body carries German quotation marks
//     closed with an ASCII `"`. Under the hand-written JSON
//     wrapper that ended the string; as the `body` of a forced object the run
//     must reach `done` without a single correction turn, and the characters
//     have to arrive verbatim.
//
// REPLY SHAPE: every reply is an OBJECT and is serialized as
// JSON into the message content — the outline its own, a scene, an npc or a
// location call its fields flat beside `warnings` (replies.ts assembles
// them). A reply that is a plain
// STRING is one a spec wrote to be unreadable, and it travels verbatim.
//
// The stub is an OpenAI-compatible endpoint and simply IGNORES the
// `response_format` the server sends, which is exactly what the tolerant
// reader on the server (parseJsonReply) is the net for: the E2E path proves
// the run works even where the schema is not actually enforced.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  EXISTING_SCENE_HEADING,
  EXISTING_LOCATION_HEADING,
  EXISTING_NPC_HEADING,
  FAILING_SCENE_ID,
  LATE_REPLY_MS,
  NEW_CHAPTER_LINE,
  SLOW_REPLY_MS,
  THREE_SCENES,
  TRIGGER,
  augmentReply,
  invalidAugmentReply,
  invalidLocationAugmentReply,
  invalidNpcAugmentReply,
  invalidNpcReply,
  invalidRunOutline,
  invalidScenePartReply,
  locationAugmentReply,
  npcAugmentReply,
  npcReply,
  outlineReply,
  partFailNonce,
  proposalPartReply,
  scenePartReply,
  unknownRefAugmentReply,
  unknownRefLocationAugmentReply,
  unknownRefNpcAugmentReply,
  unknownRefNpcReply,
  type ExistingLocation,
  type NpcFields,
  type SceneFields,
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
 * The campaign-knowledge block of the prompt, or "" when the
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
 * The scene a SCENE augment run works on, out of the fenced JSON below the
 * „Bestehende Szene" heading — every field of the scene in its reply form (an
 * absent field `null`), the very object the reply is forced into (decisions/resources).
 * Null for every other prompt — which is every create run, and then nothing
 * about the stub changes.
 */
function existingScene(prompt: string): SceneFields | null {
  const start = prompt.indexOf(EXISTING_SCENE_HEADING);
  if (start === -1) return null;
  const fence = /```json\n([\s\S]*?)```/.exec(prompt.slice(start));
  if (fence === null) return null;
  try {
    const parsed: unknown = JSON.parse(fence[1]!);
    if (!isRecord(parsed) || typeof parsed.id !== "string") return null;
    return parsed as unknown as SceneFields;
  } catch {
    // Not readable as a scene, so not an augment prompt as far as the stub
    // is concerned: it falls through to the create branches, which fails a
    // spec visibly instead of answering half an augment.
    return null;
  }
}

/**
 * The npc an NPC augment run works on, out of the fenced JSON below the
 * „Bestehender NPC" heading — every field of the npc in its reply form
 * (`quickstats` as pairs, an absent field `null`), the very object the reply
 * is forced into (decisions/resources). Null for every other prompt.
 */
function existingNpc(prompt: string): NpcFields | null {
  const start = prompt.indexOf(EXISTING_NPC_HEADING);
  if (start === -1) return null;
  const fence = /```json\n([\s\S]*?)```/.exec(prompt.slice(start));
  if (fence === null) return null;
  try {
    const parsed: unknown = JSON.parse(fence[1]!);
    if (!isRecord(parsed) || typeof parsed.id !== "string") return null;
    return parsed as unknown as NpcFields;
  } catch {
    return null;
  }
}

/**
 * The location a LOCATION augment run works on, out of the fenced JSON below
 * the „Bestehender Ort" heading — every field of the location, the very
 * object the reply is forced into (decisions/resources). Null for every other prompt.
 */
function existingLocation(prompt: string): ExistingLocation | null {
  const start = prompt.indexOf(EXISTING_LOCATION_HEADING);
  if (start === -1) return null;
  const fence = /```json\n([\s\S]*?)```/.exec(prompt.slice(start));
  if (fence === null) return null;
  try {
    const parsed: unknown = JSON.parse(fence[1]!);
    if (!isRecord(parsed) || typeof parsed.id !== "string") return null;
    return parsed as unknown as ExistingLocation;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface StubDecision {
  /**
   * The reply object, serialized as JSON into the message
   * content. A plain STRING travels verbatim — that is a reply a spec wrote
   * to be unreadable.
   */
  reply: unknown;
  /** The endpoint reports the reply as cut off. */
  truncated: boolean;
  kind: "outline" | "scene" | "proposal" | "npc" | "augment";
  /** Milliseconds to hold the reply before sending it (TRIGGER.slow). */
  delayMs: number;
  /**
   * Milliseconds to WAIT and then answer normally (TRIGGER.latePart) — a
   * slow model, not a dead one: the part really finishes, just not before
   * the browser has seen the run without it.
   */
  pauseMs?: number;
}

/** The system message of the request — which PROMPT the call is. */
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
  // `running` with its parts still pending.
  const latePart = source.includes(TRIGGER.latePart) ? LATE_REPLY_MS : 0;
  // A correction turn replays the previous reply as an assistant turn, so the
  // first call of a run is the one without it.
  const unknownRef =
    source.includes(TRIGGER.unknownRef) && !messages.some((m) => m.role === "assistant");

  // A location augment run carries the location it works on (decisions/resources).
  const location = existingLocation(prompt);
  if (location !== null) {
    return {
      kind: "augment",
      truncated,
      delayMs,
      pauseMs: latePart,
      reply: invalid
        ? invalidLocationAugmentReply(location)
        : unknownRef
          ? unknownRefLocationAugmentReply(location)
          : locationAugmentReply(location, knowledge),
    };
  }

  // An npc augment run carries the npc it works on (decisions/resources).
  const npc = existingNpc(prompt);
  if (npc !== null) {
    return {
      kind: "augment",
      truncated,
      delayMs,
      pauseMs: latePart,
      reply: invalid
        ? invalidNpcAugmentReply(npc)
        : unknownRef
          ? unknownRefNpcAugmentReply(npc)
          : npcAugmentReply(npc, knowledge),
    };
  }

  // A scene augment run carries the EXISTING scene. It is checked before the
  // create runs — it also carries a `chapter:` line, and that line is what
  // tells a create run apart from an npc one.
  const existing = existingScene(prompt);
  if (existing !== null) {
    return {
      kind: "augment",
      truncated,
      delayMs,
      // TRIGGER.latePart on an augment run: the reply COMES, just later than
      // the browser's first job poll — the only shape in which the dialog
      // really sees its own job as `running` and has to leave the spinner on
      // a polled update.
      pauseMs: latePart,
      reply: invalid
        ? invalidAugmentReply(existing)
        : unknownRef
          ? unknownRefAugmentReply(existing)
          : augmentReply(existing, knowledge),
    };
  }

  // The OUTLINE call. Recognized by its own system prompt, which is the honest
  // signal — it is the only call that has no outline to read.
  if (system.includes("System-Prompt: Gliederung")) {
    return {
      kind: "outline",
      truncated,
      delayMs,
      // The „invalid" trigger belongs to the SCENE entry, so the outline
      // it gets is a well-formed one with a single part.
      reply: invalid
        ? invalidRunOutline(source)
        : outlineReply({
            source,
            knowledge,
            three,
            oldName,
            asciiQuotes,
            // The context's own line, as a model reads it.
            newChapter: new RegExp(`^${NEW_CHAPTER_LINE}$`, "m").test(prompt),
            describeAnyway: source.includes(TRIGGER.describeAnyway),
          }),
    };
  }

  // A per-PART call carries the run's outline. Which part it is: a scene when
  // the outline marks one, a proposed npc or location otherwise (their prompts
  // carry no chapter and name their target id).
  if (prompt.includes(OUTLINE_HEADING)) {
    const assigned = ASSIGNED_SCENE.exec(prompt)?.[1];
    if (assigned !== undefined && chapter !== undefined) {
      const nonce = partFailNonce(source);
      // The first ROUND fails whole — initial call and correction turn — so
      // the part really ends up `failed`; from the second round on (that is:
      // after „Erneut versuchen“) the same prompt gets a good draft.
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
        // is the shape in which the only reviewable thing is an error.
        pauseMs: fails ? 0 : latePart,
        reply:
          invalid || fails
            ? invalidScenePartReply(chapter, assigned)
            : scenePartReply(chapter, assigned, oldName, asciiQuotes),
      };
    }
    const kind = system.includes("System-Prompt: Ort-Generator") ? "location" : "npc";
    return { kind: "proposal", truncated, delayMs, reply: proposalPartReply(kind) };
  }

  // Everything left is the single-call NPC run: no chapter, and a
  // `vorgegebene id` line when the DM pinned the id of the npc.
  const pinned = matchLine(prompt, "vorgegebene id");
  return {
    kind: "npc",
    truncated,
    delayMs,
    reply: invalid
      ? invalidNpcReply(pinned)
      : unknownRef
        ? unknownRefNpcReply(pinned)
        : npcReply(pinned, knowledge),
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
          // spec is testing.
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
                // Every reply is an object; a string is a
                // deliberately unreadable one and goes out as it stands.
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
