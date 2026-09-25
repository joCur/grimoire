// The consistency test over the generator's reply schemas.
//
// Two kinds of schema are here. The OUTLINE's is written — plain JSON in
// ../schema — and can slowly disagree with the validation that reads the
// same data; its tests assert it against the constants the server checks
// with. A scene's, an npc's and a location's reply schema is DERIVED from the
// entity's zod schema via `z.toJSONSchema` (ADR #31) and cannot drift from
// its entity — it is the entity — so for them only the form has to hold:
//
//   1. strict mode, for every schema: no keyword OpenAI rejects (`pattern`,
//      `format`, the length and range bounds), `additionalProperties: false`
//      everywhere, every property in `required`. A rejected schema is a 400
//      on EVERY call and therefore a permanent, silent downgrade for the
//      whole process (server/src/llm-provider.ts).
//   2. a NEW scene can only be a draft; an existing one keeps the status the
//      DM gave it — the one difference between the two scene replies.
//   3. the outline names the same scene types, ids and bounds the server's
//      semantic validation reads.
//   4. a copy per call, because both transports serialize it into a body.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ENTITY_SLUG } from "../src/slug";
import {
  MAX_OUTLINE_PROPOSALS,
  MAX_OUTLINE_SCENES,
  OUTLINE_ID_DESCRIPTION,
  outlineJsonSchema,
} from "../src/outline-schema";
import { locationReplySchema } from "../src/location";
import { npcReplySchema } from "../src/npc";
import {
  SCENE_STATUSES,
  SCENE_TYPES,
  newSceneReplySchema,
  sceneReplySchema,
} from "../src/scene";

/** The keywords OpenAI's strict mode refuses — see point 1 above. */
const UNSUPPORTED = [
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
];

/** Every place any of `UNSUPPORTED` appears, as a dotted path. */
function unsupportedPaths(node: unknown, path: string[] = []): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => unsupportedPaths(item, [...path, `${i}`]));
  }
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    UNSUPPORTED.includes(key) ? [[...path, key].join(".")] : unsupportedPaths(value, [...path, key]),
  );
}

/** Every object node of the tree, root included. */
function objectNodes(node: unknown): Array<Record<string, unknown>> {
  if (node === null || typeof node !== "object") return [];
  const self = node as Record<string, unknown>;
  const nested = Object.values(self).flatMap(objectNodes);
  const type = self.type;
  return type === "object" || (Array.isArray(type) && type.includes("object"))
    ? [self, ...nested]
    : nested;
}

/** A nested node of a schema, by path. */
function at(schema: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let node = schema;
  for (const key of path) node = node[key] as Record<string, unknown>;
  return node;
}

/** A derived reply schema, as the providers receive it. */
function derived(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema) as Record<string, unknown>;
}

describe("the scene replies", () => {
  test("a NEW scene is a draft; an existing one keeps its status", () => {
    expect(at(derived(newSceneReplySchema), ["properties", "status"])).toEqual({
      type: "string",
      enum: ["draft"],
    });
    expect(at(derived(sceneReplySchema), ["properties", "status"])).toEqual({
      type: "string",
      enum: [...SCENE_STATUSES],
    });
  });

  test("an optional field is nullable, and the lists are lists", () => {
    const fields = at(derived(sceneReplySchema), ["properties"]);
    expect(fields.trigger).toEqual({ type: ["string", "null"] });
    expect(fields.location).toEqual({ type: ["string", "null"] });
    for (const list of ["npcs", "handouts", "tags", "warnings"]) {
      expect(fields[list], list).toEqual({ type: "array", items: { type: "string" } });
    }
  });
});

describe("the outline schema", () => {
  const scenes = () => at(outlineJsonSchema(), ["properties", "scenes"]);
  const sceneProps = () => at(outlineJsonSchema(), ["properties", "scenes", "items", "properties"]);
  const npcs = () => at(outlineJsonSchema(), ["properties", "npcs"]);
  const locations = () => at(outlineJsonSchema(), ["properties", "locations"]);

  test("names the same scene types, ids and bounds as the validation", () => {
    expect(sceneProps().type).toEqual({ type: "string", enum: [...SCENE_TYPES] });
    // The id rule and the bounds travel as PROSE — strict mode allows
    // neither `pattern` nor `maxItems` — but they still say the numbers and
    // the pattern the server's own checks read.
    expect(sceneProps().id).toEqual({ type: "string", description: OUTLINE_ID_DESCRIPTION });
    expect(OUTLINE_ID_DESCRIPTION).toContain(ENTITY_SLUG.source);
    expect(scenes().description).toContain(String(MAX_OUTLINE_SCENES));
    // The proposals are bounded together — both lists say so.
    expect(npcs().description).toContain(String(MAX_OUTLINE_PROPOSALS));
    expect(locations().description).toContain(String(MAX_OUTLINE_PROPOSALS));
    // The new npcs and the new locations are two lists of their own: an item
    // names neither a kind nor anything beside its id, name and summary.
    for (const list of [npcs(), locations()]) {
      expect(at(list, ["items"]).required).toEqual(["id", "name", "summary"]);
      expect(at(list, ["items", "properties", "id"])).toEqual({
        type: "string",
        description: OUTLINE_ID_DESCRIPTION,
      });
    }
  });

  test("the genuinely optional fields are nullable instead of absent", () => {
    expect(sceneProps().location).toMatchObject({ type: ["string", "null"] });
    expect(sceneProps().sourceExcerpt).toMatchObject({ type: ["object", "null"] });
  });

  test("carries the name and the description the provider request sends", () => {
    expect(typeof outlineJsonSchema().title).toBe("string");
    expect(typeof outlineJsonSchema().description).toBe("string");
  });

  test("a copy every call", () => {
    const first = outlineJsonSchema();
    expect(outlineJsonSchema()).not.toBe(first);
    expect(outlineJsonSchema()).toEqual(first);
  });
});

describe("every schema", () => {
  const all = [
    ["outline", outlineJsonSchema()] as const,
    ["scene/create", derived(newSceneReplySchema)] as const,
    ["scene/augment", derived(sceneReplySchema)] as const,
    ["npc", derived(npcReplySchema)] as const,
    ["location", derived(locationReplySchema)] as const,
  ];

  test("is strict-mode shaped: every key required, nothing extra allowed", () => {
    for (const [label, schema] of all) {
      expect(schema.additionalProperties, label).toBe(false);
      expect(unsupportedPaths(schema), label).toEqual([]);
      for (const node of objectNodes(schema)) {
        expect(node.additionalProperties, label).toBe(false);
        // Strict mode has no optional properties.
        expect(node.required, label).toEqual(Object.keys(node.properties as object));
      }
    }
    // The guard has to be able to FIND an offender, or it guards nothing.
    expect(unsupportedPaths({ properties: { a: { items: { pattern: "x" } } } })).toEqual([
      "properties.a.items.pattern",
    ]);
  });
});
