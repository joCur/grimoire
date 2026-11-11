// The quick-ideas chat of a running session (decisions/generator): the DM
// asks the model for ideas at the table, and the reply is answered in the
// same request.
//
// NOTHING IS STORED. The chat is no entity and no row: the live view holds
// the conversation and sends it whole with every question, and the server
// reads, asks and answers — it writes nothing, not even on a failure. That is
// why the reply is answered synchronously instead of being written in the
// background like the scene chat's: there is no row to write it to and none
// for the app to poll. A reply waits at most QUICK_IDEAS_REPLY_TIMEOUT_MS,
// which stays below the time the server keeps a silent connection open
// (server.ts), so a slow model ends as a sentence the DM reads and never as a
// dropped connection.
//
// Every question sends: the system prompt
// (generator/quick-ideas-system-prompt.md plus the language of the DM), the
// CONTEXT block as the first user turn — read fresh from the campaign at the
// moment of the question: the campaign knowledge, the glossary, the chapter's
// text, the open scene with every field and its text, its npcs and its
// location, and the session's log lines so far — and then the conversation,
// the DM's question last.

import type { QuickIdeasQuestion, QuickIdeasReply, QuickIdeasRole } from "@grimoire/shared/quick-ideas";
import { quickIdeasQuestionSchema } from "@grimoire/shared/quick-ideas";
import type { LogEntry } from "@grimoire/shared/log-entry";
import { ApiError } from "./api-error";
import { askChat, chatSystemPrompt, contextBlock, obtainChatProvider, sceneContextSections } from "./chat-reply";
import { ASSET_FILES } from "./generator";
import type { ChatTurn } from "./llm-provider";
import { readRunningSession } from "./store/sessions";
import { parseRequest } from "./store/shared";

/**
 * How long a reply may take before the question fails as timed out — below
 * the idle timeout of the server's connections (server.ts).
 */
export const QUICK_IDEAS_REPLY_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * The heading of the session's log lines in the context block. German like
 * every prompt; a constant because the E2E stub reads the context by it.
 */
export const QUICK_IDEAS_LOG_HEADING = "## Notizen dieser Session";

/** The HTTP status of a question whose reply failed, by the reason's code. */
const FAILURE_STATUS: Record<string, 422 | 502 | 504> = {
  llm_timeout: 504,
  llm_refused: 422,
  quick_ideas_reply_truncated: 422,
};

/** The body of a question, or 400 naming what is wrong with it. */
export function readQuickIdeasQuestion(raw: unknown): QuickIdeasQuestion {
  const question = parseRequest(quickIdeasQuestionSchema, raw, "quick-ideas question");
  if (question.messages.some((turn) => turn.text.trim() === "")) {
    throw new ApiError(400, "every message must have a non-empty text");
  }
  if (question.messages.at(-1)?.role !== "dm") {
    throw new ApiError(400, "the last message must be the DM's question");
  }
  return question;
}

/** One log line as the context shows it: its time, its scene and its text. */
function logLine(entry: LogEntry): string {
  return `- ${entry.at}${entry.sceneId === undefined ? "" : ` (${entry.sceneId})`}: ${entry.text}`;
}

/** A role of the conversation in the role both APIs speak. */
function turnRole(role: QuickIdeasRole): ChatTurn["role"] {
  return role === "dm" ? "user" : "assistant";
}

/**
 * Answer one question of the quick-ideas chat of a running session: read the
 * context, ask the provider, and answer its reply. 404 for an unknown
 * campaign, session or scene; 409 `session_ended` for an ended session; 503
 * `llm_unconfigured` without a provider; a reply that cannot be used is the
 * error of its reason. Nothing is written on any path.
 */
export async function answerQuickIdeas(
  campaign: string,
  sessionId: string,
  question: QuickIdeasQuestion,
): Promise<QuickIdeasReply> {
  const session = await readRunningSession(campaign, sessionId);
  const sections = await sceneContextSections(campaign, question.scene);
  const provider = obtainChatProvider();
  const log = session.log.map(logLine).join("\n");
  const outcome = await askChat(
    provider,
    {
      systemPrompt: await chatSystemPrompt(ASSET_FILES.quickIdeas.systemPrompt),
      context: contextBlock([...sections, ...(log === "" ? [] : [QUICK_IDEAS_LOG_HEADING, log])]),
      turns: question.messages.map((turn) => ({ role: turnRole(turn.role), content: turn.text.trim() })),
    },
    { timeoutMs: QUICK_IDEAS_REPLY_TIMEOUT_MS, truncatedCode: "quick_ideas_reply_truncated" },
  );
  if (outcome.status === "done") return { text: outcome.text };
  const { error, ...extra } = outcome.error;
  const code = typeof extra.code === "string" ? extra.code : "llm_failed";
  throw new ApiError(FAILURE_STATUS[code] ?? 502, typeof error === "string" ? error : "the reply failed", extra);
}
