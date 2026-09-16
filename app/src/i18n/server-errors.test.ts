// The server-error catalog's half of the code contract.
//
// The typecheck guarantees that every code HAS a key (`Record<ErrorCode, …>`);
// what it cannot check is that the sentence a body actually produces names the
// value, offers the slug when there is one, and degrades to the server's
// English text when the body says nothing a catalog can improve on.

import { describe, expect, test } from "bun:test";

import { ApiError } from "@/api";

import { translator } from "./format";
import { serverErrorBodyMessage, serverErrorMessage } from "./server-errors";

const de = translator("de");
const en = translator("en");

describe("a reference written as a name", () => {
  // The two npc-reference refusals and the location one are the same rule in
  // three places, and each names a different place to fix.
  const WITH_SUGGESTION = [
    {
      code: "location_not_an_id",
      value: "Der alte Hafen",
      suggestion: "der-alte-hafen",
      deContains: "Ort",
      enContains: "Location",
    },
    {
      code: "npc_ref_not_an_id",
      value: "Alte Fischerin",
      suggestion: "alte-fischerin",
      deContains: "NPC-Liste",
      enContains: "npc list",
    },
    {
      code: "relation_ref_not_an_id",
      value: "Alte Freundin aus Waterdeep",
      suggestion: "alte-freundin-aus-waterdeep",
      deContains: "Beziehungen",
      enContains: "relation",
    },
  ] as const;

  for (const body of WITH_SUGGESTION) {
    test(`${body.code} names the value and the slug, in both languages`, () => {
      for (const [t, expected] of [
        [de, body.deContains],
        [en, body.enContains],
      ] as const) {
        const message = serverErrorBodyMessage({ ...body, error: "english fallback" }, t);
        expect(message).toContain(body.value);
        expect(message).toContain(body.suggestion);
        // The sentence says WHERE to fix it, which is the whole reason the
        // three codes are three and not one.
        expect(message).toContain(expected);
        // The English fallback is for a code the app does not know.
        expect(message).not.toContain("english fallback");
      }
    });

    test(`${body.code} without a usable slug proposes nothing`, () => {
      const { suggestion, ...withoutSuggestion } = body;
      for (const t of [de, en]) {
        const message = serverErrorBodyMessage(withoutSuggestion, t);
        expect(message).toContain(body.value);
        // A placeholder with no value used to render as the literal text.
        expect(message).not.toContain("{");
        expect(message).not.toContain(suggestion);
      }
    });
  }

  test("a body without the value it promised degrades to the server's text", () => {
    const message = serverErrorBodyMessage(
      { code: "npc_ref_not_an_id", error: "npcs holds npc ids, not names" },
      de,
    );
    expect(message).toBe("npcs holds npc ids, not names");
  });

  test("an ApiError from the refusal reaches a view as the German sentence", () => {
    const error = new ApiError(400, "npcs holds npc ids, not names", {
      code: "relation_ref_not_an_id",
      value: "Alte Freundin",
      suggestion: "alte-freundin",
    });
    const message = serverErrorMessage(error, de, "create.failed");
    expect(message).toContain("Beziehungen");
    expect(message).toContain("alte-freundin");
  });
});
