// The app's half of the error-code contract: a wire body becomes ONE sentence
// in the UI language, and an unknown code degrades to the server's English
// text instead of to a blank toast.
//
// The five REFERENCE refusals are the reason this file exists: each of them
// names the value that resolves to nothing, and its catalog sentence tells the
// DM what to do about it. A code whose sentence silently fell back to the
// English `error` text would make that advice invisible in the German UI.

import { describe, expect, test } from "bun:test";

import { ERROR_CODES } from "@grimoire/shared";

import { translator } from "@/i18n/format";
import { serverErrorBodyMessage } from "@/i18n/server-errors";

const de = translator("de");
const en = translator("en");

/** A body as the server sends it: the code, its parameters, the fallback. */
function body(code: string, extra: Record<string, unknown> = {}) {
  return { code, error: `technical: ${code}`, ...extra };
}

describe("the reference refusals", () => {
  // Each of them names the value that resolves to nothing.
  const cases: Array<[string, string]> = [
    ["location_unknown", "the-old-harbour"],
    ["npc_unknown", "holm"],
    ["chapter_unknown", "99-nowhere"],
    ["log_scene_unknown", "does-not-exist"],
    ["played_scene_unknown", "does-not-exist"],
  ];

  test("each one renders its own sentence with its value, in both languages", () => {
    for (const [code, value] of cases) {
      for (const t of [de, en]) {
        const sentence = serverErrorBodyMessage(body(code, { value }), t);
        expect(sentence).toBe(t(`server.${code}` as never, { value }));
        expect(sentence).toContain(value);
        expect(sentence).not.toBe(`technical: ${code}`);
      }
    }
  });

  test("the German sentence is not the English one", () => {
    for (const [code, value] of cases) {
      expect(serverErrorBodyMessage(body(code, { value }), de)).not.toBe(
        serverErrorBodyMessage(body(code, { value }), en),
      );
    }
  });

  test("a body without its value degrades to the server's own text", () => {
    for (const [code] of cases) {
      expect(serverErrorBodyMessage(body(code), de)).toBe(`technical: ${code}`);
    }
  });
});

describe("the chapter a scene may not lose", () => {
  test("it reads as a rule, in both languages, and carries no parameter", () => {
    // The refusal a cleared chapter field answers with. Nothing to name —
    // the value is gone, which is the whole message.
    for (const t of [de, en]) {
      expect(serverErrorBodyMessage(body("chapter_required"), t)).toBe(
        t("server.chapter_required"),
      );
    }
  });
});

describe("the location value that is no id", () => {
  test("with a slug to propose, the sentence carries it", () => {
    const params = { value: "The old harbour", suggestion: "the-old-harbour" };
    const sentence = serverErrorBodyMessage(body("location_not_an_id", params), de);
    expect(sentence).toBe(de("server.location_not_an_id", params));
    expect(sentence).toContain("The old harbour");
    expect(sentence).toContain("the-old-harbour");
  });

  test("without one it takes the sentence that proposes nothing", () => {
    const sentence = serverErrorBodyMessage(body("location_not_an_id", { value: "???" }), de);
    expect(sentence).toBe(de("server.location_not_an_id.noSuggestion", { value: "???" }));
    expect(sentence).toContain("???");
    expect(sentence).not.toContain("{suggestion}");
  });
});

describe("the two refusals of the entry write", () => {
  test("a request with neither field has its own sentence without parameters", () => {
    // No parameters: there is no field to name, which is the message.
    for (const t of [de, en]) {
      expect(serverErrorBodyMessage(body("nothing_to_write"), t)).toBe(
        t("server.nothing_to_write"),
      );
    }
  });

  test("text sent to a list entry gets its own sentence, not the generic one", () => {
    for (const t of [de, en]) {
      const sentence = serverErrorBodyMessage(body("body_not_editable", { path: "glossary" }), t);
      expect(sentence).toBe(t("server.body_not_editable"));
      expect(sentence).not.toBe("technical: body_not_editable");
    }
  });
});

describe("the closed columns", () => {
  const status = body("status_not_allowed", {
    kind: "scene",
    value: "half-done",
    allowed: ["draft", "ready", "played", "dropped"],
  });
  const sceneType = body("scene_type_not_allowed", {
    value: "optional",
    allowed: ["planned", "contingency"],
  });

  test("the refused value and the positions the column accepts, enumerated", () => {
    for (const t of [de, en]) {
      const sentence = serverErrorBodyMessage(status, t);
      expect(sentence).toBe(
        t("server.status_not_allowed", {
          value: "half-done",
          allowed: "draft, ready, played, dropped",
        }),
      );
      expect(sentence).toContain("half-done");
      expect(sentence).toContain("draft, ready, played, dropped");
    }
  });

  test("the scene type has its own sentence", () => {
    for (const t of [de, en]) {
      const sentence = serverErrorBodyMessage(sceneType, t);
      expect(sentence).toBe(
        t("server.scene_type_not_allowed", { value: "optional", allowed: "planned, contingency" }),
      );
      expect(sentence).toContain("optional");
      expect(sentence).toContain("planned, contingency");
      expect(sentence).not.toBe(serverErrorBodyMessage(status, t));
    }
  });

  test("a body without value or list degrades to the server's own text", () => {
    for (const code of ["status_not_allowed", "scene_type_not_allowed"]) {
      expect(serverErrorBodyMessage(body(code, { allowed: ["draft"] }), de)).toBe(
        `technical: ${code}`,
      );
      expect(serverErrorBodyMessage(body(code, { value: "x" }), de)).toBe(`technical: ${code}`);
      expect(serverErrorBodyMessage(body(code, { value: "x", allowed: [] }), de)).toBe(
        `technical: ${code}`,
      );
    }
  });
});

describe("the degrade rule", () => {
  test("every code the server may send has a sentence in both languages", () => {
    for (const code of ERROR_CODES) {
      for (const t of [de, en]) {
        const sentence = t(`server.${code}` as never, {
          value: "x",
          id: "x",
          suggestion: "y",
          kind: "NPC",
          field: "Name",
          term: "x",
          max: "1",
          allowed: "a, b",
        });
        expect(sentence.trim()).not.toBe("");
        expect(sentence).not.toContain("{");
      }
    }
  });

  test("an unknown code falls back to the English text, never to nothing", () => {
    expect(serverErrorBodyMessage({ code: "from_the_future", error: "something new" }, de)).toBe(
      "something new",
    );
    expect(serverErrorBodyMessage({}, de)).toBeUndefined();
    expect(serverErrorBodyMessage(undefined, de)).toBeUndefined();
  });
});
