// The rules of the „Eigenschaften" form (issue #42): the field list per kind,
// the diff that decides what is patched at all, and the representation a
// cleared field is written in. Everything here is pure except the last block,
// which drives the write through a faked fetch (same shape as
// campaign-meta.test.ts).

import { afterEach, describe, expect, test } from "bun:test";
import type { CampaignTree, EntityKind, FileResponse } from "@grimoire/shared/types";

import { ApiError } from "@/api";
import {
  canSubmitProperties,
  commitPendingText,
  propertiesFieldsFor,
  propertiesFormIssues,
  propertiesFormValues,
  propertiesKindLabel,
  propertiesPatch,
  hasPropertiesChanges,
  referenceLabel,
  referenceOptions,
  selectOptions,
  writePropertiesForm,
  type FormValues,
  type PropertiesField,
} from "./properties-form";

/** The fields of a kind, or [] — every test starts from the real list. */
function fields(kind: EntityKind): readonly PropertiesField[] {
  return propertiesFieldsFor(kind) ?? [];
}

function keys(kind: EntityKind): string[] {
  return fields(kind).map((field) => field.key);
}

/** examples/beispiel/01-salzhafen/hafen/von-schmugglern-erwischt */
const SCENE_FM: Record<string, unknown> = {
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

/** examples/beispiel/npcs/fenn — quickstats arrive as YAML numbers. */
const NPC_FM: Record<string, unknown> = {
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
    expect(keys("location")).toEqual(["name", "chapter", "roll20-page"]);
    expect(keys("chapter")).toEqual(["title", "status"]);
  });

  test("neither the id nor the kind is ever a field (the rename cascade owns the id)", () => {
    for (const kind of ["scene", "npc", "location", "chapter"] as const) {
      expect(keys(kind)).not.toContain("id");
      expect(keys(kind)).not.toContain("kind");
    }
  });

  test("the kinds without a typed form get no form at all", () => {
    for (const kind of ["campaign", "session", "inbox", "glossary", "unknown"] as const) {
      expect(propertiesFieldsFor(kind)).toBe(undefined);
      expect(propertiesKindLabel(kind)).toBe(undefined);
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
  test("a scene starts with exactly what stands in the file", () => {
    expect(propertiesFormValues(fields("scene"), SCENE_FM)).toEqual({
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
    const values = propertiesFormValues(fields("npc"), NPC_FM);
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
      "roll20-page": 12,
      chapter: { nested: true },
    });
    expect(values["roll20-page"]).toEqual({ kind: "text", text: "12" });
    expect(values.chapter).toEqual({ kind: "text", text: "" });
  });
});

describe("propertiesPatch", () => {
  const sceneFields = fields("scene");
  const npcFields = fields("npc");

  /** The values of a file, with single fields overridden. */
  function edited(
    fieldList: readonly PropertiesField[],
    properties: Record<string, unknown>,
    changes: FormValues,
  ): { initial: FormValues; current: FormValues } {
    const initial = propertiesFormValues(fieldList, properties);
    return { initial, current: { ...initial, ...changes } };
  }

  test("an untouched form patches nothing at all", () => {
    const initial = propertiesFormValues(sceneFields, SCENE_FM);
    expect(propertiesPatch(sceneFields, initial, initial)).toEqual({});
    // `handouts: []` stays exactly that — an empty list is not a change.
    expect(propertiesPatch(sceneFields, initial, { ...initial })).toEqual({});
  });

  test("only the changed field is sent (everything else survives on disk)", () => {
    const { initial, current } = edited(sceneFields, SCENE_FM, {
      status: { kind: "text", text: "played" },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({ status: "played" });
  });

  test("unknown properties keys are never part of the patch", () => {
    const withExtras = { ...SCENE_FM, "prep-time": "20min", weather: ["Regen"] };
    const initial = propertiesFormValues(sceneFields, withExtras);
    const current = { ...initial, title: { kind: "text" as const, text: "Neuer Titel" } };
    const patch = propertiesPatch(sceneFields, initial, current);
    expect(patch).toEqual({ title: "Neuer Titel" });
    expect(Object.keys(patch)).not.toContain("prep-time");
    expect(Object.keys(patch)).not.toContain("weather");
  });

  test("whitespace around a value is not a change", () => {
    const { initial, current } = edited(sceneFields, SCENE_FM, {
      title: { kind: "text", text: "  Von den Schmugglern erwischt  " },
      tags: { kind: "list", items: ["social ", " escape"] },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({});
  });

  test("clearing a field DELETES the key — text, list and pairs alike", () => {
    const scene = edited(sceneFields, SCENE_FM, {
      trigger: { kind: "text", text: "   " },
      tags: { kind: "list", items: [] },
    });
    expect(propertiesPatch(sceneFields, scene.initial, scene.current)).toEqual({
      trigger: null,
      tags: null,
    });
    const npc = edited(npcFields, NPC_FM, { quickstats: { kind: "pairs", entries: [] } });
    expect(propertiesPatch(npcFields, npc.initial, npc.current)).toEqual({ quickstats: null });
  });

  test("a list keeps its order and drops blank entries", () => {
    const { initial, current } = edited(sceneFields, SCENE_FM, {
      npcs: { kind: "list", items: ["jorna", "  ", "fenn"] },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({ npcs: ["jorna", "fenn"] });
  });

  test("an unknown reference id is saved verbatim (the file may follow later)", () => {
    const { initial, current } = edited(sceneFields, SCENE_FM, {
      location: { kind: "text", text: "nordbucht" },
      npcs: { kind: "list", items: ["fenn", "kapitaen-torv"] },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({
      location: "nordbucht",
      npcs: ["fenn", "kapitaen-torv"],
    });
  });

  test("quickstats keep their YAML types: numbers stay numbers, a typed +2 stays text", () => {
    const { initial, current } = edited(npcFields, NPC_FM, {
      quickstats: {
        kind: "pairs",
        entries: [
          { key: "wis", value: "3" },
          { key: "insight", value: "+2" },
          // A row that cannot be written (no name). It is not IN the patch —
          // and it never gets there, because propertiesFormIssues blocks the
          // save while it stands (see „unfinished quickstat rows" below).
          { key: "", value: "wird nicht geschrieben" },
        ],
      },
    });
    expect(propertiesPatch(npcFields, initial, current)).toEqual({
      quickstats: { wis: 3, insight: "+2" },
    });
  });

  test("a quickstat whose VALUE was cleared loses its key — never `key: ''`", () => {
    const { initial, current } = edited(npcFields, NPC_FM, {
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
    const { initial, current } = edited(npcFields, NPC_FM, {
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

  test("an unknown status value survives an edit of another field (degrade)", () => {
    const odd = { ...SCENE_FM, status: "onhold" };
    const { initial, current } = edited(sceneFields, odd, {
      title: { kind: "text", text: "Anderer Titel" },
    });
    expect(propertiesPatch(sceneFields, initial, current)).toEqual({ title: "Anderer Titel" });
  });
});

describe("canSubmitProperties", () => {
  test("a blank title/name is not a save", () => {
    const sceneFields = fields("scene");
    const values = propertiesFormValues(sceneFields, SCENE_FM);
    expect(canSubmitProperties(sceneFields, values)).toBe(true);
    expect(
      canSubmitProperties(sceneFields, { ...values, title: { kind: "text", text: "  " } }),
    ).toBe(false);
    const npcFields = fields("npc");
    expect(
      canSubmitProperties(npcFields, {
        ...propertiesFormValues(npcFields, NPC_FM),
        name: { kind: "text", text: "" },
      }),
    ).toBe(false);
  });
});

describe("unfinished quickstat rows block the save", () => {
  const npcFields = fields("npc");
  const values = propertiesFormValues(npcFields, NPC_FM);
  const withStats = (entries: { key: string; value: string }[]): FormValues => ({
    ...values,
    quickstats: { kind: "pairs", entries },
  });

  test("a file's own rows are fine — nothing to complain about", () => {
    expect(propertiesFormIssues(npcFields, values)).toEqual({});
    // An empty row (the „Zeile hinzufügen" state) and a name whose value was
    // cleared (= delete this key) are both legitimate.
    expect(
      propertiesFormIssues(
        npcFields,
        withStats([
          { key: "insight", value: "2" },
          { key: "wis", value: "" },
          { key: "", value: "" },
        ]),
      ),
    ).toEqual({});
  });

  test("a value without a name is named out loud instead of being dropped", () => {
    const issues = propertiesFormIssues(
      npcFields,
      withStats([
        { key: "insight", value: "2" },
        { key: "  ", value: "+3" },
      ]),
    );
    expect(issues.quickstats).toBe("Zeile ohne Namen — Name ergänzen oder Zeile entfernen.");
  });

  test("the same name twice is refused — YAML would swallow the first value", () => {
    const issues = propertiesFormIssues(
      npcFields,
      withStats([
        { key: "insight", value: "2" },
        { key: "insight", value: "3" },
      ]),
    );
    expect(issues.quickstats).toBe(
      'Name „insight" doppelt — jeder Name darf nur einmal vorkommen.',
    );
  });

  test("a scene's own properties is fine as it stands", () => {
    const sceneFields = fields("scene");
    expect(propertiesFormIssues(sceneFields, propertiesFormValues(sceneFields, SCENE_FM))).toEqual(
      {},
    );
  });
});

describe("the npcs list holds ids, not names (#70 audit)", () => {
  const sceneFields = fields("scene");
  const initial = propertiesFormValues(sceneFields, SCENE_FM);
  const withNpcs = (items: string[]): FormValues => ({
    ...initial,
    npcs: { kind: "list", items },
  });

  test("a new free-text entry blocks the save and says the rule", () => {
    // The server refuses it with a 400 — saying it here makes that a line
    // under the field instead of a failed save.
    const issues = propertiesFormIssues(sceneFields, withNpcs(["fenn", "Alte Fischerin"]), initial);
    expect(issues.npcs).toBe(
      '„Alte Fischerin" ist keine id — nur Kleinbuchstaben, Ziffern und Bindestriche.',
    );
  });

  test("ids are fine, known or not — an unknown one is created on save", () => {
    expect(propertiesFormIssues(sceneFields, withNpcs(["fenn", "holm"]), initial)).toEqual({});
  });

  test("free text the FILE already carries is exempt — such a scene stays savable", () => {
    // A campaign migrated from the file era can hold anything in that list
    // (no foreign keys, schema.ts rule 1), and an unrelated save re-sends it.
    const stored = withNpcs(["fenn", "Alte Fischerin"]);
    expect(propertiesFormIssues(sceneFields, stored, stored)).toEqual({});
    // …and an untouched form with such a value is not "dirty" either.
    expect(hasPropertiesChanges(sceneFields, stored, stored)).toBe(false);
  });
});

describe("hasPropertiesChanges", () => {
  const sceneFields = fields("scene");
  const npcFields = fields("npc");
  const initial = propertiesFormValues(sceneFields, SCENE_FM);

  test("an untouched form has nothing to discard", () => {
    expect(hasPropertiesChanges(sceneFields, initial, initial)).toBe(false);
    // Whitespace is not work either (same rule the patch uses).
    expect(
      hasPropertiesChanges(sceneFields, initial, {
        ...initial,
        title: { kind: "text", text: `  ${SCENE_FM.title as string}  ` },
      }),
    ).toBe(false);
  });

  test("a changed field is work — and so is an unfinished quickstat row", () => {
    expect(
      hasPropertiesChanges(sceneFields, initial, {
        ...initial,
        status: { kind: "text", text: "played" },
      }),
    ).toBe(true);
    // The invalid row produces no patch at all, so the guard has to ask the
    // issues as well — otherwise Esc would throw it away silently.
    const npcInitial = propertiesFormValues(npcFields, NPC_FM);
    const stats = npcInitial.quickstats;
    if (stats?.kind !== "pairs") throw new Error("quickstats is not a pairs field");
    const nameless: FormValues = {
      ...npcInitial,
      quickstats: { kind: "pairs", entries: [...stats.entries, { key: "", value: "+1" }] },
    };
    expect(propertiesPatch(npcFields, npcInitial, nameless)).toEqual({});
    expect(hasPropertiesChanges(npcFields, npcInitial, nameless)).toBe(true);
  });
});

describe("commitPendingText", () => {
  const sceneFields = fields("scene");
  const values = propertiesFormValues(sceneFields, SCENE_FM);

  test("text still standing in a chip input is folded into its list", () => {
    const committed = commitPendingText(sceneFields, values, { tags: "combat" });
    expect(committed.tags).toEqual({ kind: "list", items: ["social", "escape", "combat"] });
    // …and the patch sees it, so „Speichern" straight after typing works.
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
      { id: "01-salzhafen", title: "Kapitel 1: Der Leuchtturm", groups: [] },
    ],
    npcs: [
      { path: "npcs/fenn", id: "fenn", name: "Fenn", status: "alive" },
      { path: "npcs/jorna", id: "jorna", name: "Hafenmeisterin Jorna", status: "alive" },
    ],
    locations: [
      { path: "locations/leuchtturm", id: "leuchtturm", name: "Der Leuchtturm" },
    ],
    sessions: [],
  };

  test("the options are the ids that HAVE a file, labelled with their name", () => {
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

  test("a select offers the value that stands in the file, known or not", () => {
    const known = [
      { value: "draft", label: "Entwurf" },
      { value: "ready", label: "bereit" },
    ];
    expect(selectOptions(known, "ready")).toBe(known);
    expect(selectOptions(known, "")).toBe(known);
    expect(selectOptions(known, "onhold")).toEqual([...known, { value: "onhold", label: "onhold" }]);
  });

  test("the file's unknown value stays selectable after the DM clicked away", () => {
    const known = [
      { value: "draft", label: "Entwurf" },
      { value: "ready", label: "bereit" },
    ];
    // Open on `onhold`, switch to a known value: the odd one must still be in
    // the list, or the DM could never put it back (issue #42 review).
    expect(selectOptions(known, "draft", "onhold")).toEqual([
      ...known,
      { value: "onhold", label: "onhold" },
    ]);
    // Cleared to „nicht gesetzt" — same thing, the file's value is still there.
    expect(selectOptions(known, "", "onhold")).toEqual([
      ...known,
      { value: "onhold", label: "onhold" },
    ]);
    // Both odd (cannot happen through the select, but no duplicate options).
    expect(selectOptions(known, "onhold", "onhold")).toEqual([
      ...known,
      { value: "onhold", label: "onhold" },
    ]);
    // A known initial adds nothing.
    expect(selectOptions(known, "draft", "ready")).toBe(known);
  });
});

// --- the write ---------------------------------------------------------------

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Answer the first request with `first`, every later one with `then`. */
function answer(
  first: { status: number; body: unknown },
  then: { status: number; body: unknown } = first,
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const chosen = calls.length === 0 ? first : then;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return Promise.resolve(
      new Response(JSON.stringify(chosen.body), {
        status: chosen.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

const FILE: FileResponse = {
  path: "npcs/fenn",
  kind: "npc",
  properties: NPC_FM,
  body: "",
  rev: 42,
  raw: "",
};

describe("writePropertiesForm", () => {
  test("PATCHes the file with the rev the dialog was seeded with", async () => {
    const calls = answer({ status: 200, body: FILE });
    const result = await writePropertiesForm("beispiel", "npcs/fenn", 42, { role: "Kundschafter" });
    expect(result).toEqual({ ok: true, file: FILE });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("/api/beispiel/properties");
    expect(calls[0]?.body).toEqual({
      path: "npcs/fenn",
      rev: 42,
      patch: { role: "Kundschafter" },
    });
  });

  test("409 means nothing was written; the file is re-read for the next attempt", async () => {
    const calls = answer(
      { status: 409, body: { error: "file changed on disk", rev: 99 } },
      { status: 200, body: { ...FILE, rev: 99 } },
    );
    const result = await writePropertiesForm("beispiel", "npcs/fenn", 42, { role: "X" });
    expect(result.ok).toBe(false);
    expect(result.file?.rev).toBe(99);
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.url).toBe("/api/beispiel/file?path=npcs%2Ffenn");
  });

  test("a failed reload after the conflict keeps the conflict, not a crash", async () => {
    answer({ status: 409, body: { error: "file changed on disk" } });
    expect(await writePropertiesForm("beispiel", "npcs/fenn", 42, { role: "X" })).toEqual({
      ok: false,
    });
  });

  test("every other failure throws (the dialog shows the error line)", async () => {
    answer({ status: 500, body: { error: "boom" } });
    await expect(
      writePropertiesForm("beispiel", "npcs/fenn", 42, { role: "X" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
