// The rules of the properties form: the field list per kind, the diff that
// decides what is patched at all, and the representation a cleared field is
// written in. All pure — the write itself is the shared editing session
// (lib/use-entry-edit.ts).

import { describe, expect, test } from "bun:test";
import type { CampaignTree, EntityKind } from "@grimoire/shared/types";

import {
  applyPropertiesPatch,
  canSubmitProperties,
  commitPendingText,
  locationRef,
  locationRefId,
  propertiesFieldsFor,
  propertiesFormIssues,
  propertiesFormValues,
  propertiesKindLabel,
  propertiesPatch,
  hasPropertiesChanges,
  referenceLabel,
  referenceOptions,
  type FieldOption,
  type FormValues,
  type PropertiesField,
} from "./properties-form";
import { translator } from "@/i18n/format";

// The language the assertions below are written in: the helpers
// take the translator as an argument, so a test says so explicitly instead of
// leaning on a default.
const t = translator("de");

/** The fields of a kind, or [] — every test starts from the real list. */
function fields(kind: EntityKind): readonly PropertiesField[] {
  return propertiesFieldsFor(kind, t) ?? [];
}

function keys(kind: EntityKind): string[] {
  return fields(kind).map((field) => field.key);
}

/** The properties of the fixture scene „Von den Schmugglern erwischt". */
const SCENE_PROPERTIES: Record<string, unknown> = {
  id: "smuggler-captured",
  title: "Von den Schmugglern erwischt",
  type: "contingency",
  trigger: "Charaktere werden beim Auskundschaften der Bucht entdeckt",
  chapter: "01-salzhafen",
  location: "bucht",
  npcs: ["fenn"],
  handouts: [],
  tags: ["social", "escape"],
  status: "ready",
};

/** The properties of the fixture NPC „Fenn" — quickstats arrive as numbers. */
const NPC_PROPERTIES: Record<string, unknown> = {
  id: "fenn",
  name: "Fenn",
  role: "Anführer der Schmuggler in der Nordbucht",
  chapter: "01-salzhafen",
  status: "alive",
  statblock: "Roll20: Fenn",
  quickstats: { wis: 2, insight: 2, "passive-perception": 13 },
  voice: "leise, höflich",
  appearance: "salzverkrustete Lederjacke",
};

describe("propertiesFieldsFor", () => {
  test("the scene fields are SceneProperties without the id", () => {
    expect(keys("scene")).toEqual([
      "title",
      "type",
      "trigger",
      "chapter",
      "location",
      "npcs",
      "handouts",
      "tags",
      "status",
    ]);
  });

  test("npc, location and chapter carry their own type's fields", () => {
    expect(keys("npc")).toEqual([
      "name",
      "role",
      "chapter",
      "status",
      "statblock",
      "quickstats",
      "voice",
      "appearance",
    ]);
    expect(keys("location")).toEqual(["name", "chapter", "roll20Page"]);
    expect(keys("chapter")).toEqual(["title", "status"]);
  });

  // The prose properties the cards show are edited beside the text, on the
  // entry's own edit surface — the dialog leaves them out.
  test("the text surface carries motivation and atmosphere, and the dialog does not", () => {
    const onText = (kind: EntityKind) =>
      (propertiesFieldsFor(kind, t, "text") ?? []).map((field) => field.key);
    expect(onText("npc")).toEqual(["motivation"]);
    expect(onText("location")).toEqual(["atmosphere"]);
    expect(onText("scene")).toEqual([]);
    expect(onText("chapter")).toEqual([]);
    expect(keys("npc")).not.toContain("motivation");
    expect(keys("location")).not.toContain("atmosphere");
    const [motivation] = propertiesFieldsFor("npc", t, "text") ?? [];
    expect(motivation?.label).toBe("Will");
    expect(motivation?.control).toBe("textarea");
  });

  // The chapter status is not free text: the API enforces the trio (400
  // otherwise), so a text field could only produce a rejected save — and the
  // dialog has to offer the same list the overview's control does.
  test("the chapter status is a select over the enum, in lifecycle order", () => {
    const status = fields("chapter").find((field) => field.key === "status");
    expect(status?.control).toBe("select");
    expect(status?.options?.map((o) => o.value)).toEqual(["planned", "active", "done"]);
    expect(status?.options?.map((o) => o.label)).toEqual(["Geplant", "Aktiv", "Abgeschlossen"]);
    // No placeholder any more — a select has no empty text to hint at.
    expect(status?.placeholder).toBeUndefined();
  });

  test("neither the id nor the kind is ever a field (the id is fixed at creation)", () => {
    for (const kind of ["scene", "npc", "location", "chapter"] as const) {
      expect(keys(kind)).not.toContain("id");
      expect(keys(kind)).not.toContain("kind");
    }
  });

  test("the kinds without a typed form get no form at all", () => {
    for (const kind of ["campaign", "session", "inbox", "glossary", "unknown"] as const) {
      expect(propertiesFieldsFor(kind, t)).toBe(undefined);
      expect(propertiesKindLabel(kind, t)).toBe(undefined);
    }
  });

  test("reference fields name the tree list they offer", () => {
    const byKey = new Map(fields("scene").map((field) => [field.key, field]));
    expect(byKey.get("npcs")?.control).toBe("references");
    expect(byKey.get("npcs")?.source).toBe("npcs");
    expect(byKey.get("location")?.control).toBe("reference");
    expect(byKey.get("location")?.source).toBe("locations");
    expect(byKey.get("chapter")?.source).toBe("chapters");
    // The status select is the same option list the status regler offers.
    expect(byKey.get("status")?.options?.map((o) => o.value)).toEqual([
      "draft",
      "ready",
      "played",
      "dropped",
    ]);
  });
});

describe("propertiesFormValues", () => {
  test("a scene starts with exactly what its properties carry", () => {
    expect(propertiesFormValues(fields("scene"), SCENE_PROPERTIES)).toEqual({
      title: { kind: "text", text: "Von den Schmugglern erwischt" },
      type: { kind: "text", text: "contingency" },
      trigger: {
        kind: "text",
        text: "Charaktere werden beim Auskundschaften der Bucht entdeckt",
      },
      chapter: { kind: "text", text: "01-salzhafen" },
      location: { kind: "text", text: "bucht" },
      npcs: { kind: "list", items: ["fenn"] },
      handouts: { kind: "list", items: [] },
      tags: { kind: "list", items: ["social", "escape"] },
      status: { kind: "text", text: "ready" },
    });
  });

  test("quickstats become editable key/value rows, numbers as their text", () => {
    const values = propertiesFormValues(fields("npc"), NPC_PROPERTIES);
    expect(values.quickstats).toEqual({
      kind: "pairs",
      entries: [
        { key: "wis", value: "2" },
        { key: "insight", value: "2" },
        { key: "passive-perception", value: "13" },
      ],
    });
  });

  test("missing keys are empty fields, odd values degrade instead of throwing", () => {
    const values = propertiesFormValues(fields("location"), {
      id: "leuchtturm",
      name: "Leuchtturm",
      roll20Page: 12,
      chapter: { nested: true },
    });
    expect(values.roll20Page).toEqual({ kind: "text", text: "12" });
    expect(values.chapter).toEqual({ kind: "text", text: "" });
  });
});

describe("applyPropertiesPatch", () => {
  // What a caller needs that cannot send a patch at all — the generator
  // review, whose draft is stored as a whole properties object.
  test("folds the diff back into the values it was measured against", () => {
    const sceneFields = fields("scene");
    const initial = propertiesFormValues(sceneFields, SCENE_PROPERTIES);
    const current = { ...initial, status: { kind: "text" as const, text: "played" } };
    const whole = applyPropertiesPatch(
      SCENE_PROPERTIES,
      propertiesPatch(sceneFields, initial, current),
    );
    expect(whole.status).toBe("played");
    expect(whole.title).toBe(SCENE_PROPERTIES.title);
  });

  test("a cleared field drops the key instead of writing an empty value", () => {
    expect(applyPropertiesPatch({ title: "Ankunft", trigger: "wenn" }, { trigger: null })).toEqual({
      title: "Ankunft",
    });
  });

  test("keys the form does not know survive untouched", () => {
    const base = { title: "Ankunft", "prep-time": "20min" };
    expect(applyPropertiesPatch(base, { title: "Neu" })).toEqual({
      title: "Neu",
      "prep-time": "20min",
    });
  });
});

describe("propertiesPatch", () => {
  const sceneFields = fields("scene");
  const npcFields = fields("npc");

  /** The values of an entry, with single fields overridden. */
  function edited(
    fieldList: readonly PropertiesField[],
    properties: Record<string, unknown>,
    changes: FormValues,
  ): { initial: FormValues; current: FormValues } {
    const initial = propertiesFormValues(fieldList, properties);
    return { initial, current: { ...initial, ...changes } };
  }

  test("an untouched form patches nothing at all", () => {
    const initial = propertiesFormValues(sceneFields, SCENE_PROPERTIES);
    expect(propertiesPatch(sceneFields, initial, initial)).toEqual({});
    // `handouts: []` stays exactly that — an empty list is not a change.
    expect(propertiesPatch(sceneFields, initial, { ...initial })).toEqual({});
  });

  test("only the changed field is sent (everything else survives stored)", () => {
    const { initial, current } = edited(sceneFields, SCENE_PROPERTIES, {
      status: { kind: "text", text: "played" },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({ status: "played" });
  });

  test("unknown properties keys are never part of the patch", () => {
    const withExtras = { ...SCENE_PROPERTIES, "prep-time": "20min", weather: ["Regen"] };
    const initial = propertiesFormValues(sceneFields, withExtras);
    const current = { ...initial, title: { kind: "text" as const, text: "Neuer Titel" } };
    const patch = propertiesPatch(sceneFields, initial, current);
    expect(patch).toEqual({ title: "Neuer Titel" });
    expect(Object.keys(patch)).not.toContain("prep-time");
    expect(Object.keys(patch)).not.toContain("weather");
  });

  test("whitespace around a value is not a change", () => {
    const { initial, current } = edited(sceneFields, SCENE_PROPERTIES, {
      title: { kind: "text", text: "  Von den Schmugglern erwischt  " },
      tags: { kind: "list", items: ["social ", " escape"] },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({});
  });

  test("clearing a field DELETES the key — text, list and pairs alike", () => {
    const scene = edited(sceneFields, SCENE_PROPERTIES, {
      trigger: { kind: "text", text: "   " },
      tags: { kind: "list", items: [] },
    });
    expect(propertiesPatch(sceneFields, scene.initial, scene.current)).toEqual({
      trigger: null,
      tags: null,
    });
    const npc = edited(npcFields, NPC_PROPERTIES, { quickstats: { kind: "pairs", entries: [] } });
    expect(propertiesPatch(npcFields, npc.initial, npc.current)).toEqual({ quickstats: null });
  });

  test("a list keeps its order and drops blank entries", () => {
    const { initial, current } = edited(sceneFields, SCENE_PROPERTIES, {
      npcs: { kind: "list", items: ["jorna", "  ", "fenn"] },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({ npcs: ["jorna", "fenn"] });
  });

  test("an unknown reference id is saved verbatim (the entry may follow later)", () => {
    const { initial, current } = edited(sceneFields, SCENE_PROPERTIES, {
      location: { kind: "text", text: "nordbucht" },
      npcs: { kind: "list", items: ["fenn", "kapitaen-torv"] },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({
      location: "nordbucht",
      npcs: ["fenn", "kapitaen-torv"],
    });
  });

  test("quickstats keep their YAML types: numbers stay numbers, a typed +2 stays text", () => {
    const { initial, current } = edited(npcFields, NPC_PROPERTIES, {
      quickstats: {
        kind: "pairs",
        entries: [
          { key: "wis", value: "3" },
          { key: "insight", value: "+2" },
          // A row that cannot be written (no name). It is not IN the patch —
          // and it never gets there, because propertiesFormIssues blocks the
          // save while it stands (see „unfinished quickstat rows“ below).
          { key: "", value: "wird nicht geschrieben" },
        ],
      },
    });
    expect(propertiesPatch(npcFields, initial, current)).toEqual({
      quickstats: { wis: 3, insight: "+2" },
    });
  });

  test("a quickstat whose VALUE was cleared loses its key — never `key: ''`", () => {
    const { initial, current } = edited(npcFields, NPC_PROPERTIES, {
      quickstats: {
        kind: "pairs",
        entries: [
          { key: "wis", value: "2" },
          { key: "insight", value: "  " },
          { key: "passive-perception", value: "13" },
        ],
      },
    });
    expect(propertiesPatch(npcFields, initial, current)).toEqual({
      quickstats: { wis: 2, "passive-perception": 13 },
    });
  });

  test("clearing every quickstat value deletes the whole key", () => {
    const { initial, current } = edited(npcFields, NPC_PROPERTIES, {
      quickstats: {
        kind: "pairs",
        entries: [
          { key: "wis", value: "" },
          { key: "insight", value: "" },
          { key: "passive-perception", value: "" },
        ],
      },
    });
    expect(propertiesPatch(npcFields, initial, current)).toEqual({ quickstats: null });
  });

  test("a field nobody touched is not in the patch at all", () => {
    // The status is part of the form and stands unchanged, so the write must
    // not carry it — a no-op that would still bump the rev.
    const { initial, current } = edited(sceneFields, SCENE_PROPERTIES, {
      title: { kind: "text", text: "Anderer Titel" },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({ title: "Anderer Titel" });
  });
});

describe("canSubmitProperties", () => {
  test("a blank title/name is not a save", () => {
    const sceneFields = fields("scene");
    const values = propertiesFormValues(sceneFields, SCENE_PROPERTIES);
    expect(canSubmitProperties(sceneFields, values)).toBe(true);
    expect(
      canSubmitProperties(sceneFields, { ...values, title: { kind: "text", text: "  " } }),
    ).toBe(false);
    const npcFields = fields("npc");
    expect(
      canSubmitProperties(npcFields, {
        ...propertiesFormValues(npcFields, NPC_PROPERTIES),
        name: { kind: "text", text: "" },
      }),
    ).toBe(false);
  });
});

describe("unfinished quickstat rows block the save", () => {
  const npcFields = fields("npc");
  const values = propertiesFormValues(npcFields, NPC_PROPERTIES);
  const withStats = (entries: { key: string; value: string }[]): FormValues => ({
    ...values,
    quickstats: { kind: "pairs", entries },
  });

  test("an entry's own rows are fine — nothing to complain about", () => {
    expect(propertiesFormIssues(npcFields, values, undefined, t)).toEqual({});
    // An empty row (the „Zeile hinzufügen“ state) and a name whose value was
    // cleared (= delete this key) are both legitimate.
    expect(
      propertiesFormIssues(
        npcFields,
        withStats([
          { key: "insight", value: "2" },
          { key: "wis", value: "" },
          { key: "", value: "" },
        ]), undefined, t,
      ),
    ).toEqual({});
  });

  test("a value without a name is named out loud instead of being dropped", () => {
    const issues = propertiesFormIssues(
      npcFields,
      withStats([
        { key: "insight", value: "2" },
        { key: "  ", value: "+3" },
      ]), undefined, t,
    );
    expect(issues.quickstats).toBe("Zeile ohne Namen — Name ergänzen oder Zeile entfernen.");
  });

  test("the same name twice is refused — YAML would swallow the first value", () => {
    const issues = propertiesFormIssues(
      npcFields,
      withStats([
        { key: "insight", value: "2" },
        { key: "insight", value: "3" },
      ]), undefined, t,
    );
    expect(issues.quickstats).toBe(
      'Name „insight“ doppelt — jeder Name darf nur einmal vorkommen.',
    );
  });

  test("a scene's own properties is fine as it stands", () => {
    const sceneFields = fields("scene");
    expect(propertiesFormIssues(sceneFields, propertiesFormValues(sceneFields, SCENE_PROPERTIES), undefined, t)).toEqual(
      {},
    );
  });
});

describe("a scene's Kapitel cannot be cleared", () => {
  const sceneFields = fields("scene");
  const initial = propertiesFormValues(sceneFields, SCENE_PROPERTIES);
  const withChapter = (text: string): FormValues => ({
    ...initial,
    chapter: { kind: "text", text },
  });

  test("a blank Kapitel blocks the save and says why under the field", () => {
    // The server refuses the patch (`chapter_required`); saying it here turns
    // a round trip that ends in a toast into a line under the control.
    expect(propertiesFormIssues(sceneFields, withChapter(""), initial, t).chapter).toBe(
      "Eine Szene braucht ein Kapitel — es lässt sich verschieben, aber nicht entfernen.",
    );
    // Whitespace only is the same thing.
    expect(propertiesFormIssues(sceneFields, withChapter("   "), initial, t).chapter).toBeDefined();
    // …and a value is fine, whether or not that chapter has an entry — that
    // is the server's answer (i18n/server-errors.ts).
    expect(propertiesFormIssues(sceneFields, withChapter("02-nordwind"), initial, t)).toEqual({});
  });

  test("an unfinished Kapitel counts as unsaved work, so Esc asks first", () => {
    expect(hasPropertiesChanges(sceneFields, initial, withChapter(""), t)).toBe(true);
  });

  test("an npc and an Ort may sit outside every chapter", () => {
    // Only a SCENE's chapter is part of its address, so only a scene loses
    // the ability to clear the field.
    for (const kind of ["npc", "location"] as const) {
      const kindFields = fields(kind);
      const values = propertiesFormValues(kindFields, { id: "x", name: "X", chapter: "01-salzhafen" });
      expect(
        propertiesFormIssues(kindFields, { ...values, chapter: { kind: "text", text: "" } }, values, t),
        kind,
      ).toEqual({});
    }
  });
});

describe("the npcs list holds ids, not names", () => {
  const sceneFields = fields("scene");
  const initial = propertiesFormValues(sceneFields, SCENE_PROPERTIES);
  const withNpcs = (items: string[]): FormValues => ({
    ...initial,
    npcs: { kind: "list", items },
  });

  test("a new free-text entry blocks the save and says the rule", () => {
    // The server refuses it with a 400 — saying it here makes that a line
    // under the field instead of a failed save.
    const issues = propertiesFormIssues(sceneFields, withNpcs(["fenn", "Alte Fischerin"]), initial, t);
    expect(issues.npcs).toBe(
      '„Alte Fischerin“ ist keine Kennung — nur Kleinbuchstaben, Ziffern und Bindestriche.',
    );
  });

  test("an id is fine here — whether it HAS an entry is the server's answer", () => {
    // The form does not know every id, so it only checks the shape; a
    // reference that names nothing comes back as a 400 with its own
    // sentence (i18n/server-errors.ts).
    expect(propertiesFormIssues(sceneFields, withNpcs(["fenn", "holm"]), initial, t)).toEqual({});
  });

  test("free text the entry already carries is exempt — it stays savable", () => {
    // Whatever a list holds today, an unrelated save re-sends it.
    const stored = withNpcs(["fenn", "Alte Fischerin"]);
    expect(propertiesFormIssues(sceneFields, stored, stored, t)).toEqual({});
    // …and an untouched form with such a value is not "dirty" either.
    expect(hasPropertiesChanges(sceneFields, stored, stored, t)).toBe(false);
  });
});

describe("the Ort field: free text in, an id out", () => {
  const sceneFields = fields("scene");
  const initial = propertiesFormValues(sceneFields, SCENE_PROPERTIES);
  const withLocation = (text: string): FormValues => ({
    ...initial,
    location: { kind: "text", text },
  });
  /** The Orte that HAVE an entry, as the dialog offers them. */
  const known: readonly FieldOption[] = [
    { value: "bucht", label: "Die Nordbucht" },
    { value: "leuchtturm", label: "Der Leuchtturm von Salzhafen" },
    { value: "namenlos", label: "namenlos" },
  ];

  test("an existing id resolves to the Ort's name", () => {
    expect(locationRef("leuchtturm", known)).toEqual({
      kind: "known",
      id: "leuchtturm",
      name: "Der Leuchtturm von Salzhafen",
    });
    // An entry without a name has nothing to say under the field.
    expect(locationRef("namenlos", known)).toEqual({ kind: "known", id: "namenlos" });
  });

  test("text that SLUGS to an existing id resolves to the same Ort", () => {
    // The DM types the name, not the key — and lands on the entry that is
    // already there instead of being told to look up its id.
    expect(locationRef("Leuchtturm", known)).toEqual({
      kind: "known",
      id: "leuchtturm",
      name: "Der Leuchtturm von Salzhafen",
    });
  });

  test("text that slugs to an id nothing holds is UNKNOWN", () => {
    // Nothing is created by naming it, so the line under the field says the
    // Ort has to exist — and the save is refused until it does.
    expect(locationRef("Der alte Hafen", known)).toEqual({
      kind: "unknown",
      id: "der-alte-hafen",
    });
    expect(locationRef("nordbucht", known)).toEqual({ kind: "unknown", id: "nordbucht" });
  });

  test("nothing typed is nothing said; unslugable text is the one problem", () => {
    expect(locationRef("   ", known)).toEqual({ kind: "empty" });
    expect(locationRef("???", known)).toEqual({ kind: "unusable", value: "???" });
  });

  test("only unslugable text blocks the save, and it says so", () => {
    // Everything a slug can be derived from is sent — whether that id has an
    // entry is the server's answer, not the form's.
    expect(propertiesFormIssues(sceneFields, withLocation("Der alte Hafen"), initial, t)).toEqual(
      {},
    );
    expect(propertiesFormIssues(sceneFields, withLocation("leuchtturm"), initial, t)).toEqual({});
    expect(propertiesFormIssues(sceneFields, withLocation("  "), initial, t)).toEqual({});
    expect(propertiesFormIssues(sceneFields, withLocation("???"), initial, t).location).toBe(
      'Kein verwendbarer Name — „???“ ergibt keine Orts-Kennung.',
    );
  });

  test("the patch carries the id the text means", () => {
    expect(propertiesPatch(sceneFields, initial, withLocation("Der alte Hafen"))).toEqual({
      location: "der-alte-hafen",
    });
    expect(propertiesPatch(sceneFields, initial, withLocation("nordbucht"))).toEqual({
      location: "nordbucht",
    });
  });

  test("text that slugs to the STORED id is no change at all", () => {
    // `location: bucht` is what the entry holds; „Bucht“ means the same
    // entry, so there is nothing to patch.
    const current = withLocation("Bucht");
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({});
    expect(hasPropertiesChanges(sceneFields, initial, current, t)).toBe(false);
  });

  test("unslugable text patches nothing but counts as unsaved work", () => {
    const current = withLocation("???");
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({});
    expect(hasPropertiesChanges(sceneFields, initial, current, t)).toBe(true);
  });

  test("clearing the Ort deletes the key (the scene moves to chapter level)", () => {
    expect(propertiesPatch(sceneFields, initial, withLocation(""))).toEqual({ location: null });
  });

  test("locationRefId is the one derivation both halves use", () => {
    expect(locationRefId("  Der alte Hafen ")).toBe("der-alte-hafen");
    expect(locationRefId("Grüße aus Salzhafen")).toBe("gruesse-aus-salzhafen");
    expect(locationRefId("leuchtturm")).toBe("leuchtturm");
    expect(locationRefId("???")).toBe("");
    expect(locationRefId("")).toBe("");
  });

});

describe("hasPropertiesChanges", () => {
  const sceneFields = fields("scene");
  const npcFields = fields("npc");
  const initial = propertiesFormValues(sceneFields, SCENE_PROPERTIES);

  test("an untouched form has nothing to discard", () => {
    expect(hasPropertiesChanges(sceneFields, initial, initial, t)).toBe(false);
    // Whitespace is not work either (same rule the patch uses).
    expect(
      hasPropertiesChanges(sceneFields, initial, {
        ...initial,
        title: { kind: "text", text: `  ${SCENE_PROPERTIES.title as string}  ` },
      }, t),
    ).toBe(false);
  });

  test("a changed field is work — and so is an unfinished quickstat row", () => {
    expect(
      hasPropertiesChanges(sceneFields, initial, {
        ...initial,
        status: { kind: "text", text: "played" },
      }, t),
    ).toBe(true);
    // The invalid row produces no patch at all, so the guard has to ask the
    // issues as well — otherwise Esc would throw it away silently.
    const npcInitial = propertiesFormValues(npcFields, NPC_PROPERTIES);
    const stats = npcInitial.quickstats;
    if (stats?.kind !== "pairs") throw new Error("quickstats is not a pairs field");
    const nameless: FormValues = {
      ...npcInitial,
      quickstats: { kind: "pairs", entries: [...stats.entries, { key: "", value: "+1" }] },
    };
    expect(propertiesPatch(npcFields, npcInitial, nameless)).toEqual({});
    expect(hasPropertiesChanges(npcFields, npcInitial, nameless, t)).toBe(true);
  });
});

describe("commitPendingText", () => {
  const sceneFields = fields("scene");
  const values = propertiesFormValues(sceneFields, SCENE_PROPERTIES);

  test("text still standing in a chip input is folded into its list", () => {
    const committed = commitPendingText(sceneFields, values, { tags: "combat" });
    expect(committed.tags).toEqual({ kind: "list", items: ["social", "escape", "combat"] });
    // …and the patch sees it, so „Speichern“ straight after typing works.
    expect(propertiesPatch(sceneFields, values, committed)).toEqual({
      tags: ["social", "escape", "combat"],
    });
  });

  test("blank, duplicate and non-list pending text change nothing", () => {
    expect(commitPendingText(sceneFields, values, { tags: "   " })).toBe(values);
    expect(commitPendingText(sceneFields, values, { tags: "social" })).toBe(values);
    expect(commitPendingText(sceneFields, values, { title: "ignoriert" })).toBe(values);
  });
});

describe("reference and select options", () => {
  const tree: CampaignTree = {
    campaign: "beispiel",
    chapters: [
      { id: "01-salzhafen", title: "Kapitel 1: Der Leuchtturm", scenes: [] },
    ],
    npcs: [
      { path: "npcs/fenn", id: "fenn", name: "Fenn", status: "alive" },
      { path: "npcs/jorna", id: "jorna", name: "Hafenmeisterin Jorna", status: "alive" },
    ],
    locations: [
      { id: "leuchtturm", name: "Der Leuchtturm" },
    ],
    sessions: [],
  };

  test("the options are the ids that HAVE an entry, labelled with their name", () => {
    expect(referenceOptions(tree, "npcs")).toEqual([
      { value: "fenn", label: "Fenn" },
      { value: "jorna", label: "Hafenmeisterin Jorna" },
    ]);
    expect(referenceOptions(tree, "locations")).toEqual([
      { value: "leuchtturm", label: "Der Leuchtturm" },
    ]);
    expect(referenceOptions(tree, "chapters")).toEqual([
      { value: "01-salzhafen", label: "Kapitel 1: Der Leuchtturm" },
    ]);
    // No tree yet (query still running): no suggestions, still a usable field.
    expect(referenceOptions(undefined, "npcs")).toEqual([]);
  });

  test("referenceLabel names a known id and stays quiet otherwise", () => {
    const options = referenceOptions(tree, "npcs");
    expect(referenceLabel(options, "jorna")).toBe("Hafenmeisterin Jorna");
    expect(referenceLabel(options, "kapitaen-torv")).toBe(undefined);
  });

});
