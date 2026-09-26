// The review's patch queue.
//
// Tested through `createReviewQueue`, the plain half of use-job-review.ts:
// the two properties that matter here are invisible to a rendering test —
// a flush that RESOLVES only when the patch has landed, and a failed patch
// that goes back into the queue instead of evaporating.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import type { SceneChange } from "@grimoire/shared/scene";
import type { ReviewSaveState } from "@/components/ReviewSaveStatus";

import type { ReviewPatch } from "./generator-job-state";
import {
  createReviewQueue,
  type ReviewQueueIo,
} from "./use-job-review";

interface Harness {
  io: ReviewQueueIo;
  sent: ReviewPatch[];
  statuses: ReviewSaveState[];
  /** What the optimistic copy currently shows, per edited scene. */
  shown: Record<string, SceneChange>;
  rereads: number;
  /** The next send's outcome; `undefined` resolves. */
  fail?: unknown;
}

function harness(): Harness {
  const h: Harness = { io: null as never, sent: [], statuses: [], shown: {}, rereads: 0 };
  h.io = {
    optimistic: (patch) => {
      const before = { ...h.shown };
      Object.assign(h.shown, patch.sceneEdits ?? {});
      return () => {
        h.shown = before;
      };
    },
    send: async (patch) => {
      await Promise.resolve();
      const failure = h.fail;
      h.fail = undefined;
      if (failure !== undefined) throw failure;
      h.sent.push(patch);
    },
    reread: () => {
      h.rereads += 1;
    },
    status: (status) => h.statuses.push(status),
  };
  return h;
}

const last = (statuses: ReviewSaveState[]): ReviewSaveState | undefined => statuses.at(-1);

describe("flush", () => {
  test("resolves only after the debounced edit has really landed", async () => {
    const h = harness();
    // A long debounce — an un-awaited flush would leave the edit in the
    // queue, which is exactly how the accept lost it.
    const queue = createReviewQueue(h.io, 10_000);
    queue.editScene("quay", { body: "in the rain" });
    expect(h.sent).toEqual([]);

    await queue.flush();
    expect(h.sent).toEqual([{ sceneEdits: { quay: { body: "in the rain" } } }]);
    expect(last(h.statuses)).toBe("saved");
  });

  test("with nothing pending it still waits for what is in flight", async () => {
    const h = harness();
    const queue = createReviewQueue(h.io, 0);
    queue.decide({ npcs: { grella: "accepted" } });
    // Nothing of its own to send — but the decision above must be done.
    await queue.flush();
    expect(h.sent).toHaveLength(1);
  });

  test("everything pending goes in ONE patch, and requests are serialized", async () => {
    const h = harness();
    const queue = createReviewQueue(h.io, 10_000);
    queue.editScene("a", { body: "one" });
    queue.editScene("b", { body: "two" });
    queue.decide({ droppedScenes: ["c"] });
    await queue.flush();
    expect(h.sent).toEqual([
      {
        sceneEdits: { a: { body: "one" }, b: { body: "two" } },
        review: { droppedScenes: ["c"] },
      },
    ]);
  });
});

describe("a proposed scene and npc", () => {
  test("a scene's changes merge field by field into one patch", async () => {
    const h = harness();
    const queue = createReviewQueue(h.io, 10_000);
    queue.editScene("quay", { title: "At the Quay", location: "lighthouse" });
    queue.editScene("quay", { body: "New.\n", location: null });
    await queue.flush();
    expect(h.sent).toEqual([
      { sceneEdits: { quay: { title: "At the Quay", location: null, body: "New.\n" } } },
    ]);
  });

  test("an npc's changes merge field by field into one patch", async () => {
    const h = harness();
    const queue = createReviewQueue(h.io, 10_000);
    queue.editNpc("grella", { role: "Fisherwoman", voice: "hoarse" });
    queue.editNpc("grella", { body: "New.\n", voice: null });
    await queue.flush();
    expect(h.sent).toEqual([
      { npcEdits: { grella: { role: "Fisherwoman", voice: null, body: "New.\n" } } },
    ]);
  });
});

describe("a failed patch", () => {
  test("is retried on the next flush and rolls the optimistic copy back", async () => {
    const h = harness();
    const queue = createReviewQueue(h.io, 10_000);
    h.fail = new Error("network");

    queue.editScene("quay", { body: "in the rain" });
    await queue.flush();
    expect(h.sent).toEqual([]);
    expect(last(h.statuses)).toBe("error");
    // Rolled back: the cache does not claim something the server refused.
    expect(h.shown).toEqual({});

    // The next flush retries it — nothing was lost.
    await queue.flush();
    expect(h.sent).toEqual([{ sceneEdits: { quay: { body: "in the rain" } } }]);
    expect(h.shown).toEqual({ quay: { body: "in the rain" } });
    expect(last(h.statuses)).toBe("saved");
  });

  test("keeps the error line while a retry is still queued", async () => {
    const h = harness();
    const queue = createReviewQueue(h.io, 10_000);
    h.fail = new Error("network");
    queue.editScene("quay", { body: "in the rain" });
    await queue.flush();
    expect(last(h.statuses)).toBe("error");

    // A LATER decision succeeds — but the failed edit is still waiting, so
    // reporting the review as saved would be a lie about it as a whole.
    queue.decide({ npcs: { grella: "accepted" } });
    await queue.flush();
    expect(last(h.statuses)).toBe("saved");
    // …and the retried edit went along with it.
    expect(h.sent).toEqual([
      { sceneEdits: { quay: { body: "in the rain" } }, review: { npcs: { grella: "accepted" } } },
    ]);
  });

  test("a 409 is a conflict instead: re-read, and nothing is retried blindly", async () => {
    const h = harness();
    const queue = createReviewQueue(h.io, 10_000);
    h.fail = new ApiError(409, "conflict", { code: "rev_conflict", rev: 7 });
    queue.decide({ npcs: { grella: "accepted" } });
    await queue.flush();
    expect(last(h.statuses)).toBe("conflict");
    expect(h.rereads).toBe(1);
    expect(h.sent).toEqual([]);
  });
});
