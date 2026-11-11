// The brainstorming chat on a scene (decisions/resources, decisions/trash):
// the chat resource `…/scene-chats[/:id]` with its messages embedded, the
// message resource `…/scene-chats/:chat/messages[/:id]`, the reply written in
// the background, and the chat's way into and out of the trash — cleared on
// its own, or along with its scene.
//
// Every case runs against its OWN in-memory database seeded from the
// committed fixtures (test/support/store.ts), and the model is a fake chat
// provider that records what it was asked and answers what the case says.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LlmProvider } from "@grimoire/shared/llm-provider";
import type { Scene } from "@grimoire/shared/scene";
import type { SceneChat } from "@grimoire/shared/scene-chat";
import type { SceneChatMessage } from "@grimoire/shared/scene-chat-message";
import { failInterruptedReplies } from "../src/db/scene-chat-boot";
import type { ChatProvider, ChatRequest, CompletionResult } from "../src/llm-provider";
import { ProviderError } from "../src/llm-provider";
import { setChatProviderForTests } from "../src/scene-chat-reply";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { purgeTrash } from "../src/store/trash";
import { dropStore, seedStore } from "./support/store";

const CAMPAIGN = "/api/campaigns/example";
const CHATS = `${CAMPAIGN}/scene-chats`;
/** A scene no log line names, so it can go to the trash. */
const SCENE = "smuggler-captured";

/** One answer of the fake: a text, a thrown error, or a reply held until released. */
type Answer = { text: string; truncated?: boolean } | { error: Error };

/**
 * The fake model: records every request and answers from its queue. `hold`
 * keeps the next reply back until `release`, so a case can look at a reply
 * while it runs.
 */
class FakeChat implements ChatProvider {
  readonly name = "fake";
  readonly maxTokens = 1234;
  requests: ChatRequest[] = [];
  answers: Answer[] = [];
  private held: Array<() => void> = [];
  holding = false;

  async chat(req: ChatRequest): Promise<CompletionResult> {
    this.requests.push(req);
    if (this.holding) await new Promise<void>((resolve) => this.held.push(resolve));
    const answer = this.answers.shift() ?? { text: "A reply." };
    if ("error" in answer) throw answer.error;
    return { text: answer.text, truncated: answer.truncated ?? false };
  }

  release(): void {
    this.holding = false;
    for (const resolve of this.held.splice(0)) resolve();
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

async function json<T>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const answer = await res;
  expect(answer.status).toBe(status);
  return (await answer.json()) as T;
}

const chatsOf = (scene: string) => json<SceneChat[]>(app.request(`${CHATS}?scene=${scene}`));
const trashedChats = () => json<SceneChat[]>(app.request(`${CHATS}?deleted=true`));
const startChat = (scene = SCENE) => send("POST", CHATS, { scene });
const sendMessage = (chat: string, text: string) => send("POST", `${CHATS}/${chat}/messages`, { text });

/** The chat as it stands once no reply of it runs any more. */
async function settled(chat: string): Promise<SceneChat> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const current = await json<SceneChat>(app.request(`${CHATS}/${chat}`));
    if (current.messages.every((message) => message.status !== "running")) return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the reply never settled");
}

/** Wait until the fake has been asked `count` times. */
async function asked(count: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && fake.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(fake.requests.length).toBe(count);
}

beforeEach(async () => {
  await seedStore({
    knowledgeItems: [
      { id: "harbour", kind: "fact", from: "", to: "", text: "The harbour belongs to the guild." },
    ],
  });
  fake = new FakeChat();
  setChatProviderForTests(fake);
});

afterEach(() => {
  fake.release();
  setChatProviderForTests(null);
  dropStore();
});

describe("starting a chat", () => {
  test("a scene has no chat until one is started, and then exactly one", async () => {
    expect(await chatsOf(SCENE)).toEqual([]);
    const chat = await json<SceneChat>(startChat(), 201);
    expect(chat).toEqual({ id: expect.any(String), scene: SCENE, messages: [], rev: 1 });
    // Starting again hands back the one the scene has.
    expect(await json<SceneChat>(startChat(), 200)).toEqual(chat);
    expect(await chatsOf(SCENE)).toEqual([chat]);
    expect(await chatsOf("lighthouse-arrival")).toEqual([]);
  });

  test("a chat needs a live scene, and takes no other key", async () => {
    expect((await startChat("no-such-scene")).status).toBe(400);
    expect((await send("POST", CHATS, { scene: SCENE, title: "x" })).status).toBe(400);
    expect((await app.request(`${CHATS}/no-such-chat`)).status).toBe(404);
    expect((await app.request("/api/campaigns/nope/scene-chats")).status).toBe(404);
  });
});

describe("sending a message", () => {
  test("answers at once with the DM's message; the reply is written in the background", async () => {
    const chat = await json<SceneChat>(startChat(), 201);
    fake.holding = true;
    fake.answers.push({ text: "  Two options:\n\n- a\n- b  " });
    const message = await json<SceneChatMessage>(sendMessage(chat.id, "  How does Fenn react?  "), 201);
    expect(message).toEqual({
      id: expect.any(String),
      role: "dm",
      text: "How does Fenn react?",
      status: "done",
      rev: 1,
    });
    const running = await json<SceneChat>(app.request(`${CHATS}/${chat.id}`));
    expect(running.messages).toEqual([
      message,
      { id: expect.any(String), role: "model", text: "", status: "running", rev: 1 },
    ]);
    // One reply per scene at a time.
    const second = await sendMessage(chat.id, "And then?");
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "scene_chat_reply_running" });

    fake.release();
    const done = await settled(chat.id);
    expect(done.messages[1]).toEqual({
      id: running.messages[1]!.id,
      role: "model",
      text: "Two options:\n\n- a\n- b",
      status: "done",
      rev: 2,
    });
    // No message write moves the chat's guard.
    expect(done.rev).toBe(1);
  });

  test("every reply reads the context as stored and the whole chat so far", async () => {
    const chat = await json<SceneChat>(startChat(), 201);
    await json(sendMessage(chat.id, "First question"), 201);
    await settled(chat.id);
    // The scene changes between two messages: the next reply reads it fresh.
    const scene = await json<Scene>(app.request(`${CAMPAIGN}/scenes/${SCENE}`));
    await json(send("PATCH", `${CAMPAIGN}/scenes/${SCENE}`, { rev: scene.rev, title: "Captured!" }));
    await json(sendMessage(chat.id, "Second question"), 201);
    await settled(chat.id);

    const [first, second] = fake.requests;
    expect(first!.turns).toEqual([{ role: "user", content: "First question" }]);
    expect(second!.turns).toEqual([
      { role: "user", content: "First question" },
      { role: "assistant", content: "A reply." },
      { role: "user", content: "Second question" },
    ]);
    // The scene with every field and its text, its npc, its location, its
    // chapter, the campaign knowledge and the glossary.
    const context = second!.context;
    expect(context).toContain("## Szene (smuggler-captured)");
    expect(context).toContain('"title": "Captured!"');
    expect(context).toContain('"trigger": "The characters are spotted while scouting the cove"');
    expect(context).toContain("## NPC (fenn)");
    expect(context).toContain("## Ort (cove)");
    expect(context).toContain("## Kapitel (01-salt-harbour): Chapter 1: The Lighthouse of Salt Harbour");
    expect(context).toContain("The harbour belongs to the guild.");
    expect(context).toContain("lighthouse keeper");
    expect(context).not.toContain('"rev"');
    // The constant part comes first: knowledge, glossary, chapter, then the scene.
    expect(context.indexOf("Kampagnenwissen")).toBeLessThan(context.indexOf("## Szene"));
    // The system prompt is the chat's, in the DM's language.
    expect(second!.systemPrompt).toContain("System-Prompt: Szenen-Chat");
    expect(second!.systemPrompt).toContain("Antworte auf Deutsch.");
  });

  test("a failed reply keeps the DM's message, says why, and can be retried", async () => {
    const chat = await json<SceneChat>(startChat(), 201);
    fake.answers.push({ error: new ProviderError(529, "fake: 529 overloaded") });
    await json(sendMessage(chat.id, "A question"), 201);
    const failed = await settled(chat.id);
    const reply = failed.messages[1]!;
    expect(failed.messages[0]).toMatchObject({ role: "dm", text: "A question", status: "done" });
    expect(reply).toEqual({
      id: expect.any(String),
      role: "model",
      text: "",
      status: "failed",
      error: { code: "llm_failed", error: "fake: 529 overloaded", status: 529 },
      rev: 2,
    });

    // A stale guard is a conflict with the current message.
    const stale = await send("PATCH", `${CHATS}/${chat.id}/messages/${reply.id}`, {
      rev: 1,
      status: "running",
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "rev_conflict", sceneChatMessage: reply });

    const retried = await json<SceneChatMessage>(
      send("PATCH", `${CHATS}/${chat.id}/messages/${reply.id}`, { rev: 2, status: "running" }),
    );
    expect(retried).toEqual({ id: reply.id, role: "model", text: "", status: "running", rev: 3 });
    const done = await settled(chat.id);
    expect(done.messages[1]).toEqual({ ...retried, text: "A reply.", status: "done", rev: 4 });
    expect(fake.requests[1]!.turns).toEqual([{ role: "user", content: "A question" }]);
    // Only a failed reply is retried, and a message takes no other write.
    const again = send("PATCH", `${CHATS}/${chat.id}/messages/${reply.id}`, { rev: 4, status: "running" });
    expect((await again).status).toBe(400);
    const dm = done.messages[0]!;
    const edit = send("PATCH", `${CHATS}/${chat.id}/messages/${dm.id}`, { rev: 1, text: "x" });
    expect((await edit).status).toBe(400);
  });

  test("a timeout and a reply cut off at the cap fail with their own reason", async () => {
    const chat = await json<SceneChat>(startChat(), 201);
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fake.answers.push({ error: timeout });
    await json(sendMessage(chat.id, "One"), 201);
    expect((await settled(chat.id)).messages[1]!.error).toMatchObject({ code: "llm_timeout" });

    fake.answers.push({ text: "Half a sent", truncated: true });
    await json(sendMessage(chat.id, "Two"), 201);
    expect((await settled(chat.id)).messages[3]!.error).toMatchObject({
      code: "scene_chat_reply_truncated",
      maxTokens: 1234,
    });
    // The failed replies are no turns of the conversation.
    fake.answers.push({ text: "Fine." });
    await json(sendMessage(chat.id, "Three"), 201);
    await settled(chat.id);
    expect(fake.requests[2]!.turns).toEqual([
      { role: "user", content: "One" },
      { role: "user", content: "Two" },
      { role: "user", content: "Three" },
    ]);
  });

  test("a message needs text, and a chat in the trash takes none", async () => {
    const chat = await json<SceneChat>(startChat(), 201);
    expect((await sendMessage(chat.id, "   ")).status).toBe(400);
    expect((await send("POST", `${CHATS}/${chat.id}/messages`, { text: "x", role: "model" })).status).toBe(400);
    await json(send("DELETE", `${CHATS}/${chat.id}`, { rev: 1 }));
    expect((await sendMessage(chat.id, "Hello")).status).toBe(404);
    expect(fake.requests).toEqual([]);
  });

  test("a reply running at a restart fails with the restart as its reason", async () => {
    const chat = await json<SceneChat>(startChat(), 201);
    fake.holding = true;
    await json(sendMessage(chat.id, "Before the restart"), 201);
    await asked(1);
    expect(failInterruptedReplies(await getDb())).toBe(1);
    const after = await json<SceneChat>(app.request(`${CHATS}/${chat.id}`));
    expect(after.messages[1]).toMatchObject({
      status: "failed",
      error: { code: "scene_chat_reply_restarted" },
      rev: 2,
    });
    // The reply the old process would have brought is not written over it.
    fake.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await json<SceneChat>(app.request(`${CHATS}/${chat.id}`))).messages[1]).toEqual(
      after.messages[1]!,
    );
  });
});

describe("without a provider", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  test("the instance says so, and a message is refused before anything is written", async () => {
    expect(await json<LlmProvider>(app.request("/api/llm-provider"))).toEqual({ configured: true });
    setChatProviderForTests(null);
    process.env = { ...saved, LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "" };
    expect(await json<LlmProvider>(app.request("/api/llm-provider"))).toEqual({ configured: false });

    const chat = await json<SceneChat>(startChat(), 201);
    const refused = await sendMessage(chat.id, "Hello");
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: "llm_unconfigured" });
    expect((await json<SceneChat>(app.request(`${CHATS}/${chat.id}`))).messages).toEqual([]);
  });
});

describe("clearing and the trash", () => {
  async function chatWithReply(scene = SCENE): Promise<SceneChat> {
    const chat = await json<SceneChat>(startChat(scene), 201);
    await json(sendMessage(chat.id, "A question"), 201);
    return settled(chat.id);
  }

  test("clearing puts the chat in the trash as one row; it comes back while the scene has no new chat", async () => {
    const chat = await chatWithReply();
    const stale = await send("DELETE", `${CHATS}/${chat.id}`, { rev: 0 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "rev_conflict", sceneChat: chat });

    const cleared = await json<SceneChat>(send("DELETE", `${CHATS}/${chat.id}`, { rev: 1 }));
    expect(cleared).toEqual({ ...chat, deletedMs: expect.any(Number), rev: 2 });
    expect(await chatsOf(SCENE)).toEqual([]);
    expect(await trashedChats()).toEqual([cleared]);
    expect((await app.request(`${CHATS}/${chat.id}`)).status).toBe(404);

    // A new chat on the scene stands in the way of the old one.
    const fresh = await json<SceneChat>(startChat(), 201);
    expect(fresh.id).not.toBe(chat.id);
    const blocked = await send("PATCH", `${CHATS}/${chat.id}`, { rev: 2, deletedMs: null });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "scene_chat_replaced", id: fresh.id });

    await json(send("DELETE", `${CHATS}/${fresh.id}`, { rev: 1 }));
    const restored = await json<SceneChat>(send("PATCH", `${CHATS}/${chat.id}`, { rev: 2, deletedMs: null }));
    expect(restored).toEqual({ ...chat, rev: 3 });
    expect(await chatsOf(SCENE)).toEqual([restored]);
    // A chat takes no other write.
    expect((await send("PATCH", `${CHATS}/${chat.id}`, { rev: 3, scene: "x", deletedMs: null })).status).toBe(400);
  });

  test("a scene takes its chat along to the trash and brings it back; a cleared one stays", async () => {
    const cleared = await chatWithReply();
    await json(send("DELETE", `${CHATS}/${cleared.id}`, { rev: 1 }));
    const live = await json<SceneChat>(startChat(), 201);

    const scene = await json<Scene>(app.request(`${CAMPAIGN}/scenes/${SCENE}`));
    const trashed = await json<Scene>(send("DELETE", `${CAMPAIGN}/scenes/${SCENE}`, { rev: scene.rev }));
    const inTrash = await trashedChats();
    expect(inTrash.map((chat) => chat.id).sort()).toEqual([cleared.id, live.id].sort());
    const along = inTrash.find((chat) => chat.id === live.id)!;
    expect(along).toEqual({ ...live, deletedMs: trashed.deletedMs, rev: 2 });
    // The cleared chat cannot come back while its scene is in the trash.
    const blocked = await send("PATCH", `${CHATS}/${cleared.id}`, { rev: 2, deletedMs: null });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      code: "restore_blocked",
      blockers: [{ kind: "scene", id: SCENE, name: "Caught by the Smugglers" }],
    });
    // A message on the chat that went along is refused like on any row in the trash.
    expect((await sendMessage(live.id, "Hello")).status).toBe(404);

    await json(send("PATCH", `${CAMPAIGN}/scenes/${SCENE}`, { rev: trashed.rev, deletedMs: null }));
    expect(await chatsOf(SCENE)).toEqual([{ ...live, rev: 3 }]);
    expect((await trashedChats()).map((chat) => chat.id)).toEqual([cleared.id]);
  });

  test("a chapter takes its scenes' chats along and brings them back", async () => {
    await json(send("POST", `${CAMPAIGN}/chapters`, { title: "Chapter Two", id: "two" }), 201);
    await json(send("POST", `${CAMPAIGN}/scenes`, { title: "First", chapter: "two", id: "first" }), 201);
    const chat = await chatWithReply("first");
    const chapter = await json<{ rev: number }>(app.request(`${CAMPAIGN}/chapters/two`));
    const trashed = await json<{ rev: number }>(
      send("DELETE", `${CAMPAIGN}/chapters/two`, { rev: chapter.rev }),
    );
    expect((await trashedChats()).map((row) => row.id)).toEqual([chat.id]);
    await json(send("PATCH", `${CAMPAIGN}/chapters/two`, { rev: trashed.rev, deletedMs: null }));
    expect(await chatsOf("first")).toEqual([{ ...chat, rev: 3 }]);
  });

  test("the purge removes a chat past the retention, its messages with it", async () => {
    const chat = await chatWithReply();
    await json(send("DELETE", `${CHATS}/${chat.id}`, { rev: 1 }));
    expect(await purgeTrash()).toBe(0);
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await purgeTrash(later)).toBe(1);
    expect(await trashedChats()).toEqual([]);
  });
});
