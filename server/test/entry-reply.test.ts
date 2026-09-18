// The entry reply: one schema-forced JSON object per kind.
//
// What this suite is about is the SEAM between the model and the store: the
// object comes in, the normalized properties and the body come out, and
// everything that is content — a kebab id, a known scene type, references
// that resolve — belongs to the validators (generator.test.ts,
// generate-pipeline.test.ts, augment.test.ts).
//
// So the cases here are the ones the schema cannot cover:
//   * a reply that is not the object at all (an endpoint that ignored
//     `response_format`, a model that answered prose or one rendered entry
//     with a properties block on top),
//   * the tolerant way in — a fence, prose around it, one `jsonrepair` pass,
//   * `null` read as „not given", so the properties carry no empty keys,
//   * the `{ key, value }` list folded back into the `quickstats` mapping,
//   * the PO case: a body whose German quotation marks are closed
//     with an ASCII `"` travels byte for byte, because the transport escapes
//     it and nobody hand-writes the JSON any more.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOT_AN_ENTRY_ERROR,
  REPAIRED_ENTRY_WARNING,
  parseEntryReply,
  parseJsonReply,
  toReplyProperties,
  type EntryReply,
} from "../src/entry-reply";

/**
 * The stored properties of the example campaign's Jorna — read from the
 * fixture instead of copied, because the point of the round-trip case is that
 * the shapes a REAL entry carries survive: `quickstats` as a mapping, and its
 * values as the bare numbers the campaign has always held.
 */
const JORNA = (() => {
  const file = join(import.meta.dir, "..", "..", "fixtures", "beispiel", "npc-jorna.json");
  const entry = JSON.parse(readFileSync(file, "utf8")) as {
    properties: Record<string, unknown>;
  };
  return entry.properties;
})();

/** The PO case: opening U+201E, closed with the ASCII `"`. */
const PO_LINE = '„Wer nachts hier steht, hat was zu verbergen", murrt die Wache.';

const SCENE_BODY = `## Flow\n\n${PO_LINE}\n`;

function sceneObject(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    properties: {
      id: "night-watch-quay",
      title: "Nachtwache am Kai",
      type: "planned",
      trigger: null,
      chapter: "01-salzhafen",
      location: null,
      npcs: ["fenn"],
      handouts: [],
      tags: ["stealth"],
      status: "draft",
      ...over,
    },
    body: SCENE_BODY,
    warnings: ["Der Quelltext nennt keinen DC — DC 13 gesetzt."],
  });
}

function read(
  raw: string,
  kind: "scene" | "npc" | "location" = "scene",
  mode: "create" | "augment" = "create",
): EntryReply {
  const outcome = parseEntryReply(raw, kind, mode);
  if (!outcome.ok) throw new Error(`expected a reply, got: ${outcome.errors.join(" | ")}`);
  return outcome.reply;
}

function errors(
  raw: string,
  kind: "scene" | "npc" | "location" = "scene",
  mode: "create" | "augment" = "create",
): string[] {
  const outcome = parseEntryReply(raw, kind, mode);
  if (outcome.ok) throw new Error("expected errors");
  return outcome.errors;
}

describe("parseEntryReply", () => {
  test("reads the object as the two halves the store takes", () => {
    const reply = read(sceneObject());
    expect(reply.properties.id).toBe("night-watch-quay");
    expect(reply.properties.title).toBe("Nachtwache am Kai");
    expect(reply.properties.status).toBe("draft");
    expect(reply.body.trim()).toBe(SCENE_BODY.trim());
    expect(reply.warnings).toEqual(["Der Quelltext nennt keinen DC — DC 13 gesetzt."]);
  });

  test("the body survives the PO spelling byte for byte", () => {
    // The whole reason the reply is an object the TRANSPORT serializes: an
    // ASCII `"` inside a German quotation ends a hand-written JSON string,
    // and answering with the entry as one markdown text would trade that for
    // guessing where the properties end. Here it is simply a character in a
    // string.
    expect(read(sceneObject()).body).toContain(PO_LINE);
  });

  test("a null value means the key is left out", () => {
    const reply = read(sceneObject());
    // `trigger` and `location` were null, `handouts` an empty list.
    expect(Object.hasOwn(reply.properties, "trigger")).toBe(false);
    expect(Object.hasOwn(reply.properties, "location")).toBe(false);
    expect(Object.hasOwn(reply.properties, "handouts")).toBe(false);
  });

  test("the properties keep the field list's order", () => {
    const shuffled = JSON.stringify({
      properties: { status: "draft", title: "Kai", type: "planned", id: "kai" },
      body: "## Flow\n",
      warnings: [],
    });
    expect(Object.keys(read(shuffled).properties)).toEqual(["id", "title", "type", "status"]);
  });

  test("a key/value list becomes the quickstats mapping", () => {
    const npc = JSON.stringify({
      properties: {
        id: "grella",
        name: "Grella",
        status: "alive",
        quickstats: [
          { key: "wis", value: "+2" },
          { key: "passive-perception", value: "13" },
        ],
      },
      body: "## Will\n\nIhren Anteil.\n",
      warnings: [],
    });
    const reply = read(npc, "npc");
    // The VALUES stay strings, which is the whole point of the detour: a
    // bare `+2` would lose its plus on the way to a number.
    expect(reply.properties.quickstats).toEqual({ wis: "+2", "passive-perception": "13" });
  });

  test("the stored properties in reply shape are the pair list", () => {
    expect(toReplyProperties("npc", JORNA)).toEqual({
      ...JORNA,
      quickstats: [
        { key: "insight", value: 2 },
        { key: "passive-perception", value: 12 },
      ],
    });
  });

  test("jorna's properties round-trip stored → reply → stored unchanged", () => {
    const shown = toReplyProperties("npc", JORNA);
    const back = read(
      JSON.stringify({ properties: shown, body: "## Will\n\nX\n", warnings: [] }),
      "npc",
    ).properties;
    // Values included: the example campaign carries bare numbers from its own
    // history, and an augment run that merely echoes them back must not turn
    // a 2 into a "2".
    expect(back).toEqual(JORNA);
  });

  test("a fence, prose around it and a single repair all cost no correction turn", () => {
    expect(read(`Hier ist die Szene:\n\n\`\`\`json\n${sceneObject()}\n\`\`\`\n`).properties.id).toBe(
      "night-watch-quay",
    );
    const repaired = read(sceneObject().replace(/}$/, ",}"));
    expect(repaired.properties.id).toBe("night-watch-quay");
    // …and the run says that it had to be repaired.
    expect(repaired.warnings).toContain(REPAIRED_ENTRY_WARNING);
  });

  test("anything that is not the object is the ONE shape error", () => {
    for (const raw of [
      "",
      "kein Objekt",
      // One rendered entry, properties block and all — not the reply object.
      "---\nid: night-watch-quay\nstatus: draft\n---\n\n## Flow\n",
      JSON.stringify([sceneObject()]),
      JSON.stringify({ body: "## Flow\n", warnings: [] }),
    ]) {
      expect(errors(raw)).toEqual([NOT_AN_ENTRY_ERROR]);
    }
    expect(NOT_AN_ENTRY_ERROR).toContain("`properties`");
    expect(NOT_AN_ENTRY_ERROR).toContain("`body`");
    expect(NOT_AN_ENTRY_ERROR).toContain("`warnings`");
  });

  test("a field the kind does not have, and a value of the wrong shape", () => {
    // The message names the offending key AND the fields that exist — an
    // endpoint that ignores the schema gets something to correct.
    const unknown = errors(sceneObject({ mood: "düster" }));
    expect(unknown.join(" ")).toContain('"properties.mood" ist kein Feld dieser Entität');
    expect(unknown.join(" ")).toContain("title");

    expect(errors(sceneObject({ npcs: "fenn" })).join(" ")).toContain(
      '"properties.npcs" muss eine Liste von Strings sein',
    );
    expect(errors(sceneObject({ title: 7 })).join(" ")).toContain(
      '"properties.title" muss ein String sein',
    );
    // A required field the model left empty is an error; an optional one is not.
    expect(errors(sceneObject({ title: null })).join(" ")).toContain(
      '"properties.title" fehlt',
    );
  });

  test("a nullable field the schema HAS falls back to the kind's default", () => {
    // Scene `type` and npc `status` are nullable in the schema (the prompt's
    // „nicht gegeben → null"), and the validators reject an absent one — so
    // „null" has to mean what such an entry has always meant, spelled out in
    // the properties instead of left to every reader.
    const scene = read(sceneObject({ type: null }));
    expect(scene.properties.type).toBe("planned");

    const npc = JSON.stringify({
      properties: { id: "grella", name: "Grella", status: null },
      body: "## Will\n",
      warnings: [],
    });
    expect(read(npc, "npc").properties.status).toBe("unknown");
    // A key with no default is still simply dropped.
    expect(Object.hasOwn(read(npc, "npc").properties, "role")).toBe(false);
  });

  test("a required field of whitespace only is missing, not empty", () => {
    // It trims to "" — which used to be dropped silently, and the entity then
    // fell back to being named after its id.
    expect(errors(sceneObject({ title: "   " })).join(" ")).toContain(
      '"properties.title" fehlt',
    );
    const npc = JSON.stringify({
      properties: { id: "grella", name: " \t ", status: "alive" },
      body: "## Will\n",
      warnings: [],
    });
    expect(errors(npc, "npc").join(" ")).toContain('"properties.name" fehlt');
    const location = JSON.stringify({
      properties: { id: "bucht", name: "" },
      body: "## Atmosphäre\n",
      warnings: [],
    });
    expect(errors(location, "location").join(" ")).toContain('"properties.name" fehlt');
    // …and a field whose SHAPE was wrong is not reported twice.
    expect(errors(sceneObject({ title: 7 }))).toHaveLength(1);
  });

  test("an unknown key fails a create run and is dropped by an augment run", () => {
    // In an augment run the key may be one the DM hand-wrote in the entry the
    // model was SHOWN — the schema cannot let it propose one, so the only way
    // it gets here is an echo, and failing the run over that would make the
    // button unusable for an entry the DM is free to author that way.
    expect(errors(sceneObject({ mood: "düster" })).join(" ")).toContain(
      '"properties.mood" ist kein Feld dieser Entität',
    );
    const augmented = read(sceneObject({ mood: "düster" }), "scene", "augment");
    expect(Object.hasOwn(augmented.properties, "mood")).toBe(false);
    // …and it is still REPORTED, for the one validator that has a rule about
    // such a key (a location may not carry a `status`).
    expect(augmented.ignored).toEqual(["mood"]);
  });

  test("a body that is not a string, and warnings that are not strings", () => {
    const noBody = JSON.stringify({ properties: { id: "kai" }, body: 12, warnings: [] });
    expect(errors(noBody).join(" ")).toContain('"body" muss der Fließtext');
    const badWarnings = JSON.stringify({
      properties: { id: "kai", title: "Kai" },
      body: "## Flow\n",
      warnings: [{ text: "nope" }],
    });
    expect(errors(badWarnings).join(" ")).toContain('"warnings" muss eine Liste von Strings sein');
  });
});

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
