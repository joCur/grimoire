// THE error-code contract between server and app.
//
// The server is LANGUAGE-FREE: a sentence the DM reads lives in the app's
// catalog, in both languages, and never in a server response.
//
// So every error body a HUMAN reads carries a stable `code` next to its
// `error` text:
//
//     { code: "slug_taken", error: "npc \"holm\" already exists …", kind, id, suggestion }
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
// Parameters that are pure ADDRESSING (`rev`, the ids of a generator 409) are
// not listed here — they are part of the individual endpoint contracts in
// server/src/routes/ and are consumed as data, not as copy.

/**
 * Every code the server may send. The app has a catalog entry per code; a
 * code missing there falls back to the body's English `error` text.
 */
export const ERROR_CODES = [
  /** 409, create: the derived id is taken. `{ kind, id, suggestion }` */
  "slug_taken",
  /**
   * NOT SENT: the 409 for a chapter id that collides with a segment of an
   * address. Every entity is its own resource (decisions/resources), so no id
   * collides with a path. The string stays because codes are APPEND-ONLY.
   */
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
  /** A `chapter` — of a scene, an npc, a location or a thread — names no chapter. */
  "chapter_unknown",
  /**
   * 400, scene write: the `chapter` was CLEARED. A scene always belongs to a
   * chapter, so it can be moved but never removed. No parameters — there is
   * no value to name.
   */
  "chapter_required",
  /** The scene of a quick note (a session's log entry) names no scene. */
  "log_scene_unknown",
  /**
   * NO LONGER SENT. It was the 400 for a session's played scene that named no
   * scene; whether a scene was played is its `status` alone, and a session
   * records no played scenes. The string stays because codes are APPEND-ONLY.
   */
  "played_scene_unknown",
  /**
   * NOT SENT: the 400 for a whole-glossary write that names one term twice.
   * Every glossary term is its own resource (decisions/resources), and a term
   * that is already there answers `glossary_term_taken` below. The string
   * stays because codes are APPEND-ONLY.
   */
  "glossary_duplicate_term",
  /**
   * 400, scene-order write: the list is not exactly the chapter's scenes —
   * one is missing, one belongs to another chapter, or one appears twice.
   * The order is written as a WHOLE, so a list that does not describe the
   * whole chapter writes nothing at all. `{ missing, unknown, duplicate }`,
   * each an id list in the order the request had them, so the app can name
   * what is wrong without asking again.
   */
  "scene_order_mismatch",
  /** 409, session start: an older session is still running. `{ id }` */
  "session_running",
  /** 409, session delete: the session already carries content. `{ id }` */
  "session_not_empty",
  /**
   * 409, any rev-checked write: what was written changed underneath.
   * `{ rev }` always, plus the CURRENT state where there is one to hand back,
   * so the app can show what is in the way instead of fetching it again,
   * under the key of what was written: `{ campaign }`, `{ chapter }`,
   * `{ scene }`, `{ npc }`, `{ location }`, `{ thread }`, `{ idea }`,
   * `{ glossaryTerm }`, `{ knowledgeItem }`, `{ session }`, `{ pause }` or
   * `{ logEntry }` for the write of one of those, and `{ knowledgeItemOrder }`
   * for the order of the knowledge items. The scene order carries none of them —
   * the chapter overview reloads its tree.
   */
  "rev_conflict",
  /**
   * 400, a patch that names nothing to change: a campaign, chapter, scene,
   * npc, location, thread, idea, glossary-term, knowledge-item, session,
   * pause or log-entry patch without a field. No parameters.
   */
  "nothing_to_write",
  /**
   * NOT SENT: the 400 for a `body` sent to a session, an idea or a glossary
   * term, none of which has a text field; each of them has endpoints of its
   * own that take no `body`. The string stays because codes are APPEND-ONLY —
   * an app catalog that holds it is not wrong, it is just unreachable.
   */
  "body_not_editable",
  /** 503, generator: the server was restarted while the job was running. */
  "job_restarted",
  /**
   * NOT SENT: the 409 for a job whose drafts are not in the current draft
   * format (decisions/generator). Every supported database holds its drafts
   * in that format (decisions/sqlite), so no boot fails a job with it. The
   * string stays because codes are APPEND-ONLY — and a job stored with it
   * still carries it in its error body.
   */
  "job_draft_format",
  /** 422, generator: the model's reply hit the token ceiling. `{ maxTokens }` */
  "llm_truncated",
  /** 422, generator: the reply failed mechanical validation after the retries. */
  "llm_invalid",
  /**
   * 400, a chapter, scene or npc write: `status` carries a value the column
   * does not accept.
   * The four status columns are CLOSED (decisions/constraints), so a value
   * outside the list can only be a typo. `{ kind, value, allowed }` —
   * `allowed` is the list in order, so the app can name the positions without knowing the kind.
   */
  "status_not_allowed",
  /**
   * 400, scene write: `type` carries a value outside `SCENE_TYPES`. Same rule
   * as `status_not_allowed`, its own code because it is its own field.
   * `{ value, allowed }`
   */
  "scene_type_not_allowed",
  /**
   * NOT SENT: the 400 for a session or pause timestamp written as a string
   * outside the one shape those columns hold. A moment is written as an epoch
   * value, which the server reads into that shape itself, so there is no
   * string from the wire to refuse. The string stays because codes are
   * APPEND-ONLY.
   */
  "timestamp_not_allowed",
  /**
   * 409, glossary-term create or write: the campaign's glossary already has
   * this term — a term stands in the glossary once. Nothing is written.
   * `{ term }`
   */
  "glossary_term_taken",
  /**
   * 409, a write that needs a running session — a log entry or a pause — on
   * one that is ended. Nothing is written. `{ id }`
   */
  "session_ended",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * The entity kinds a create error can name. Stable TOKENS, not labels: the
 * app turns them into the words of its UI language itself.
 */
export const ERROR_KINDS = ["campaign", "chapter", "scene", "npc", "location"] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

/** Which input field a `slug_empty` points at — the app names it. */
export const ERROR_FIELDS = ["name", "title"] as const;

export type ErrorField = (typeof ERROR_FIELDS)[number];
