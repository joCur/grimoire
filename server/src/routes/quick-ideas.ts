// The quick-ideas chat of a running session: one question, answered at once.
//
// The chat is no resource and no row (decisions/generator): nothing of it is
// stored, so this module has no list, no GET and no guard. A question is a
// POST because its input — the open scene and the whole conversation — does
// not fit a URL; it changes no state.

import { Hono } from "hono";
import { answerQuickIdeas, readQuickIdeasQuestion } from "../quick-ideas-reply";
import { jsonBody } from "./http";

export const quickIdeasRoutes = new Hono();

// POST /api/campaigns/:campaign/sessions/:session/quick-ideas
//   { scene, messages: [{ role, text }] } -> { text }
// The model's reply to the DM's question — the last of `messages`, which
// carry the conversation so far in order (`role` `dm` or `model`, `text`
// Markdown) — as Markdown, answered in the same request. The reply reads its
// context from the campaign at this moment: the campaign knowledge, the
// glossary, the scene `scene` names with its chapter, its npcs and its
// location, and the session's log lines so far. NOTHING is written, on any
// path.
//
// A conversation that is empty, has an empty text, or does not end with the
// DM's question is a 400, and so is a key that is none of these. 404 for an
// unknown campaign, session or scene. An ended session takes no question:
// 409 { code: "session_ended", id }. Without a configured provider, 503
// { code: "llm_unconfigured" }. A reply that cannot be used answers its
// reason: 502 { code: "llm_failed", status? } for a provider error or an
// empty reply, 504 { code: "llm_timeout" } when the provider does not answer
// in time, 422 { code: "llm_refused", reason? } for a refusal and 422
// { code: "quick_ideas_reply_truncated", maxTokens? } for a reply cut off at
// the output cap.
quickIdeasRoutes.post("/campaigns/:campaign/sessions/:session/quick-ideas", async (c) => {
  const question = readQuickIdeasQuestion(await jsonBody(c, null));
  return c.json(await answerQuickIdeas(c.req.param("campaign"), c.req.param("session"), question));
});
