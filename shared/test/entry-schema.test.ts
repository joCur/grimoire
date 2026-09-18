// The one consistency test over the schema files in ../schema.
//
// The schemas are plain JSON on disk, so nothing stops one of them from slowly
// disagreeing with the code that reads the same data. This test is what
// stops it. It never writes a schema and never builds one — it ASSERTS,
// schema by schema, against the definitions the rest of the app already uses:
//
//   1. the `properties` of a kind ARE its property field list, in order —
//      the same list the „Eigenschaften" dialog is built from. A schema that
//      knew a field the dialog does not would be a model writing something
//      the DM cannot edit; a schema that forgot one would be a field no run
//      can ever fill.
//   2. a `select` offers the format's own value set, a required field is not
//      nullable, and an optional one is.
//   3. strict mode: no keyword OpenAI rejects, `additionalProperties: false`
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
  MAX_OUTLINE_ENTRIES,
  MAX_OUTLINE_SCENES,
  OUTLINE_ENTRY_KINDS,
  OUTLINE_ID_DESCRIPTION,
  outlineJsonSchema,
} from "../src/outline-schema";
import {
  GENERATED_ENTRY_KINDS,
  entryJsonSchema,
  entryReplySchema,
  entrySchemaName,
  PAIR_KEY,
  PAIR_VALUE,
  type EntryMode,
} from "../src/entry-schema";

/** The keywords OpenAI's strict mode refuses — see point 3 above. */
const UNSUPPORTED = ["pattern", "minItems", "maxItems", "minLength", "maxLength", "format"];

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

/** The `properties` half of an entry schema, field by field. */
function entryFields(
  kind: (typeof GENERATED_ENTRY_KINDS)[number],
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
    for (const kind of GENERATED_ENTRY_KINDS) {
      for (const mode of MODES) {
        expect(Object.keys(entryFields(kind, mode)), `${kind}/${mode}`).toEqual([
          "id",
          ...PROPERTY_FIELDS[kind as PropertiesKind].map((field) => field.key),
        ]);
      }
    }
  });

  test("every field carries its control's type, its values, and its nullability", () => {
    for (const kind of GENERATED_ENTRY_KINDS) {
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
          // The free key/value map travels as the pair LIST strict mode
          // needs — a mapping cannot be expressed at all.
          if (def.control === "pairs") {
            expect(at(node, ["items"]).required, label).toEqual([PAIR_KEY, PAIR_VALUE]);
          } else if (base === "array") {
            expect(node.items, label).toEqual({ type: "string" });
          }
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
    expect(entrySchemaName("npc", "create")).toBe("npc");
    expect(entrySchemaName("location", "create")).toBe("location");
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
    const reply = entryReplySchema("npc", "create");
    expect(reply.name).toBe("npc");
    expect(reply.description).toContain("Figur");
    expect(reply.schema).toEqual(entryJsonSchema("npc", "create"));
  });
});

describe("the outline schema", () => {
  const scenes = () => at(outlineJsonSchema(), ["properties", "scenes"]);
  const sceneProps = () => at(outlineJsonSchema(), ["properties", "scenes", "items", "properties"]);
  const entries = () => at(outlineJsonSchema(), ["properties", "entries"]);

  test("names the same scene types, ids and bounds as the validation", () => {
    expect(sceneProps().type).toEqual({ type: "string", enum: [...SCENE_TYPES] });
    // The id rule and the bounds travel as PROSE — strict mode allows
    // neither `pattern` nor `maxItems` — but they still say the numbers and
    // the pattern the server's own checks read.
    expect(sceneProps().id).toEqual({ type: "string", description: OUTLINE_ID_DESCRIPTION });
    expect(OUTLINE_ID_DESCRIPTION).toContain(ENTITY_SLUG.source);
    expect(scenes().description).toContain(String(MAX_OUTLINE_SCENES));
    expect(entries().description).toContain(String(MAX_OUTLINE_ENTRIES));
    expect(at(entries(), ["items", "properties", "kind"]).enum).toEqual([...OUTLINE_ENTRY_KINDS]);
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
  const all = [
    ...GENERATED_ENTRY_KINDS.flatMap((kind) =>
      MODES.map((mode) => [`${kind}/${mode}`, entryJsonSchema(kind, mode)] as const),
    ),
    ["outline", outlineJsonSchema()] as const,
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

  test("carries the name and the description the provider request sends", () => {
    for (const [label, schema] of all) {
      expect(typeof schema.title, label).toBe("string");
      expect(typeof schema.description, label).toBe("string");
    }
  });
});
