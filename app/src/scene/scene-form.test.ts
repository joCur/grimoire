// The rules of a scene's form: what it starts with, the diff that decides
// what is written at all, and the lines that block a save. All pure — the
// write itself is the scene's editing session (./use-scene-edit.ts).

import type { SceneProposal } from "@grimoire/shared/scene";
import { describe, expect, test } from "bun:test";

import type { FieldOption } from "@/components/fields/SelectField";
import { translator } from "@/i18n/format";

import {
  canSubmitSceneForm,
  locationRef,
  locationRefId,
  sceneFormChange,
  sceneFormDirty,
  sceneFormIssues,
  sceneFormValues,
  sceneProposalChange,
  withPendingChips,
  type SceneFormValues,
} from "./scene-form";

// The helpers take the translator as an argument, so a test names the
// language it asserts.
const t = translator("de");

/** A contingency scene, with the fields that matter here. */
const SCENE: SceneProposal = {
  id: "smuggler-captured",
  title: "Captured by the Smugglers",
  type: "contingency",
  trigger: "The characters are spotted while scouting the cove",
  chapter: "01-salt-harbour",
  location: "cove",
  npcs: ["fenn"],
  handouts: [],
  tags: ["social", "escape"],
  status: "ready",
  body: "",
};

const initial = sceneFormValues(SCENE);
const edited = (changes: Partial<SceneFormValues>): SceneFormValues => ({ ...initial, ...changes });

describe("sceneFormValues", () => {
  test("a scene starts with exactly its fields; an absent one is an empty field", () => {
    expect(initial).toEqual({
      title: "Captured by the Smugglers",
      type: "contingency",
      trigger: "The characters are spotted while scouting the cove",
      chapter: "01-salt-harbour",
      location: "cove",
      npcs: ["fenn"],
      handouts: [],
      tags: ["social", "escape"],
      status: "ready",
    });
    const { trigger: _trigger, location: _location, ...bare } = SCENE;
    expect(sceneFormValues(bare).trigger).toBe("");
    expect(sceneFormValues(bare).location).toBe("");
  });
});

describe("sceneFormChange", () => {
  test("an untouched form writes nothing at all", () => {
    expect(sceneFormChange(initial, initial)).toEqual({});
  });

  test("only the changed field is written", () => {
    expect(sceneFormChange(initial, edited({ status: "played" }))).toEqual({ status: "played" });
    expect(sceneFormChange(initial, edited({ title: "Another Title" }))).toEqual({
      title: "Another Title",
    });
  });

  test("whitespace around a value is not a change", () => {
    expect(
      sceneFormChange(
        initial,
        edited({ title: "  Captured by the Smugglers  ", tags: ["social ", " escape"] }),
      ),
    ).toEqual({});
  });

  test("a cleared text field is null, a cleared list is empty", () => {
    expect(sceneFormChange(initial, edited({ trigger: "   ", tags: [] }))).toEqual({
      trigger: null,
      tags: [],
    });
  });

  test("a list keeps its order and drops blank entries", () => {
    expect(sceneFormChange(initial, edited({ npcs: ["jorna", "  ", "fenn"] }))).toEqual({
      npcs: ["jorna", "fenn"],
    });
  });

  test("a new chapter is written; a blank one never is", () => {
    expect(sceneFormChange(initial, edited({ chapter: "02-north-wind" }))).toEqual({
      chapter: "02-north-wind",
    });
    expect(sceneFormChange(initial, edited({ chapter: "  " }))).toEqual({});
  });

  test("a blank title is left out — the scene keeps its own", () => {
    expect(sceneFormChange(initial, edited({ title: "  " }))).toEqual({});
  });
});

describe("the chip text still standing in an input", () => {
  test("is folded into its list, so a save straight after typing carries it", () => {
    const committed = withPendingChips(initial, { tags: "combat" });
    expect(committed.tags).toEqual(["social", "escape", "combat"]);
    expect(sceneFormChange(initial, committed)).toEqual({ tags: ["social", "escape", "combat"] });
  });

  test("blank and duplicate text changes nothing", () => {
    expect(withPendingChips(initial, { tags: "   " })).toBe(initial);
    expect(withPendingChips(initial, { tags: "social" })).toBe(initial);
  });
});

describe("what blocks a save", () => {
  test("the scene as it stands is fine", () => {
    expect(sceneFormIssues(initial, initial, t)).toEqual({});
    expect(canSubmitSceneForm(initial, initial, t)).toBe(true);
  });

  test("a blank title is not a save", () => {
    expect(canSubmitSceneForm(initial, edited({ title: "  " }), t)).toBe(false);
  });

  test("a blank chapter blocks the save and says why under the field", () => {
    expect(sceneFormIssues(edited({ chapter: "" }), initial, t).chapter).toBe(
      t("properties.issue.chapterRequired"),
    );
    expect(sceneFormIssues(edited({ chapter: "   " }), initial, t).chapter).toBeDefined();
    expect(sceneFormDirty(initial, edited({ chapter: "" }), t)).toBe(true);
  });

  test("a new free-text npc blocks the save and says the rule", () => {
    expect(sceneFormIssues(edited({ npcs: ["fenn", "Old Fisherwoman"] }), initial, t).npcs).toBe(
      t("properties.issue.notAnId", { id: "Old Fisherwoman" }),
    );
    // An id is fine — whether it HAS an npc is the server's answer.
    expect(sceneFormIssues(edited({ npcs: ["fenn", "holm"] }), initial, t)).toEqual({});
  });

  test("free text the scene already carries in `npcs` is exempt", () => {
    const stored = edited({ npcs: ["fenn", "Old Fisherwoman"] });
    expect(sceneFormIssues(stored, stored, t)).toEqual({});
    expect(sceneFormDirty(stored, stored, t)).toBe(false);
  });
});

describe("the location field: free text in, an id out", () => {
  /** The locations that exist, as the dialog offers them. */
  const known: readonly FieldOption[] = [
    { value: "cove", label: "The North Cove" },
    { value: "lighthouse", label: "The Lighthouse of Salt Harbour" },
    { value: "nameless", label: "nameless" },
  ];

  test("an existing id, or text that slugs to one, resolves to its name", () => {
    expect(locationRef("lighthouse", known)).toEqual({
      kind: "known",
      id: "lighthouse",
      name: "The Lighthouse of Salt Harbour",
    });
    expect(locationRef("Lighthouse", known)).toEqual({
      kind: "known",
      id: "lighthouse",
      name: "The Lighthouse of Salt Harbour",
    });
    // A location without a name has nothing to say under the field.
    expect(locationRef("nameless", known)).toEqual({ kind: "known", id: "nameless" });
  });

  test("text that slugs to an id nothing holds is unknown", () => {
    expect(locationRef("The Old Harbour", known)).toEqual({ kind: "unknown", id: "the-old-harbour" });
  });

  test("nothing typed is nothing said; unslugable text is the one problem", () => {
    expect(locationRef("   ", known)).toEqual({ kind: "empty" });
    expect(locationRef("???", known)).toEqual({ kind: "unusable", value: "???" });
    expect(sceneFormIssues(edited({ location: "???" }), initial, t).location).toBe(
      t("properties.issue.locationUnusable", { value: "???" }),
    );
    expect(sceneFormIssues(edited({ location: "The Old Harbour" }), initial, t)).toEqual({});
  });

  test("the write carries the id the text means", () => {
    expect(sceneFormChange(initial, edited({ location: "The Old Harbour" }))).toEqual({
      location: "the-old-harbour",
    });
  });

  test("text that slugs to the STORED id is no change at all", () => {
    expect(sceneFormChange(initial, edited({ location: "Cove" }))).toEqual({});
    expect(sceneFormDirty(initial, edited({ location: "Cove" }), t)).toBe(false);
  });

  test("unslugable text writes nothing but counts as unsaved work", () => {
    expect(sceneFormChange(initial, edited({ location: "???" }))).toEqual({});
    expect(sceneFormDirty(initial, edited({ location: "???" }), t)).toBe(true);
  });

  test("clearing the location clears the field", () => {
    expect(sceneFormChange(initial, edited({ location: "" }))).toEqual({ location: null });
  });

  test("locationRefId is the one derivation both halves use", () => {
    expect(locationRefId("  The Old Harbour ")).toBe("the-old-harbour");
    expect(locationRefId("Café at the Harbour")).toBe("cafe-at-the-harbour");
    expect(locationRefId("lighthouse")).toBe("lighthouse");
    expect(locationRefId("???")).toBe("");
  });
});

describe("sceneProposalChange", () => {
  test("names every field, with the value the form holds", () => {
    expect(sceneProposalChange(edited({ trigger: "", location: "The Old Harbour" }))).toEqual({
      title: "Captured by the Smugglers",
      type: "contingency",
      trigger: null,
      chapter: "01-salt-harbour",
      location: "the-old-harbour",
      npcs: ["fenn"],
      handouts: [],
      tags: ["social", "escape"],
      status: "ready",
    });
  });
});
