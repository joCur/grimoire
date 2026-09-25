// The rules of a chapter's properties form: its field list, the diff that
// decides what is patched at all, and the representation a cleared field is
// written in. All pure — the write itself is the shared editing session
// (lib/use-entry-edit.ts).

import { describe, expect, test } from "bun:test";

import { translator } from "@/i18n/format";

import {
  canSubmitProperties,
  hasPropertiesChanges,
  propertiesFieldsFor,
  propertiesFormValues,
  propertiesKindLabel,
  propertiesPatch,
} from "./properties-form";

// The helpers take the translator as an argument, so a test names the
// language it asserts.
const t = translator("de");

const fields = propertiesFieldsFor("chapter", t) ?? [];
const PROPERTIES = { id: "01-salzhafen", title: "Salzhafen", status: "planned" };
const initial = propertiesFormValues(fields, PROPERTIES);

describe("propertiesFieldsFor", () => {
  test("the chapter carries its title and its status, never its id", () => {
    expect(fields.map((field) => field.key)).toEqual(["title", "status"]);
  });

  test("the status is a select over the enum, in lifecycle order", () => {
    // The API enforces the trio (400 otherwise), so a text field could only
    // produce a rejected save — the dialog offers the list the overview's
    // control does.
    const status = fields.find((field) => field.key === "status");
    expect(status?.control).toBe("select");
    expect(status?.options?.map((o) => o.value)).toEqual(["planned", "active", "done"]);
    expect(status?.options?.map((o) => o.label)).toEqual(["Geplant", "Aktiv", "Abgeschlossen"]);
  });

  test("the kinds without a typed form get no form at all", () => {
    for (const kind of ["campaign", "scene", "session", "inbox", "glossary", "unknown"] as const) {
      expect(propertiesFieldsFor(kind, t)).toBe(undefined);
      expect(propertiesKindLabel(kind, t)).toBe(undefined);
    }
    expect(propertiesKindLabel("chapter", t)).toBe("Kapitel");
  });
});

describe("propertiesFormValues", () => {
  test("a chapter starts with its fields; odd values degrade to an empty field", () => {
    expect(initial).toEqual({ title: "Salzhafen", status: "planned" });
    expect(propertiesFormValues(fields, { title: 12 })).toEqual({ title: "", status: "" });
  });
});

describe("propertiesPatch", () => {
  test("an untouched form patches nothing at all", () => {
    expect(propertiesPatch(fields, initial, initial)).toEqual({});
    expect(hasPropertiesChanges(fields, initial, initial)).toBe(false);
  });

  test("only the changed field is sent, whitespace around it is no change", () => {
    expect(propertiesPatch(fields, initial, { ...initial, status: "done" })).toEqual({
      status: "done",
    });
    expect(propertiesPatch(fields, initial, { ...initial, title: "  Salzhafen " })).toEqual({});
  });

  test("clearing a field DELETES the key", () => {
    expect(propertiesPatch(fields, initial, { ...initial, status: "" })).toEqual({ status: null });
    expect(hasPropertiesChanges(fields, initial, { ...initial, status: "" })).toBe(true);
  });
});

describe("canSubmitProperties", () => {
  test("a blank title is not a save", () => {
    expect(canSubmitProperties(fields, initial)).toBe(true);
    expect(canSubmitProperties(fields, { ...initial, title: "  " })).toBe(false);
  });
});
