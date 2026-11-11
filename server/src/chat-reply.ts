// What every free-text reply of the model shares (decisions/generator): the
// brainstorming chat of a scene (./scene-chat-reply.ts) and the quick-ideas
// chat of a running session (./quick-ideas-reply.ts).
//
// Both are a conversation, not a run: the request carries no schema, the
// reply is Markdown the DM reads and is never written into a row of the
// campaign. Both resolve the provider per question, read the scene they are
// about fresh from the store, answer in the DM's UI language and turn a reply
// that cannot be used — a provider error, a timeout, a refusal, a reply cut
// off at the output cap, an empty one — into an error body in the shape of
// every server error, which the app says in a sentence.

import { ApiError } from "./api-error";
import { loadAsset, providerUnconfigured } from "./generator";
import {
  createProvider,
  GLOSSARY_HEADING,
  KNOWLEDGE_HEADING,
  ProviderError,
  type ChatProvider,
  type ChatRequest,
} from "./llm-provider";
// The context is read through the store — nothing else is a data source.
import { readChapter } from "./store/chapters";
import { glossaryText } from "./store/glossary-terms";
import { knowledgeText } from "./store/knowledge-items";
import { readLocation } from "./store/locations";
import { readNpc } from "./store/npcs";
import { readScene } from "./store/scenes";
import { readSettings } from "./store/settings";

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
 * Resolve the configured provider, per question. An unconfigured provider
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
 * The sections of the context block about one scene, read as it is stored
 * now: the campaign knowledge and the glossary when the campaign has any,
 * the chapter with its title and text, the scene, its npcs and its location,
 * each with every field and its text. A section with nothing to say is left
 * out. 404 when the scene is not there.
 */
export async function sceneContextSections(campaign: string, sceneId: string): Promise<string[]> {
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
  ];
}

/** The sections of a context block as one text, empty sections left out. */
export function contextBlock(sections: readonly string[]): string {
  return sections.filter((section) => section !== "").join("\n\n");
}

/** The system prompt of a reply: the chat's own prompt and the DM's language. */
export async function chatSystemPrompt(asset: string): Promise<string> {
  const prompt = await loadAsset(asset);
  const locale = (await readSettings()).locale ?? DEFAULT_LOCALE;
  return `${prompt.trimEnd()}\n\n${REPLY_LANGUAGE[locale]}\n`;
}

// --- the reply -----------------------------------------------------------------

/** What became of one question: the reply's text, or why there is none. */
export type ChatOutcome =
  | { status: "done"; text: string }
  | { status: "failed"; error: Record<string, unknown> };

/** The error body of a reply that failed with an exception. */
export function chatFailure(err: unknown): Record<string, unknown> {
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
 * Ask the provider for one reply and say what became of it. Never throws:
 * a reply the DM cannot use is a failed outcome with its error body, and a
 * reply cut off at the output cap fails with the chat's own `truncatedCode`.
 */
export async function askChat(
  provider: ChatProvider,
  request: ChatRequest,
  options: { timeoutMs: number; truncatedCode: string },
): Promise<ChatOutcome> {
  try {
    const reply = await provider.chat(request, AbortSignal.timeout(options.timeoutMs));
    const text = reply.text.trim();
    if (reply.refusal !== undefined) {
      return {
        status: "failed",
        error: {
          code: "llm_refused",
          error: "the model declined to answer",
          ...(reply.refusal === "" ? {} : { reason: reply.refusal }),
        },
      };
    }
    if (reply.truncated) {
      return {
        status: "failed",
        error: {
          code: options.truncatedCode,
          error: "the reply hit the output cap and is cut off",
          ...(provider.maxTokens === undefined ? {} : { maxTokens: provider.maxTokens }),
        },
      };
    }
    if (text === "") {
      return { status: "failed", error: { code: "llm_failed", error: "the provider sent an empty reply" } };
    }
    return { status: "done", text };
  } catch (err) {
    return { status: "failed", error: chatFailure(err) };
  }
}
