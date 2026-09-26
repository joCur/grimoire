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
    expect(resolvedId(ID_FIELD_START, "Old Fisherwoman")).toBe("old-fisherwoman");
    // A name with an umlaut goes through the transliteration of the slug rule.
    expect(resolvedId(ID_FIELD_START, "Müller's Forge")).toBe("mueller-s-forge");
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
    expect(resolvedId(open, "Old Fisherwoman")).toBe("old-fisherwoman");
  });

  test("pressing it again closes the field AND hands the id back to the name", () => {
    const typed = typeIdField(toggleIdField(ID_FIELD_START), "fisherwoman");
    const closed = toggleIdField(typed);
    expect(closed.editing).toBe(false);
    expect(followsName(closed)).toBe(true);
    expect(resolvedId(closed, "Old Fisherwoman")).toBe("old-fisherwoman");
  });
});

describe("typing an id", () => {
  const open = toggleIdField(ID_FIELD_START);

  test("stops the name from feeding it", () => {
    const typed = typeIdField(open, "the-fisherwoman");
    expect(followsName(typed)).toBe(false);
    expect(resolvedId(typed, "Old Fisherwoman")).toBe("the-fisherwoman");
    // …and a later name change leaves it alone.
    expect(resolvedId(typed, "A different name entirely")).toBe("the-fisherwoman");
    // A typed id IS sent, so the server does not derive its own.
    expect(submittedId(typed)).toBe("the-fisherwoman");
  });

  test("takes the text verbatim, including text the rule rejects", () => {
    const typed = typeIdField(open, "Old Fisherwoman!");
    expect(resolvedId(typed, "whatever")).toBe("Old Fisherwoman!");
    expect(idAllowed(resolvedId(typed, "whatever"))).toBe(false);
  });

  test("emptying the field hands the id back to the name, field still open", () => {
    const cleared = typeIdField(typeIdField(open, "fisherwoman"), "");
    expect(cleared.editing).toBe(true);
    expect(followsName(cleared)).toBe(true);
    expect(resolvedId(cleared, "Old Fisherwoman")).toBe("old-fisherwoman");
    expect(submittedId(cleared)).toBeUndefined();
  });

  test("keeps the field open across keystrokes", () => {
    expect(typeIdField(open, "f").editing).toBe(true);
    expect(typeIdField(ID_FIELD_START, "f").editing).toBe(false);
  });
});

describe("idAllowed", () => {
  test("is the shared slug rule and nothing else", () => {
    for (const id of ["harbour", "01-salt-harbour", "harbour-2", "a1"]) {
      expect(idAllowed(id)).toBe(true);
    }
    for (const id of ["", "Harbour", "harbour-", "-harbour", "harbour--2", "harbour/holm", "harbour holm"]) {
      expect(idAllowed(id)).toBe(false);
    }
  });
});

describe("the 409 proposal", () => {
  test("settles as a typed id, so the field shows it instead of the derivation", () => {
    const taken = takeIdSuggestion(ID_FIELD_START, "old-fisherwoman-2");
    expect(followsName(taken)).toBe(false);
    expect(resolvedId(taken, "Old Fisherwoman")).toBe("old-fisherwoman-2");
    expect(submittedId(taken)).toBe("old-fisherwoman-2");
    // Taking it does not open a field the DM never asked for.
    expect(taken.editing).toBe(false);
  });
});
