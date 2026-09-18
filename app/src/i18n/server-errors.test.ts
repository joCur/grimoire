// The app's half of the error-code contract: a wire body becomes ONE sentence
// in the UI language, and an unknown code degrades to the server's English
// text instead of to a blank toast.
//
// The five REFERENCE refusals are the reason this file exists: each of them
// names the value that resolves to nothing, and the sentence has to tell the
// DM what to do about it — create the entry first. A code whose sentence
// silently fell back to the English `error` text would make that advice
// invisible in the German UI.

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
  const cases: Array<[string, string, string]> = [
    ["location_unknown", "der-alte-hafen", "Den Ort „der-alte-hafen“ gibt es nicht"],
    ["npc_unknown", "holm", "Den NPC „holm“ gibt es nicht"],
    ["chapter_unknown", "99-nirgendwo", "Das Kapitel „99-nirgendwo“ gibt es nicht"],
    ["log_scene_unknown", "gibt-es-nicht", "Die Szene „gibt-es-nicht“ gibt es nicht"],
    ["played_scene_unknown", "gibt-es-nicht", "Die gespielte Szene „gibt-es-nicht“"],
  ];

  test("each one names its value and says to create the entry first", () => {
    for (const [code, value, expected] of cases) {
      const sentence = de(`server.${code}` as never, { value });
      expect(sentence).toContain(expected);
      expect(sentence).toContain("anlegen");
      // …and that is what the wire body renders to.
      expect(serverErrorBodyMessage(body(code, { value }), de)).toBe(sentence);
    }
  });

  test("English says the same thing", () => {
    for (const [code, value] of cases) {
      const sentence = serverErrorBodyMessage(body(code, { value }), en);
      expect(sentence).toContain(value);
      expect(sentence?.toLowerCase()).toContain("does not exist");
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
    // The refusal a cleared Kapitel field answers with. Nothing to name —
    // the value is gone, which is the whole message.
    const german = serverErrorBodyMessage(body("chapter_required"), de);
    expect(german).toContain("Kapitel");
    expect(german).toContain("nicht entfernen");
    expect(serverErrorBodyMessage(body("chapter_required"), en)).toContain("needs a chapter");
  });
});

describe("the location value that is no id", () => {
  test("with a slug to propose, the sentence carries it — and says to create it", () => {
    const sentence = serverErrorBodyMessage(
      body("location_not_an_id", { value: "Der alte Hafen", suggestion: "der-alte-hafen" }),
      de,
    );
    expect(sentence).toContain("Der alte Hafen");
    expect(sentence).toContain("der-alte-hafen");
    expect(sentence).toContain("anlegen");
  });

  test("without one it says what to type instead, and proposes nothing", () => {
    const sentence = serverErrorBodyMessage(body("location_not_an_id", { value: "???" }), de);
    expect(sentence).toContain("???");
    expect(sentence).toContain("Kleinbuchstaben");
    expect(sentence).not.toContain("{suggestion}");
  });
});

describe("the two refusals of the entry write", () => {
  test("a request with neither field says so in one short sentence", () => {
    // No parameters: there is no field to name, which is the message.
    expect(serverErrorBodyMessage(body("nothing_to_write"), de)).toBe("Nichts zu speichern.");
    expect(serverErrorBodyMessage(body("nothing_to_write"), en)).toBe("Nothing to save.");
  });

  test("text sent to a list entry says why, not just that it failed", () => {
    const german = serverErrorBodyMessage(body("body_not_editable", { path: "glossary" }), de);
    expect(german).toContain("keinen bearbeitbaren Text");
    expect(german).toContain("Liste");
    const english = serverErrorBodyMessage(body("body_not_editable", { path: "glossary" }), en);
    expect(english).toContain("no editable text");
    expect(english).toContain("list");
  });
});

describe("the closed columns", () => {
  const status = body("status_not_allowed", {
    kind: "scene",
    value: "halbfertig",
    allowed: ["draft", "ready", "played", "dropped"],
  });
  const sceneType = body("scene_type_not_allowed", {
    value: "optional",
    allowed: ["planned", "contingency"],
  });

  test("the refused value and the positions the column accepts, enumerated", () => {
    const german = serverErrorBodyMessage(status, de);
    expect(german).toContain("halbfertig");
    expect(german).toContain("draft, ready, played, dropped");
    const english = serverErrorBodyMessage(status, en);
    expect(english).toContain("halbfertig");
    expect(english).toContain("draft, ready, played, dropped");
  });

  test("the scene type has its own sentence", () => {
    const german = serverErrorBodyMessage(sceneType, de);
    expect(german).toContain("Szenentyp");
    expect(german).toContain("optional");
    expect(german).toContain("planned, contingency");
    expect(serverErrorBodyMessage(sceneType, en)).toContain("scene type");
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
    expect(serverErrorBodyMessage({ code: "aus_der_zukunft", error: "something new" }, de)).toBe(
      "something new",
    );
    expect(serverErrorBodyMessage({}, de)).toBeUndefined();
    expect(serverErrorBodyMessage(undefined, de)).toBeUndefined();
  });
});
