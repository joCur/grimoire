// The review's patch queue (issue #97 review, finding 1).
//
// Tested through `createReviewQueue`, the plain half of use-job-review.ts:
// the property that matters here is invisible to a rendering test: a flush
// that RESOLVES only when the patch has landed.

import { describe, expect, test } from "bun:test";

import type { ReviewPatch } from "@/lib/generate";
import {
  createReviewQueue,
  type ReviewQueueIo,
  type ReviewSaveStatus,
} from "@/lib/use-job-review";

interface Harness {
  io: ReviewQueueIo;
  sent: ReviewPatch[];
  statuses: ReviewSaveStatus[];
  /** What the optimistic copy currently shows, per edited path. */
  shown: Record<string, string>;
  rereads: number;
  /** The next send's outcome; `undefined` resolves. */
  fail?: unknown;
}

function harness(): Harness {
  const h: Harness = { io: null as never, sent: [], statuses: [], shown: {}, rereads: 0 };
  h.io = {
    optimistic: (patch) => {
      const before = { ...h.shown };
      Object.assign(h.shown, patch.edits ?? {});
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

const last = (statuses: ReviewSaveStatus[]): ReviewSaveStatus | undefined => statuses.at(-1);

describe("flush", () => {
  test("resolves only after the debounced edit has really landed", async () => {
    const h = harness();
    // A long debounce — an un-awaited flush would leave the edit in the
    // queue, which is exactly how „Übernehmen" lost it.
    const queue = createReviewQueue(h.io, 10_000);
    queue.edit("01-salzhafen/hafen/kai", "im Regen");
    expect(h.sent).toEqual([]);

    await queue.flush();
    expect(h.sent).toEqual([{ edits: { "01-salzhafen/hafen/kai": "im Regen" } }]);
    expect(last(h.statuses)).toBe("saved");
  });

  test("with nothing pending it still waits for what is in flight", async () => {
    const h = harness();
    const queue = createReviewQueue(h.io, 0);
    queue.decide({ entries: { "npcs/grella": "accepted" } });
    // Nothing of its own to send — but the decision above must be done.
    await queue.flush();
    expect(h.sent).toHaveLength(1);
  });

  test("everything pending goes in ONE patch, and requests are serialized", async () => {
    const h = harness();
    const queue = createReviewQueue(h.io, 10_000);
    queue.edit("a", "one");
    queue.edit("b", "two");
    queue.decide({ dropped: ["c"] });
    await queue.flush();
    expect(h.sent).toEqual([{ edits: { a: "one", b: "two" }, dropped: ["c"] }]);
  });
});
