import type { SceneChat } from "@grimoire/shared/scene-chat";
import { describe, expect, test } from "bun:test";

import { SCENE_CHAT_POLL_MS, sceneChatQuery } from "./scene-chat-query";

function chat(status: "done" | "running" | "failed"): SceneChat {
  return {
    id: "c1",
    scene: "s1",
    messages: [
      { id: "m1", role: "dm", text: "Q", status: "done", rev: 1 },
      { id: "m2", role: "model", text: "", status, rev: 1 },
    ],
    rev: 1,
  };
}

describe("the scene chat's poll", () => {
  const { refetchInterval, refetchIntervalInBackground } = sceneChatQuery("example", "s1");
  const interval = (data: SceneChat | null | undefined) => refetchInterval({ state: { data } });

  test("polls while a reply runs, also in a hidden tab", () => {
    expect(interval(chat("running"))).toBe(SCENE_CHAT_POLL_MS);
    expect(refetchIntervalInBackground).toBe(true);
  });

  test("polls nothing once every reply stands, or without a chat", () => {
    expect(interval(chat("done"))).toBe(false);
    expect(interval(chat("failed"))).toBe(false);
    expect(interval(null)).toBe(false);
    expect(interval(undefined)).toBe(false);
  });
});
