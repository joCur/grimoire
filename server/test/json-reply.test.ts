// The tolerant JSON reader every generator reply shares (src/json-reply.ts):
// the whole text, a fence, the brace spans — and ONE `jsonrepair` pass before
// a correction turn is spent. What each entity makes of the value is its own
// reader's business (scene-reply.test.ts, npc-reply.test.ts,
// location-reply.test.ts).

import { describe, expect, test } from "bun:test";
import { parseJsonReply } from "../src/json-reply";

describe("parseJsonReply", () => {
  test("the whole text wins, then a fence, then the brace span", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ value: { a: 1 }, repaired: false });
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ value: { a: 1 }, repaired: false });
    expect(parseJsonReply('Also: {"a":1} — fertig.')).toEqual({
      value: { a: 1 },
      repaired: false,
    });
  });

  test("trailing prose with a brace in it does not break the span", () => {
    // The span used to run from the first `{` to the LAST `}` — one sentence
    // mentioning a brace and every stage failed on a reply that is perfectly
    // readable a few characters earlier. So: the last closing brace first,
    // then progressively earlier ones.
    expect(parseJsonReply('{"a":1}\n\nFertig — wie `{ "a": 1 }` oben beschrieben.')).toEqual({
      value: { a: 1 },
      repaired: false,
    });
    // …and the repair pass walks the same spans.
    expect(parseJsonReply("{'a': 1,}\n\nSo weit, siehe }.")).toEqual({
      value: { a: 1 },
      repaired: true,
    });
    // A nested object still wins as a whole, not as its innermost brace.
    expect(parseJsonReply('{"a":{"b":2}} — fertig }')).toEqual({
      value: { a: { b: 2 } },
      repaired: false,
    });
  });

  test("an almost-object is repaired once; prose is not", () => {
    expect(parseJsonReply("{'a': 1,}")).toEqual({ value: { a: 1 }, repaired: true });
    // A sentence would become a JSON string, and the run would then fail with
    // a message about the wrong thing.
    expect(parseJsonReply("kein Objekt")).toBeNull();
    expect(parseJsonReply("")).toBeNull();
  });
});
