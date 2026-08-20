import { afterEach, describe, expect, test } from "bun:test";

import { ApiError } from "@/api";
import { ensureNpcStub } from "./npc-stub";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answerWith(status: number, body: unknown): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch;
}

describe("ensureNpcStub", () => {
  test("returns the written file on success", async () => {
    answerWith(200, { path: "npcs/holm.md", kind: "npc", frontmatter: {}, body: "", mtimeMs: 1 });
    const file = await ensureNpcStub("beispiel", "holm");
    expect(file?.path).toBe("npcs/holm.md");
  });

  test("409 means the file exists now — the goal state, not an error", async () => {
    answerWith(409, { error: "npcs/holm.md exists" });
    expect(await ensureNpcStub("beispiel", "holm")).toBeUndefined();
  });

  test("every other failure throws (the card shows the error line)", async () => {
    answerWith(500, { error: "boom" });
    const failure = ensureNpcStub("beispiel", "holm");
    await expect(failure).rejects.toBeInstanceOf(ApiError);
  });
});
