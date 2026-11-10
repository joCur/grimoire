// The reply of a scene chat (decisions/generator): written on the server,
// in the background, from the context as it is stored at that moment.
//
// Sending a message answers at once (routes/scene-chat-messages.ts) with the
// DM's message; the reply stands in the chat as `running`, and the app polls
// the chat until it is `done` or `failed`. Nothing depends on an open tab.
// A reply is not a generator job: it is no row of `generate_jobs`, counts
// against no limit of the campaign's job and waits for none.
//
// Every reply sends the whole conversation, because the model APIs keep no
// state: the system prompt (generator/scene-chat-system-prompt.md plus the
// language of the DM), the CONTEXT block as the first user turn — the
// campaign knowledge, the glossary, the chapter's text, the scene with every
// field and its text, the npcs its `npcs` names and the location its
// `location` names, each with every field and its text — and then the
// written messages of the chat so far. The context comes first and stays the
// same from reply to reply until the DM edits what it shows, so the providers
// cache it (llm-provider.ts `chatTurns`).
//
// The reply is free Markdown and is never written into a row of the
// campaign: it carries no schema and is not validated. A reply that cannot be
// written — a provider error, a timeout, a reply cut off at the output cap, a
// restart (db/scene-chat-boot.ts) — fails with its reason as an error body
// the app says in a sentence, and the DM retries it.

import type { SceneChatRole } from "@grimoire/shared/scene-chat-message";
import { ApiError } from "./api-error";
import { ASSET_FILES, loadAsset, providerUnconfigured } from "./generator";
import {
  createProvider,
  GLOSSARY_HEADING,
  KNOWLEDGE_HEADING,
  ProviderError,
  type ChatProvider,
  type ChatRequest,
  type ChatTurn,
} from "./llm-provider";
// The reply reads its context and writes itself through the store — nothing
// else is a data source.
import { readChapter } from "./store/chapters";
import { glossaryText } from "./store/glossary-terms";
import { getDb } from "./store/handle";
import { knowledgeText } from "./store/knowledge-items";
import { readLocation } from "./store/locations";
import { readNpc } from "./store/npcs";
import { readScene } from "./store/scenes";
import {
  finishSceneChatReply,
  sceneChatReplyInput,
  type ReplyOutcome,
} from "./store/scene-chat-messages";
import { readSettings } from "./store/settings";

/** How long a reply may take before it fails as timed out. */
export const SCENE_CHAT_REPLY_TIMEOUT_MS = 5 * 60 * 1000;

// The headings of the context block. Their content is German on purpose, like
// every prompt of the generator; only code and comments here are English.
// Constants because the E2E stub reads the context by them.

/** The chapter the scene belongs to, its title and its text. */
export const CHAT_CHAPTER_HEADING = "## Kapitel";
/** The scene the chat is about, every field of it. */
export const CHAT_SCENE_HEADING = "## Szene";
/** One npc the scene names, every field of it. */
export const CHAT_NPC_HEADING = "## NPC";
/** The location the scene plays at, every field of it. */
export const CHAT_LOCATION_HEADING = "## Ort";

/** The sentence that sets the language of the replies, per UI language. */
const REPLY_LANGUAGE = {
  de: "Antworte auf Deutsch.",
  en: "Antworte auf Englisch.",
} as const;

/** The primary UI language, which applies while the instance has no stored one. */
const DEFAULT_LOCALE = "de";

// --- provider resolution ---------------------------------------------------

let providerOverride: ChatProvider | null = null;

/** Test-only hook: route chat replies through a fake provider (null resets). */
export function setChatProviderForTests(provider: ChatProvider | null): void {
  providerOverride = provider;
}

/**
 * Resolve the configured provider, per message. An unconfigured provider
 * answers 503 `llm_unconfigured`, before anything is written.
 */
export function obtainChatProvider(): ChatProvider {
  if (providerOverride !== null) return providerOverride;
  try {
    return createProvider(process.env);
  } catch (err) {
    throw providerUnconfigured(err);
  }
}

/** Whether a provider is configured — `GET /api/llm-provider`. */
export function chatProviderConfigured(): boolean {
  if (providerOverride !== null) return true;
  try {
    createProvider(process.env);
    return true;
  } catch {
    return false;
  }
}

// --- the context -------------------------------------------------------------

/** An entity as the context shows it: every field, without its guard. */
function fields<T extends { rev: number; deletedMs?: number }>(entity: T): Omit<T, "rev" | "deletedMs"> {
  const { rev: _rev, deletedMs: _deletedMs, ...rest } = entity;
  return rest;
}

/** One entity as a heading with its id and the entity as JSON below it. */
function entityBlock(heading: string, id: string, entity: unknown): string {
  return [`${heading} (${id})`, "```json", JSON.stringify(entity, null, 2), "```"].join("\n");
}

/** The row behind a reference, or undefined when it is not there (any more). */
async function present<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

/**
 * The context block of a reply on this scene, read as it is stored now: the
 * campaign knowledge and the glossary when the campaign has any, the chapter
 * with its title and text, the scene, its npcs and its location, each with
 * every field and its text. A section with nothing to say is left out.
 */
export async function sceneChatContext(campaign: string, sceneId: string): Promise<string> {
  const scene = await readScene(campaign, sceneId);
  const [knowledge, glossary, chapter, location, ...npcs] = await Promise.all([
    knowledgeText(campaign),
    glossaryText(campaign),
    present(readChapter(campaign, scene.chapter)),
    scene.location === undefined ? undefined : present(readLocation(campaign, scene.location)),
    ...scene.npcs.map((npc) => present(readNpc(campaign, npc))),
  ]);
  return [
    ...(knowledge === undefined ? [] : [KNOWLEDGE_HEADING, knowledge]),
    ...(glossary === undefined ? [] : [GLOSSARY_HEADING, glossary]),
    ...(chapter === undefined
      ? []
      : [`${CHAT_CHAPTER_HEADING} (${chapter.id}): ${chapter.title}`, chapter.body.trim()]),
    entityBlock(CHAT_SCENE_HEADING, scene.id, fields(scene)),
    ...npcs.flatMap((npc) =>
      npc === undefined ? [] : [entityBlock(CHAT_NPC_HEADING, npc.id, fields(npc))],
    ),
    ...(location === undefined ? [] : [entityBlock(CHAT_LOCATION_HEADING, location.id, fields(location))]),
  ]
    .filter((section) => section !== "")
    .join("\n\n");
}

/** The system prompt of every reply: the chat prompt and the DM's language. */
async function systemPrompt(): Promise<string> {
  const prompt = await loadAsset(ASSET_FILES.sceneChat.systemPrompt);
  const locale = (await readSettings()).locale ?? DEFAULT_LOCALE;
  return `${prompt.trimEnd()}\n\n${REPLY_LANGUAGE[locale]}\n`;
}

/** A stored role in the role both APIs speak. */
function turnRole(role: SceneChatRole): ChatTurn["role"] {
  return role === "dm" ? "user" : "assistant";
}

// --- the reply -----------------------------------------------------------------

/** The error body of a failed reply, in the shape every server error has. */
function failure(err: unknown): Record<string, unknown> {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return { code: "llm_timeout", error: "the provider did not answer in time" };
  }
  if (err instanceof ProviderError) {
    return { code: "llm_failed", error: err.message, status: err.status };
  }
  return {
    code: "llm_failed",
    error: err instanceof Error ? err.message : "the reply could not be written",
  };
}

/**
 * Write the running reply `replyId` of a chat: read its context and the
 * turns before it, ask the provider, and store the text or the reason it
 * failed. Never throws — every failure ends up on the reply. A reply that is
 * no longer running (or no longer there) when it starts is left alone.
 */
export async function writeSceneChatReply(
  campaign: string,
  chatId: string,
  replyId: string,
  provider: ChatProvider,
): Promise<void> {
  let outcome: ReplyOutcome;
  try {
    const input = sceneChatReplyInput(await getDb(), campaign, chatId, replyId);
    if (input === undefined) return;
    const request: ChatRequest = {
      systemPrompt: await systemPrompt(),
      context: await sceneChatContext(campaign, input.scene),
      turns: input.turns.map((turn) => ({ role: turnRole(turn.role), content: turn.text })),
    };
    const reply = await provider.chat(request, AbortSignal.timeout(SCENE_CHAT_REPLY_TIMEOUT_MS));
    const text = reply.text.trim();
    if (reply.refusal !== undefined) {
      outcome = {
        status: "failed",
        error: {
          code: "llm_refused",
          error: "the model declined to answer",
          ...(reply.refusal === "" ? {} : { reason: reply.refusal }),
        },
      };
    } else if (reply.truncated) {
      outcome = {
        status: "failed",
        error: {
          code: "scene_chat_reply_truncated",
          error: "the reply hit the output cap and is cut off",
          ...(provider.maxTokens === undefined ? {} : { maxTokens: provider.maxTokens }),
        },
      };
    } else if (text === "") {
      outcome = {
        status: "failed",
        error: { code: "llm_failed", error: "the provider sent an empty reply" },
      };
    } else {
      outcome = { status: "done", text };
    }
  } catch (err) {
    outcome = { status: "failed", error: failure(err) };
  }
  try {
    await finishSceneChatReply(campaign, chatId, replyId, outcome);
  } catch (err) {
    // The database is gone (a shutdown mid-reply): the row stays `running`,
    // and the next boot fails it with the restart as its reason.
    console.error("could not record the scene chat reply", err);
  }
}

/**
 * Start writing a reply in the background. Fire and forget: the writer
 * records every failure on the reply itself.
 */
export function startSceneChatReply(
  campaign: string,
  chatId: string,
  replyId: string,
  provider: ChatProvider,
): void {
  void writeSceneChatReply(campaign, chatId, replyId, provider);
}
