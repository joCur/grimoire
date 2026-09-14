// Server error bodies, read in the UI language (issue #69).
//
// The server is language-free (`@grimoire/shared/error-codes`): every error a
// human reads carries a stable `code` plus the parameters its sentence needs,
// and an ENGLISH `error` text as the technical fallback. This module is the
// app's half of that contract — one place that turns a wire body into one
// sentence, so no view has to know the code list.
//
//     serverErrorMessage(error, t)   // ApiError -> the sentence to show
//
// THE DEGRADE RULE (CLAUDE.md): a body with no code, an UNKNOWN code (a newer
// server talking to this app), or a code whose parameters are missing falls
// back to the body's own `error` text, and only then to a generic sentence.
// Nothing here ever throws and nothing ever renders an empty string.
//
// The code -> key map is EXPLICIT and exhaustive (`Record<ErrorCode, …>`), so
// a code added to the shared list without a catalog entry is a typecheck
// failure rather than a sentence that silently degrades in production.

import { isErrorCode, type ErrorCode, type ErrorField, type ErrorKind } from "@grimoire/shared";

import { ApiError } from "@/api";

import type { MessageParams, Translate } from "./format";
import type { MessageKey } from "./messages";

const CODE_KEY: Record<ErrorCode, MessageKey> = {
  slug_taken: "server.slug_taken",
  slug_reserved: "server.slug_reserved",
  slug_empty: "server.slug_empty",
  location_not_an_id: "server.location_not_an_id",
  glossary_duplicate_term: "server.glossary_duplicate_term",
  session_running: "server.session_running",
  session_not_empty: "server.session_not_empty",
  rev_conflict: "server.rev_conflict",
  job_restarted: "server.job_restarted",
  llm_truncated: "server.llm_truncated",
  llm_invalid: "server.llm_invalid",
};

const KIND_KEY: Record<ErrorKind, MessageKey> = {
  campaign: "server.kind.campaign",
  chapter: "server.kind.chapter",
  scene: "server.kind.scene",
  npc: "server.kind.npc",
  location: "server.kind.location",
};

const FIELD_KEY: Record<ErrorField, MessageKey> = {
  name: "server.field.name",
  title: "server.field.title",
};

function isKind(value: unknown): value is ErrorKind {
  return typeof value === "string" && value in KIND_KEY;
}

function isField(value: unknown): value is ErrorField {
  return typeof value === "string" && value in FIELD_KEY;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The message parameters a code's sentence takes, translated where they are
 * TOKENS rather than data. `undefined` means "this body does not carry what
 * its own code promised" — the caller then degrades instead of formatting a
 * sentence with a hole in it.
 */
function paramsFor(
  code: ErrorCode,
  body: Record<string, unknown>,
  t: Translate,
): MessageParams | undefined {
  switch (code) {
    case "slug_taken":
    case "slug_reserved": {
      const id = text(body.id);
      const suggestion = text(body.suggestion);
      if (id === undefined || suggestion === undefined) return undefined;
      // `kind` is optional on purpose: an older server sends none, and the
      // sentence reads fine with the generic „Der Eintrag".
      const kind = isKind(body.kind) ? t(KIND_KEY[body.kind]) : t("server.kind.entry");
      return { id, suggestion, kind };
    }
    case "slug_empty": {
      if (!isField(body.field)) return undefined;
      return { field: t(FIELD_KEY[body.field]) };
    }
    case "location_not_an_id": {
      const value = text(body.value);
      if (value === undefined) return undefined;
      // Without a usable slug there is nothing to propose — the sentence
      // then names only what was typed (two catalog entries, one code).
      const suggestion = text(body.suggestion);
      return suggestion === undefined ? { value } : { value, suggestion };
    }
    case "glossary_duplicate_term": {
      const term = text(body.term);
      return term === undefined ? undefined : { term };
    }
    case "llm_truncated": {
      // No cap configured: the endpoint's own default, which has no number.
      const max = typeof body.maxTokens === "number" ? String(body.maxTokens) : undefined;
      return { max: max ?? t("server.llm_truncated.defaultCap") };
    }
    case "session_running":
    case "session_not_empty":
    case "rev_conflict":
    case "job_restarted":
    case "llm_invalid":
      return {};
  }
}

/**
 * The sentence for a server error BODY (the `{ code, error, … }` object) in
 * the UI language, or `undefined` when this body says nothing a catalog can
 * improve on. Exported for the generator, which reads a failed JOB's stored
 * body rather than an `ApiError`.
 */
export function serverErrorBodyMessage(
  body: Record<string, unknown> | undefined,
  t: Translate,
): string | undefined {
  if (body === undefined) return undefined;
  const { code } = body;
  if (isErrorCode(code)) {
    const params = paramsFor(code, body, t);
    if (params !== undefined) {
      // One code, two sentences: „location_not_an_id" reads differently with
      // and without a proposal, and a placeholder with no value would show
      // as the literal `{suggestion}`.
      if (code === "location_not_an_id" && params.suggestion === undefined) {
        return t("server.location_not_an_id.noSuggestion", params);
      }
      return t(CODE_KEY[code], params);
    }
  }
  // No code, an unknown one, or one whose body is incomplete: the server's own
  // English text is still the most specific thing anybody has.
  return text(body.error);
}

/**
 * The sentence a failed request shows. Falls back through: catalog entry for
 * the code -> the server's English `error` text -> `fallback` (the view's own
 * „… — Server prüfen", which is what a network error or a 500 deserves).
 */
export function serverErrorMessage(error: unknown, t: Translate, fallback: MessageKey): string {
  if (!(error instanceof ApiError)) return t(fallback);
  return serverErrorBodyMessage(error.details, t) ?? t(fallback);
}
