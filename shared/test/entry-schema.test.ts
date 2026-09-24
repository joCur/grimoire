// The consistency test over the generator's reply schemas.
//
// Two kinds of schema are here. The WRITTEN ones — a scene's, a schema file
// in ../schema, plain JSON on disk — can slowly disagree with the code that
// reads the same data; points 1 and 2 are what stop it, asserting schema by
// schema against the definitions the rest of the app already uses. A DERIVED
// schema (an npc's and a location's, from their zod schemas via
// `z.toJSONSchema`, ADR #31) cannot drift from its entity — it is the entity
// — so for it only point 3 has to hold: the derivation must come out in the
// form the providers enforce.
//
//   1. the `properties` of a written schema ARE its kind's field list,
//      in order — the same list the dialog is built from. A
//      schema that knew a field the dialog does not would be a model writing
//      something the DM cannot edit; a schema that forgot one would be a
//      field no run can ever fill.
//   2. a `select` offers the format's own value set, a required field is not
//      nullable, and an optional one is.
//   3. strict mode, for every schema: no keyword OpenAI rejects (`pattern`,
//      `format`, the length and range bounds), `additionalProperties: false`
//      everywhere, every property in `required`. A rejected schema is a 400
//      on EVERY call and therefore a permanent, silent downgrade for the
//      whole process (server/src/llm-provider.ts).
//   4. a NEW scene can only be a draft; an existing one keeps the status the
//      DM gave it — the whole difference between the create schemas and the
//      augment schemas.
//   5. the outline names the same scene types, ids and bounds the server's
//      semantic validation reads, and is strict-mode shaped too.
//   6. a copy per call, because both transports serialize it into a body.

import { describe, expect, test } from "bun:test";
import { SCENE_TYPES } from "../src/types";
import { ENTITY_SLUG } from "../src/slug";
import {
  propertyFieldDef,
  PROPERTY_FIELDS,
  type FieldControl,
  type PropertiesKind,
} from "../src/property-fields";
import {
  MAX_OUTLINE_PROPOSALS,
  MAX_OUTLINE_SCENES,
  OUTLINE_ID_DESCRIPTION,
  outlineJsonSchema,
} from "../src/outline-schema";
import {
  GENERATED_ENTRY_KINDS,
  entryJsonSchema,
  entryReplySchema,
  entrySchemaName,
  type EntryMode,
} from "../src/entry-schema";
import { z } from "zod";
import { locationReplySchema } from "../src/location";
import { npcReplySchema } from "../src/npc";

/** The keywords OpenAI's strict mode refuses — see point 3 above. */
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

/** The kinds whose reply schema is written, a schema file in ../schema (points 1 and 2). */
const WRITTEN_KINDS = GENERATED_ENTRY_KINDS;

/** The `properties` half of a written entry schema, field by field. */
function entryFields(
  kind: (typeof WRITTEN_KINDS)[number],
  mode: EntryMode,
): Record<string, Record<string, unknown>> {
  return at(entryJsonSchema(kind, mode), ["properties", "properties", "properties"]) as Record<
    string,
    Record<string, unknown>
  >;
}

/** The JSON type a control's value carries — the whole mapping, spelled out. */
const TYPE_OF_CONTROL: Record<FieldControl, string> = {
  text: "string",
  textarea: "string",
  select: "string",
  reference: "string",
  references: "array",
  chips: "array",
  pairs: "array",
};

const MODES: EntryMode[] = ["create", "augment"];

describe("the entry schemas", () => {
  test("the properties ARE the kind's field list, in order, plus the id", () => {
    for (const kind of WRITTEN_KINDS) {
      for (const mode of MODES) {
        expect(Object.keys(entryFields(kind, mode)), `${kind}/${mode}`).toEqual([
          "id",
          ...PROPERTY_FIELDS[kind as PropertiesKind].map((field) => field.key),
        ]);
      }
    }
  });

  test("every field carries its control's type, its values, and its nullability", () => {
    for (const kind of WRITTEN_KINDS) {
      for (const mode of MODES) {
        const fields = entryFields(kind, mode);
        for (const def of PROPERTY_FIELDS[kind as PropertiesKind]) {
          const label = `${kind}/${mode}/${def.key}`;
          const node = fields[def.key] as Record<string, unknown>;
          const base = TYPE_OF_CONTROL[def.control];
          // A field the entity cannot lose is a plain type; every other one
          // is nullable, because strict mode knows no optional property and
          // the server reads `null` as „not given".
          const draftOnly = kind === "scene" && mode === "create" && def.key === "status";
          if (def.required === true || draftOnly) {
            expect(node.type, label).toBe(base);
          } else {
            expect(node.type, label).toEqual([base, "null"]);
          }
          if (def.control === "select" && !draftOnly) {
            expect(node.enum, label).toEqual([...(def.values ?? []), null]);
          }
          if (def.control !== "select") expect(node.enum, label).toBeUndefined();
          if (base === "array") expect(node.items, label).toEqual({ type: "string" });
        }
      }
    }
  });

  test("a NEW scene is a draft; an existing one keeps its status", () => {
    expect(entryFields("scene", "create").status).toMatchObject({
      type: "string",
      enum: ["draft"],
    });
    const existing = entryFields("scene", "augment").status as { enum: unknown[] };
    expect(existing.enum).toEqual([...(propertyFieldDef("scene", "status")?.values ?? []), null]);
    expect(existing.enum).toContain("played");
  });

  test("the schema name says kind and run, and nothing else does", () => {
    expect(entrySchemaName("scene", "create")).toBe("scene");
    // The augment run prefixes the same kind: the correction turn names the
    // schema, so the name the model was handed says kind AND run.
    for (const kind of GENERATED_ENTRY_KINDS) {
      expect(entrySchemaName(kind, "augment")).toBe(`augmented_${kind}`);
    }
  });

  test("a copy every call — both transports serialize it into a body", () => {
    const first = entryJsonSchema("scene", "create");
    expect(entryJsonSchema("scene", "create")).not.toBe(first);
    expect(entryJsonSchema("scene", "create")).toEqual(first);
    const reply = entryReplySchema("scene", "create");
    expect(reply.name).toBe("scene");
    expect(typeof reply.description).toBe("string");
    expect(reply.schema).toEqual(entryJsonSchema("scene", "create"));
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

  test("a copy every call", () => {
    const first = outlineJsonSchema();
    expect(outlineJsonSchema()).not.toBe(first);
    expect(outlineJsonSchema()).toEqual(first);
  });
});

describe("every schema", () => {
  const written = [
    ...GENERATED_ENTRY_KINDS.flatMap((kind) =>
      MODES.map((mode) => [`${kind}/${mode}`, entryJsonSchema(kind, mode)] as const),
    ),
    ["outline", outlineJsonSchema()] as const,
  ];
  // The npc's and the location's replies are derived from their zod schemas,
  // so the check runs on exactly what `z.toJSONSchema` makes of them.
  const all = [
    ...written,
    ["npc", z.toJSONSchema(npcReplySchema) as Record<string, unknown>] as const,
    ["location", z.toJSONSchema(locationReplySchema) as Record<string, unknown>] as const,
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

  test("a written schema carries the name and the description the provider request sends", () => {
    for (const [label, schema] of written) {
      expect(typeof schema.title, label).toBe("string");
      expect(typeof schema.description, label).toBe("string");
    }
  });
});
