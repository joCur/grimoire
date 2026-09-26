// The campaign tree (`GET /api/campaigns/:c/tree`): one answer that shows
// several entities at once — the chapters with their scenes in the DM's
// order, the npcs, the locations and the sessions — each in the short form
// the navigation needs. It lives here, at its endpoint, and names every
// entity by its own type.

import type { ChapterStatus } from "./chapter";
import type { NpcStatus } from "./npc";
import type { SceneStatus, SceneType } from "./scene";
import type { SessionSummary } from "./session";

/**
 * A scene in the campaign tree. No address: a scene is its own resource,
 * `…/scenes/:id` (decisions/resources).
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
 * `…/npcs/:id` (decisions/resources).
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
 * resource, `…/locations/:id` (decisions/resources).
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
