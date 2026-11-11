// The quick-ideas chat of a running session (decisions/generator): one
// question `POST …/sessions/:session/quick-ideas`, answered in the same
// request from the context as it is stored at that moment, and nothing
// written on any path.
//
// Every case runs against its OWN in-memory database seeded from the
// committed fixtures (test/support/store.ts), and the model is a fake chat
// provider that records what it was asked and answers what the case says.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Session } from "@grimoire/shared/session";
import { setChatProviderForTests } from "../src/chat-reply";
import type { ChatProvider, ChatRequest, CompletionResult } from "../src/llm-provider";
import { ProviderError } from "../src/llm-provider";
import { QUICK_IDEAS_LOG_HEADING } from "../src/quick-ideas-reply";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";

const CAMPAIGN = "/api/campaigns/example";
/** The fixture's session, which is ended. */
const ENDED = "2026-01-15";
/** The reference scene: it names the npc Fenn and plays at the north cove. */
const SCENE = "smuggler-captured";
const FACT = "The harbour belongs to the guild.";

/** One answer of the fake: a reply, or a thrown error. */
type Answer = Partial<CompletionResult> | { error: Error };

/** The fake model: records every request and answers from its queue. */
class FakeChat implements ChatProvider {
  readonly name = "fake";
  readonly maxTokens = 1234;
  requests: ChatRequest[] = [];
  answers: Answer[] = [];

  async chat(req: ChatRequest): Promise<CompletionResult> {
    this.requests.push(req);
    const answer = this.answers.shift() ?? { text: "An idea." };
    if ("error" in answer) throw answer.error;
    return { text: "", truncated: false, ...answer };
  }
}

let fake: FakeChat;

async function send(method: string, url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T = unknown>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const answer = await res;
  expect(answer.status).toBe(status);
  return (await answer.json()) as T;
}

const ask = (session: string, body: unknown) =>
  send("POST", `${CAMPAIGN}/sessions/${session}/quick-ideas`, body);

const question = (text: string, scene = SCENE) => ({ scene, messages: [{ role: "dm", text }] });

const version = async () => (await json<{ version: number }>(app.request(`${CAMPAIGN}/version`))).version;

/** A session started now, with one log line taken in the scene. */
async function runningSession(): Promise<Session> {
  const session = await json<Session>(send("POST", `${CAMPAIGN}/sessions`, {}), 201);
  await json(send("POST", `${CAMPAIGN}/sessions/${session.id}/log`, { text: "Fenn lied about the boat", sceneId: SCENE }), 201);
  return session;
}

beforeEach(async () => {
  await seedStore({
    knowledgeItems: [{ id: "harbour", kind: "fact", from: "", to: "", text: FACT }],
  });
  fake = new FakeChat();
  setChatProviderForTests(fake);
});

afterEach(() => {
  setChatProviderForTests(null);
  dropStore();
});

describe("a question", () => {
  test("is answered with the reply's Markdown, trimmed", async () => {
    const session = await runningSession();
    fake.answers.push({ text: "  - Fenn panics\n- Fenn bargains  " });
    expect(await json<{ text: string }>(ask(session.id, question("How does Fenn react?")))).toEqual({
      text: "- Fenn panics\n- Fenn bargains",
    });
  });

  test("carries the open scene, its npcs, its location, its chapter, the knowledge and the log", async () => {
    const session = await runningSession();
    await json(ask(session.id, question("A name for the boat?")));
    const [request] = fake.requests;
    expect(request?.systemPrompt).toContain("# System-Prompt: Schnelle Ideen");
    expect(request?.systemPrompt.trimEnd().endsWith("Antworte auf Deutsch.")).toBe(true);
    const context = request?.context ?? "";
    expect(context).toContain(`## Szene (${SCENE})`);
    expect(context).toContain("## NPC (fenn)");
    expect(context).toContain("## Ort (cove)");
    expect(context).toMatch(/^## Kapitel \(/m);
    expect(context).toContain(FACT);
    expect(context).toContain(QUICK_IDEAS_LOG_HEADING);
    expect(context).toMatch(new RegExp(`^- \\d\\d:\\d\\d \\(${SCENE}\\): Fenn lied about the boat$`, "m"));
    // The log comes last: everything above it stays the same while the
    // evening goes on.
    expect(context.indexOf(QUICK_IDEAS_LOG_HEADING)).toBeGreaterThan(context.indexOf("## Ort (cove)"));
    expect(request?.turns).toEqual([{ role: "user", content: "A name for the boat?" }]);
  });

  test("sends the whole conversation in order, the question last", async () => {
    const session = await runningSession();
    await json(
      ask(session.id, {
        scene: SCENE,
        messages: [
          { role: "dm", text: "A name for the boat?" },
          { role: "model", text: "*The Grey Gull*" },
          { role: "dm", text: "  Another one?  " },
        ],
      }),
    );
    expect(fake.requests[0]?.turns).toEqual([
      { role: "user", content: "A name for the boat?" },
      { role: "assistant", content: "*The Grey Gull*" },
      { role: "user", content: "Another one?" },
    ]);
  });

  test("reads the scene it names, so another scene is another context", async () => {
    const session = await runningSession();
    await json(ask(session.id, question("What now?", "lighthouse-arrival")));
    const context = fake.requests[0]?.context ?? "";
    expect(context).toContain("## Szene (lighthouse-arrival)");
    expect(context).not.toContain(`## Szene (${SCENE})`);
  });

  test("writes nothing", async () => {
    const session = await runningSession();
    const before = await version();
    const stored = await json<Session>(app.request(`${CAMPAIGN}/sessions/${session.id}`));
    await json(ask(session.id, question("A name for the boat?")));
    fake.answers.push({ error: new ProviderError(500, "boom") });
    expect((await ask(session.id, question("Again?"))).status).toBe(502);
    expect(await version()).toBe(before);
    expect(await json<Session>(app.request(`${CAMPAIGN}/sessions/${session.id}`))).toEqual(stored);
  });
});

describe("a refused question", () => {
  test("an ended session takes none, and the model is not asked", async () => {
    expect(await json(ask(ENDED, question("Anything?")), 409)).toMatchObject({
      code: "session_ended",
      id: ENDED,
    });
    expect(fake.requests).toEqual([]);
  });

  test("an unknown session or scene is 404", async () => {
    const session = await runningSession();
    expect((await ask("no-such-session", question("Anything?"))).status).toBe(404);
    expect((await ask(session.id, question("Anything?", "no-such-scene"))).status).toBe(404);
    expect(fake.requests).toEqual([]);
  });

  test("a conversation that does not end with the DM's question is a 400", async () => {
    const session = await runningSession();
    for (const body of [
      { scene: SCENE, messages: [] },
      { scene: SCENE, messages: [{ role: "dm", text: "   " }] },
      { scene: SCENE, messages: [{ role: "dm", text: "Hi" }, { role: "model", text: "Hello" }] },
      { scene: SCENE, messages: [{ role: "gm", text: "Hi" }] },
      { ...question("Hi"), extra: 1 },
    ]) {
      expect((await ask(session.id, body)).status).toBe(400);
    }
    expect(fake.requests).toEqual([]);
  });

  test("without a provider it is 503 llm_unconfigured", async () => {
    const session = await runningSession();
    setChatProviderForTests(null);
    const saved = { ...process.env };
    process.env = { ...saved, LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "" };
    try {
      expect(await json(ask(session.id, question("Anything?")), 503)).toMatchObject({ code: "llm_unconfigured" });
    } finally {
      process.env = saved;
    }
  });
});

describe("a reply that cannot be used says why", () => {
  test("a provider error is 502 llm_failed with the provider's status", async () => {
    const session = await runningSession();
    fake.answers.push({ error: new ProviderError(429, "rate limited") });
    expect(await json(ask(session.id, question("Anything?")), 502)).toMatchObject({
      code: "llm_failed",
      status: 429,
    });
  });

  test("an empty reply is 502 llm_failed", async () => {
    const session = await runningSession();
    fake.answers.push({ text: "   " });
    expect(await json(ask(session.id, question("Anything?")), 502)).toMatchObject({ code: "llm_failed" });
  });

  test("a timeout is 504 llm_timeout", async () => {
    const session = await runningSession();
    fake.answers.push({ error: new DOMException("timed out", "TimeoutError") });
    expect(await json(ask(session.id, question("Anything?")), 504)).toMatchObject({ code: "llm_timeout" });
  });

  test("a reply cut off at the output cap is 422 quick_ideas_reply_truncated with the cap", async () => {
    const session = await runningSession();
    fake.answers.push({ text: "Half a", truncated: true });
    expect(await json(ask(session.id, question("Anything?")), 422)).toMatchObject({
      code: "quick_ideas_reply_truncated",
      maxTokens: 1234,
    });
  });

  test("a refusal is 422 llm_refused with the reason", async () => {
    const session = await runningSession();
    fake.answers.push({ text: "", refusal: "not this" });
    expect(await json(ask(session.id, question("Anything?")), 422)).toMatchObject({
      code: "llm_refused",
      reason: "not this",
    });
  });
});
