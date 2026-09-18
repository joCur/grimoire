// THE error-code contract between server and app.
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
   * 400, scene write: `location` is neither empty nor an entity id — a
   * scene's location is always a REFERENCE. `{ value, suggestion }`
   */
  "location_not_an_id",
  /**
   * The five REFERENCE refusals: a write names an entry that does not
   * exist. Nothing is created by being named, so each of them asks the DM
   * to create the entry first. All 400, all `{ value }`. `chapter_required`
   * below is the neighbouring case — the reference is not wrong, it is gone.
   */
  /** A scene's `location` names no location entry. */
  "location_unknown",
  /** An entry of a scene's npc list names no npc entry. */
  "npc_unknown",
  /** A `chapter` — of a scene, an npc or a location — names no chapter. */
  "chapter_unknown",
  /**
   * 400, scene write: the `chapter` was CLEARED. A scene's chapter is part of
   * its address, so it can be moved but never removed. No parameters — there
   * is no value to name.
   */
  "chapter_required",
  /** The scene of a quick note names no scene entry. */
  "log_scene_unknown",
  /** An entry of a session's played scenes names no scene entry. */
  "played_scene_unknown",
  /** 400, glossary write: one term appears twice. `{ term }` */
  "glossary_duplicate_term",
  /** 409, session start: an older session is still running. `{ path }` */
  "session_running",
  /** 409, session discard: the session already carries content. `{ path }` */
  "session_not_empty",
  /**
   * 409, any rev-checked write: the entry changed underneath. `{ rev }`, and
   * for the writes of one entry also `{ entry }` — the current
   * `EntryResponse`, so the app can show what is there instead of fetching
   * it again.
   */
  "rev_conflict",
  /**
   * 400, entry write: neither `properties` nor `body` was sent — the request
   * asks for no change at all. No parameters.
   */
  "nothing_to_write",
  /**
   * 400, entry write: the address carries a LIST, not a text — the glossary,
   * the inbox, and a session's log. They are edited through their own
   * endpoints, so a `body` on them would silently do nothing. `{ path }`
   *
   * This code is a stopgap: it exists only while these lists still carry an
   * entry address at all. They get their own read endpoints and views, and
   * with that address the guard and this code go away.
   */
  "body_not_editable",
  /** 503, generator: the server was restarted while the job was running. */
  "job_restarted",
  /**
   * 409, generator: the job's drafts predate the current draft format (ADR
   * #24) and cannot be reviewed or accepted — the run has to be started
   * again.
   */
  "job_draft_format",
  /** 422, generator: the model's reply hit the token ceiling. `{ maxTokens }` */
  "llm_truncated",
  /** 422, generator: the reply failed mechanical validation after the retries. */
  "llm_invalid",
  /**
   * 400, entry write: `status` carries a value the column does not accept.
   * The four status columns are CLOSED (ADR #25), so a value outside the list
   * can only be a typo. `{ kind, value, allowed }` — `allowed` is the list in
   * order, so the app can name the positions without knowing the kind.
   */
  "status_not_allowed",
  /**
   * 400, scene write: `type` carries a value outside `SCENE_TYPES`. Same rule
   * as `status_not_allowed`, its own code because it is its own field.
   * `{ value, allowed }`
   */
  "scene_type_not_allowed",
  /**
   * 400, session write: a `started`, `ended` or pause timestamp is not in the
   * one shape those columns hold (`yyyy-mm-ddThh:mm:ss`). The shape is closed
   * the way a status is: the reader reads only it, and the boot check refuses
   * a database holding anything else — so a value from the wire is refused
   * here instead of surviving until the next start. `{ field, value }`, where
   * `field` is addressing (`started`, `ended`, `pauses[0].from`) and `value`
   * is what the sentence names.
   */
  "timestamp_not_allowed",
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
