// Server error bodies, read in the UI language.
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
  location_unknown: "server.location_unknown",
  npc_unknown: "server.npc_unknown",
  chapter_unknown: "server.chapter_unknown",
  chapter_required: "server.chapter_required",
  log_scene_unknown: "server.log_scene_unknown",
  played_scene_unknown: "server.played_scene_unknown",
  glossary_duplicate_term: "server.glossary_duplicate_term",
  glossary_term_taken: "server.glossary_term_taken",
  scene_order_mismatch: "server.scene_order_mismatch",
  session_running: "server.session_running",
  session_not_empty: "server.session_not_empty",
  session_ended: "server.session_ended",
  rev_conflict: "server.rev_conflict",
  nothing_to_write: "server.nothing_to_write",
  body_not_editable: "server.body_not_editable",
  job_restarted: "server.job_restarted",
  job_draft_format: "server.job_draft_format",
  llm_truncated: "server.llm_truncated",
  llm_invalid: "server.llm_invalid",
  status_not_allowed: "server.status_not_allowed",
  scene_type_not_allowed: "server.scene_type_not_allowed",
  timestamp_not_allowed: "server.timestamp_not_allowed",
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
 * A list parameter as one readable enumeration. The closed columns (ADR #25)
 * send their allowed values in column order, and the sentence names them in
 * that order — the values are stored identifiers, not translated labels, so
 * they are shown as they will have to be typed.
 */
function list(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item !== "");
  return items.length === 0 ? undefined : items.join(", ");
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
    case "location_unknown":
    case "npc_unknown":
    case "chapter_unknown":
    case "log_scene_unknown":
    case "played_scene_unknown": {
      // The reference refusals share one shape: the value that names nothing.
      // Without it there is no sentence worth showing.
      const value = text(body.value);
      return value === undefined ? undefined : { value };
    }
    case "glossary_duplicate_term":
    case "glossary_term_taken": {
      const term = text(body.term);
      return term === undefined ? undefined : { term };
    }
    case "status_not_allowed":
    case "scene_type_not_allowed": {
      // The two refusals of a closed column share one shape: the value that
      // was written and the positions the column accepts. `kind` rides along
      // on `status_not_allowed` to say WHICH status column refused, but the
      // sentence does not need it — the DM is looking at that entry, and the
      // enumerated positions already say which list this is.
      const value = text(body.value);
      const allowed = list(body.allowed);
      if (value === undefined || allowed === undefined) return undefined;
      return { value, allowed };
    }
    case "timestamp_not_allowed": {
      // The refused time itself is the whole sentence. The `field` next to it
      // is addressing — the DM is looking at that session, and the shape the
      // sentence spells out says everything the value is missing.
      const value = text(body.value);
      return value === undefined ? undefined : { value };
    }
    case "llm_truncated": {
      // No cap configured: the endpoint's own default, which has no number.
      const max = typeof body.maxTokens === "number" ? String(body.maxTokens) : undefined;
      return { max: max ?? t("server.llm_truncated.defaultCap") };
    }
    // The codes whose sentence names a RULE rather than a value, so there is
    // no parameter to check for. `nothing_to_write` says the request carried
    // no field to write. `body_not_editable` has no sender left — no address
    // names a list any more, so there is no text to refuse — and stands here
    // only because the code list is append-only. `job_draft_format` has no
    // sender left either, but a job an older version failed with it still
    // shows its sentence.
    case "chapter_required":
    case "session_running":
    case "session_not_empty":
    case "session_ended":
    case "rev_conflict":
    case "job_restarted":
    case "job_draft_format":
    case "llm_invalid":
    case "nothing_to_write":
    case "body_not_editable":
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
