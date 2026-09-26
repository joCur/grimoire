// Shared API types of Grimoire: the shapes that are no entity of their own —
// the campaign list, the campaign tree and search — plus the instance
// settings.
//
// An entity with its own resource (ADR #31) has its type from its zod schema
// in its own module — the campaign in ./campaign.ts, the chapter in
// ./chapter.ts, the scene in ./scene.ts, the npc in ./npc.ts and the
// location in ./location.ts, whose types are re-exported here, and the
// thread in ./thread.ts, the idea in ./idea.ts, the glossary term in
// ./glossary-term.ts, the knowledge item in ./knowledge-item.ts and the
// session with its pauses, log entries and played scenes in ./session.ts,
// ./pause.ts, ./log-entry.ts and ./played-scene.ts and the generator job in
// ./generator-job.ts, imported from there.

import type { ChapterStatus } from "./chapter";
import type { NpcStatus } from "./npc";
import type { SceneStatus, SceneType } from "./scene";
import type { SessionSummary } from "./session";

export type {
  Campaign,
  CampaignChange,
  CampaignCreate,
  CampaignPatch,
  CampaignSeed,
} from "./campaign";

export type {
  Chapter,
  ChapterChange,
  ChapterCreate,
  ChapterPatch,
  ChapterProposal,
  ChapterStatus,
} from "./chapter";

export type {
  Location,
  LocationChange,
  LocationFields,
  LocationPatch,
  LocationProposal,
} from "./location";

export type {
  Npc,
  NpcChange,
  NpcCreate,
  NpcFields,
  NpcPatch,
  NpcProposal,
  NpcReplyFields,
  NpcReplyObject,
  NpcStatus,
  QuickstatPair,
} from "./npc";

export type {
  Scene,
  SceneChange,
  SceneCreate,
  ScenePatch,
  SceneProposal,
  SceneReplyFields,
  SceneReplyObject,
  SceneStatus,
  SceneType,
} from "./scene";

/** The six callout kinds the renderer knows. Unknown kinds render as plain text. */
export const CALLOUT_KINDS = [
  "readaloud",
  "check",
  "secret",
  "outcome",
  "loot",
  "note",
] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/**
 * The entities a search hit can name, by `kind` and `id` (see SearchResult).
 */
export type EntityKind =
  | "campaign"
  | "chapter"
  | "scene"
  | "npc"
  | "location"
  | "session"
  | "glossary-term";

// --- API response shapes (see endpoint list in server/src/server.ts) -------

export interface CampaignSummary {
  /** The campaign's id — the key in every URL. */
  id: string;
  /**
   * Id of the campaign's newest session (the `<id>` of `sessions/<id>`).
   * OPAQUE: an address, not a
   * date, and NOT comparable — order by `lastSessionStarted` instead. Absent
   * when the campaign has no session.
   */
  lastSession?: string;
  /**
   * `started` of that newest session — the zone-less wall-clock string the
   * session carries (`yyyy-mm-ddTHH:MM:SS`). This is what "last active"
   * means, and the only orderable thing about a session the client
   * gets. Absent when the campaign has no session, or when that session has no
   * usable `started` — either way it then sorts behind every campaign that
   * has one.
   */
  lastSessionStarted?: string;
  /**
   * Display name. Always present: a campaign without an authored name is
   * shown under its id, exactly as `GET /api/campaigns/:c` answers its `name`
   * — the two endpoints must agree. Optional in the type so an older payload
   * still parses.
   */
  name?: string;
  /**
   * One-line description of the campaign; absent when there is none (unlike
   * `name` there is nothing sensible to synthesize).
   */
  description?: string;
}

/**
 * A scene in the campaign tree. No address: a scene is its own resource,
 * `…/scenes/:id` (ADR #31).
 */
export interface SceneSummary {
  id: string;
  title: string;
  type: SceneType;
  status: SceneStatus;
  /** Free-text firing condition — only meaningful for `type: contingency`. */
  trigger?: string;
  /** The location id the scene names; absent when it sits at chapter level. */
  location?: string;
  /**
   * The location's display NAME, degraded to the id when nobody has named
   * it yet (a location created and left empty). Absent exactly when
   * `location` is.
   *
   * Resolved by the SERVER because only the server has the location rows at
   * hand while it builds the tree: a scene's meta line shows the name of its
   * location, not the slug behind it.
   */
  locationName?: string;
  npcs: string[];
  tags: string[];
}

export interface ChapterNode {
  /** The chapter's id, e.g. "01-salzhafen". */
  id: string;
  /** The chapter's title; falls back to its id. */
  title: string;
  status?: ChapterStatus;
  /**
   * Guard token of the scene ORDER below — what
   * `PUT /chapters/:chapter/scene-order` sends back and 409s on. Its own
   * counter, NOT the chapter's `rev`: reordering and editing the chapter are
   * separate writes and must not invalidate each other.
   * Optional in the type so an older payload still parses.
   */
  sceneOrderRev?: number;
  /**
   * The chapter's scenes in the order the DM arranged them — `pos` ascending
   * with the id as the tie-break. A FLAT list: the scenes of a chapter are
   * ordered, not grouped, and the location a scene names is a property it
   * shows (`locationName`) rather than a heading it hangs under.
   */
  scenes: SceneSummary[];
}

/**
 * An npc in the campaign tree. No address: an npc is its own resource,
 * `…/npcs/:id` (ADR #31).
 */
export interface NpcSummary {
  id: string;
  name: string;
  role?: string;
  status: NpcStatus;
  chapter?: string;
}

/**
 * A location in the campaign tree. No address: a location is its own
 * resource, `…/locations/:id` (ADR #31).
 */
export interface LocationSummary {
  id: string;
  name: string;
  chapter?: string;
}

/** GET /api/:campaign/tree */
export interface CampaignTree {
  campaign: string;
  chapters: ChapterNode[];
  npcs: NpcSummary[];
  locations: LocationSummary[];
  sessions: SessionSummary[];
}

/**
 * PUT /api/campaigns/:campaign/chapters/:chapter/scene-order — the chapter's
 * scenes in their new order, and the chapter's fresh guard token.
 *
 * `rev` is `chapters.scene_order_rev` — the ORDER's own guard token, which
 * the tree hands out as `ChapterNode.sceneOrderRev`. Not the chapter's `rev`
 * and not a scene's: reordering changes neither, so it must not invalidate an
 * editor open on one. `scenes` is the complete list of the
 * chapter's scene ids — a request naming anything else is refused whole
 * (`scene_order_mismatch`).
 */
export interface SceneOrderResponse {
  scenes: string[];
  rev: number;
}

/**
 * One row of GET /api/:campaign/search (the response wraps them as
 * `{ results: SearchResult[] }`, see SearchResponse). Indexed are the
 * campaign, the chapters, the scenes, the npcs, the locations and the
 * glossary terms — see server/src/store/fts.ts. The search is truly mixed, so
 * a hit names its entity by `kind` and `id`, and the app opens the resource
 * of that entity — or, for a glossary term, the glossary page, where the
 * terms are kept (ADR #31).
 */
export interface SearchResult {
  kind: EntityKind;
  id: string;
  title: string;
  /** Fuse.js score: 0 is a perfect match, values grow toward 1. */
  score: number;
  /** ~120 chars of body context around the first literal query hit. */
  snippet?: string;
}

/** GET /api/:campaign/search?q=… (400 on missing/empty q) */
export interface SearchResponse {
  results: SearchResult[];
}

// --- instance settings ------------------------------------------------------

/**
 * The UI languages the app ships. The list lives HERE, not in the app, because
 * the server validates `PUT /api/settings` against it — the language is an
 * INSTANCE setting, not a browser preference (quality floor: no localStorage
 * for data, the server is the truth).
 */
export const UI_LOCALES = ["de", "en"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

/**
 * GET/PUT /api/settings — the whole instance settings object (Grimoire is a
 * single-user tool, so there is exactly one of it).
 *
 * `locale: null` means NOT DECIDED YET: the app then follows
 * `navigator.language` and writes nothing. Only an explicit switch in the UI
 * stores a value, which is what makes the choice survive a reload and reach
 * the next browser.
 */
export interface InstanceSettings {
  locale: UiLocale | null;
}
