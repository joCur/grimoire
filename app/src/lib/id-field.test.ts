// Who owns the id on a create surface. Two states, and every way in and out
// of the manual one — the part of the pencil that is not rendering.
//
// The point of these assertions is the pair of promises the create dialog
// makes: until the DM touches the id it follows the name, and once they have
// touched it the name never overwrites what they typed.

import { describe, expect, test } from "bun:test";

import {
  ID_FIELD_START,
  followsName,
  idAllowed,
  resolvedId,
  submittedId,
  takeIdSuggestion,
  toggleIdField,
  typeIdField,
} from "@/lib/id-field";

describe("a fresh surface", () => {
  test("follows the name, with nothing opened and nothing to send", () => {
    expect(ID_FIELD_START.editing).toBe(false);
    expect(followsName(ID_FIELD_START)).toBe(true);
    expect(resolvedId(ID_FIELD_START, "Alte Fischerin")).toBe("alte-fischerin");
    expect(resolvedId(ID_FIELD_START, "Küste von Salzhafen")).toBe("kueste-von-salzhafen");
    // A derived id is not sent — the server derives the same one.
    expect(submittedId(ID_FIELD_START)).toBeUndefined();
  });

  test("has no id at all while the name yields none", () => {
    expect(resolvedId(ID_FIELD_START, "")).toBe("");
    expect(resolvedId(ID_FIELD_START, "!!!")).toBe("");
  });
});

describe("the pencil", () => {
  test("opens the field without changing whose id it is", () => {
    const open = toggleIdField(ID_FIELD_START);
    expect(open.editing).toBe(true);
    expect(followsName(open)).toBe(true);
    // Prefilled with the derivation, which is what was on screen.
    expect(resolvedId(open, "Alte Fischerin")).toBe("alte-fischerin");
  });

  test("pressing it again closes the field AND hands the id back to the name", () => {
    const typed = typeIdField(toggleIdField(ID_FIELD_START), "fischerin");
    const closed = toggleIdField(typed);
    expect(closed.editing).toBe(false);
    expect(followsName(closed)).toBe(true);
    expect(resolvedId(closed, "Alte Fischerin")).toBe("alte-fischerin");
  });
});

describe("typing an id", () => {
  const open = toggleIdField(ID_FIELD_START);

  test("stops the name from feeding it", () => {
    const typed = typeIdField(open, "die-fischerin");
    expect(followsName(typed)).toBe(false);
    expect(resolvedId(typed, "Alte Fischerin")).toBe("die-fischerin");
    // …and a later name change leaves it alone.
    expect(resolvedId(typed, "Ganz anderer Name")).toBe("die-fischerin");
    // A typed id IS sent, so the server does not derive its own.
    expect(submittedId(typed)).toBe("die-fischerin");
  });

  test("takes the text verbatim, including text the rule rejects", () => {
    const typed = typeIdField(open, "Alte Fischerin!");
    expect(resolvedId(typed, "egal")).toBe("Alte Fischerin!");
    expect(idAllowed(resolvedId(typed, "egal"))).toBe(false);
  });

  test("emptying the field hands the id back to the name, field still open", () => {
    const cleared = typeIdField(typeIdField(open, "fischerin"), "");
    expect(cleared.editing).toBe(true);
    expect(followsName(cleared)).toBe(true);
    expect(resolvedId(cleared, "Alte Fischerin")).toBe("alte-fischerin");
    expect(submittedId(cleared)).toBeUndefined();
  });

  test("keeps the field open across keystrokes", () => {
    expect(typeIdField(open, "f").editing).toBe(true);
    expect(typeIdField(ID_FIELD_START, "f").editing).toBe(false);
  });
});

describe("idAllowed", () => {
  test("is the shared slug rule and nothing else", () => {
    for (const id of ["hafen", "01-salzhafen", "hafen-2", "a1"]) {
      expect(idAllowed(id)).toBe(true);
    }
    for (const id of ["", "Hafen", "hafen-", "-hafen", "hafen--2", "hafen/holm", "hafen holm"]) {
      expect(idAllowed(id)).toBe(false);
    }
  });
});

describe("the 409 proposal", () => {
  test("settles as a typed id, so the field shows it instead of the derivation", () => {
    const taken = takeIdSuggestion(ID_FIELD_START, "alte-fischerin-2");
    expect(followsName(taken)).toBe(false);
    expect(resolvedId(taken, "Alte Fischerin")).toBe("alte-fischerin-2");
    expect(submittedId(taken)).toBe("alte-fischerin-2");
    // Taking it does not open a field the DM never asked for.
    expect(taken.editing).toBe(false);
  });
});
