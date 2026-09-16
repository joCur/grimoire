// THE error-code contract between server and app (issue #69).
//
// The server is LANGUAGE-FREE. Until this module existed, a handful of error
// bodies carried German sentences and the app printed them verbatim — which
// meant an English UI showed German errors, and the copy for those errors
// lived in a place no catalog review would ever look at.
//
// So every error body a HUMAN reads now carries a stable `code` next to its
// `error` text:
//
//     { code: "slug_taken", error: "npc \"holm\" already exists …", id, suggestion, path }
//
//   * `code` is the contract. The app renders the sentence from its own
//     catalog (app/src/i18n, keys `server.<code>`), with the body's extra
//     fields as message parameters.
//   * `error` stays, in ENGLISH, as the technical fallback: it is what curl,
//     a log line and a future client see, and it is what the app shows for a
//     code it does not know (CLAUDE.md, "Format degradiert" — an unknown code
//     degrades to a readable sentence, never to a blank toast).
//
// Codes are append-only: an old one keeps its meaning and its parameters.
// Parameters that are pure ADDRESSING (`path`, `rev`, `conflicts`) are not
// listed here — they are part of the individual endpoint contracts in
// server/src/server.ts and are consumed as data, not as copy.

/**
 * Every code the server may send. The app has a catalog entry per code; a
 * code missing there falls back to the body's English `error` text.
 */
export const ERROR_CODES = [
  /** 409, create: the derived id is taken. `{ kind, id, suggestion, path }` */
  "slug_taken",
  /** 409, create: the derived id is a reserved address segment. `{ kind, id, suggestion }` */
  "slug_reserved",
  /** 400, create: the typed name yields no id at all. `{ kind, field }` */
  "slug_empty",
  /**
   * 400, scene write: `location` is neither empty nor an entity id
   * (#100 — a scene's location is always a REFERENCE, and the reference
   * creates the location row). `{ value, suggestion }`
   */
  "location_not_an_id",
  /** 400, glossary write: one term appears twice. `{ term }` */
  "glossary_duplicate_term",
  /** 409, session start: an older session is still running. `{ path }` */
  "session_running",
  /** 409, session discard: the session already carries content. `{ path }` */
  "session_not_empty",
  /** 409, any rev-checked write: the entry changed underneath. `{ rev }` */
  "rev_conflict",
  /** 503, generator: the server was restarted while the job was running. */
  "job_restarted",
  /** 422, generator: the model's reply hit the token ceiling. `{ maxTokens }` */
  "llm_truncated",
  /** 422, generator: the reply failed mechanical validation after the retries. */
  "llm_invalid",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * The entity kinds a create error can name. Stable TOKENS, not labels: the
 * app turns them into „NPC" / „Ort" / "location" itself.
 */
export const ERROR_KINDS = ["campaign", "chapter", "scene", "npc", "location"] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

/** Which input field a `slug_empty` points at — the app names it. */
export const ERROR_FIELDS = ["name", "title"] as const;

export type ErrorField = (typeof ERROR_FIELDS)[number];
