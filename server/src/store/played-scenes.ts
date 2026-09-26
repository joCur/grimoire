// Played scenes: the played scene resource.
//
// A played scene is its own resource with its own type (ADR #31,
// @grimoire/shared/played-scene), hanging under its session: one step of the
// evening through the scenes, written here when the session reaches the next
// scene. The played scenes are a SEQUENCE in the order of play — a scene the
// group returns to later stands in it twice.

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  playedSceneCreateSchema,
  type PlayedScene,
  type PlayedSceneCreate,
  type PlayedSceneSeed,
} from "@grimoire/shared/played-scene";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { playedScenes } from "../db/schema";
import { mutate } from "./campaigns";
import { assertSceneRef } from "./scenes";
import { requireRunningSessionRow } from "./session-rows";
import { nextPos, parseRequest } from "./shared";

/** One stored played scene row. */
type PlayedSceneRow = typeof playedScenes.$inferSelect;

// --- rendering and reading ----------------------------------------------------

function renderPlayedScene(row: PlayedSceneRow): PlayedScene {
  return { id: row.id, sceneId: row.sceneId, rev: row.rev };
}

function playedSceneRowsOf(db: GrimoireDb, campaign: string, sessionId: string): PlayedSceneRow[] {
  return db
    .select()
    .from(playedScenes)
    .where(and(eq(playedScenes.campaignId, campaign), eq(playedScenes.sessionId, sessionId)))
    .orderBy(asc(playedScenes.pos), asc(playedScenes.id))
    .all();
}

/** The played scenes of a session in the order of play — what the session embeds. */
export function sessionPlayedScenes(
  db: GrimoireDb,
  campaign: string,
  sessionId: string,
): PlayedScene[] {
  return playedSceneRowsOf(db, campaign, sessionId).map(renderPlayedScene);
}

// --- writing ------------------------------------------------------------------

/** The body of a played scene POST, checked against its create form. */
export function readPlayedSceneCreate(raw: unknown): PlayedSceneCreate {
  return parseRequest(playedSceneCreateSchema, raw, "played scene");
}

/**
 * POST /api/campaigns/:campaign/sessions/:session/played-scenes `{ sceneId }`
 * — the session reaches its next scene: one played scene at the end of the
 * sequence, with an id the server hands out. The session has to run (404 for
 * an unknown one, 409 `session_ended` for an ended one), and the scene has to
 * exist (400 `played_scene_unknown`).
 */
export async function createPlayedScene(
  campaign: string,
  sessionId: string,
  request: PlayedSceneCreate,
): Promise<PlayedScene> {
  return mutate(campaign, (tx) => {
    requireRunningSessionRow(tx, campaign, sessionId);
    assertSceneRef(tx, campaign, request.sceneId, "played_scene_unknown");
    const id = randomUUID();
    tx.insert(playedScenes)
      .values({
        campaignId: campaign,
        sessionId,
        id,
        sceneId: request.sceneId,
        pos: nextPos(playedSceneRowsOf(tx, campaign, sessionId)),
      })
      .run();
    const row = playedSceneRowsOf(tx, campaign, sessionId).find((r) => r.id === id);
    if (row === undefined) throw new ApiError(500, "played scene could not be created");
    return renderPlayedScene(row);
  });
}

// --- the seed -----------------------------------------------------------------

/**
 * Write one played scene of a session fixture, after the ones before it,
 * INSIDE the caller's transaction. Its scene is a foreign key, so a fixture
 * naming a scene the campaign does not have is refused by the database.
 */
export function insertPlayedSceneSeed(
  tx: GrimoireDb,
  campaign: string,
  sessionId: string,
  seed: PlayedSceneSeed,
): void {
  tx.insert(playedScenes)
    .values({
      campaignId: campaign,
      sessionId,
      id: seed.id,
      sceneId: seed.sceneId,
      pos: nextPos(playedSceneRowsOf(tx, campaign, sessionId)),
    })
    .run();
}
