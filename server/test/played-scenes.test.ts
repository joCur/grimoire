// The played scene resource: "next scene" is a POST under the session, each
// played scene with its own id and rev.
//
// The played scenes are a SEQUENCE in the order of play, and the scene is a
// reference. No played scene write moves the session's `rev`. Every case runs
// against its own in-memory database seeded from the committed fixtures.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlayedScene } from "@grimoire/shared/played-scene";
import type { Session } from "@grimoire/shared/session";
import { dropStore, seedStore } from "./support/store";
import { SESSIONS, endSession, readSession, send, startSession } from "./support/sessions";

let session: Session;

function playedUrl(sessionId = session.id): string {
  return `${SESSIONS}/${sessionId}/played-scenes`;
}

async function play(sceneId: string): Promise<PlayedScene> {
  const res = await send("POST", playedUrl(), { sceneId });
  expect(res.status).toBe(201);
  return (await res.json()) as PlayedScene;
}

beforeEach(async () => {
  await seedStore();
  session = await startSession();
});

afterEach(() => {
  dropStore();
});

describe("the next scene — POST …/sessions/:id/played-scenes", () => {
  test("one played scene at the end, with an id of its own, 201", async () => {
    const played = await play("lighthouse-arrival");
    expect(played).toEqual({ id: expect.any(String), sceneId: "lighthouse-arrival", rev: 1 });
    const read = await readSession(session.id);
    expect(read.playedScenes).toEqual([played]);
    expect(read.log).toEqual([]);
    expect(read.rev).toBe(session.rev);
  });

  test("the order of play; a scene returned to stands twice", async () => {
    await play("lighthouse-arrival");
    await play("smuggler-captured");
    await play("lighthouse-arrival");
    expect((await readSession(session.id)).playedScenes.map((p) => p.sceneId)).toEqual([
      "lighthouse-arrival",
      "smuggler-captured",
      "lighthouse-arrival",
    ]);
  });

  test("a scene that does not exist is 400 played_scene_unknown, and nothing is played", async () => {
    const res = await send("POST", playedUrl(), { sceneId: "gibt-es-nicht" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "played_scene_unknown", value: "gibt-es-nicht" });
    expect((await readSession(session.id)).playedScenes).toEqual([]);
  });

  test("400 without a scene, and for a key a played scene does not take", async () => {
    expect((await send("POST", playedUrl(), {})).status).toBe(400);
    const res = await send("POST", playedUrl(), { sceneId: "lighthouse-arrival", pos: 0 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("pos");
  });

  test("409 session_ended on an ended session, 404 on an unknown one", async () => {
    await endSession(session.id);
    const res = await send("POST", playedUrl(), { sceneId: "lighthouse-arrival" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "session_ended",
      id: session.id,
    });
    expect((await readSession(session.id)).playedScenes).toEqual([]);
    expect(
      (await send("POST", playedUrl("gibt-es-nicht"), { sceneId: "lighthouse-arrival" })).status,
    ).toBe(404);
  });
});
