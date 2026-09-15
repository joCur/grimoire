// The document reply schemas (issue #107, PO decision of 15.09.).
//
// Four things have to hold, and each of them is a bug that would be silent:
//
//   1. the `properties` of a kind ARE its field list — the same list the
//      properties dialog is built from. A schema that knew a field the dialog
//      does not would be a model writing something the DM cannot edit; a
//      schema that forgot one would be a field no run can ever fill.
//   2. strict mode: no keyword OpenAI rejects, `additionalProperties: false`
//      everywhere, every property in `required`, and the optional ones
//      nullable instead. A rejected schema is a 400 on EVERY call and
//      therefore a permanent, silent downgrade for the whole process
//      (llm-provider.ts).
//   3. a new scene can only be a draft; an existing one keeps the status the
//      DM gave it — that is the difference between the two modes.
//   4. a fresh object per call, because both transports serialize it into a
//      request body.

import { describe, expect, test } from "bun:test";
import { NPC_STATUSES, SCENE_STATUSES, SCENE_TYPES } from "../src/types";
import { PROPERTY_FIELDS, type PropertiesKind } from "../src/property-fields";
import {
  DOCUMENT_KINDS,
  documentJsonSchema,
  documentReplySchema,
  documentSchemaName,
  propertiesJsonSchema,
  type DocumentKind,
  type DocumentMode,
} from "../src/document-schema";

/** The keywords OpenAI's strict mode refuses — same list as the outline's. */
const UNSUPPORTED = ["pattern", "minItems", "maxItems", "minLength", "maxLength", "format"];

function unsupportedPaths(node: unknown, path: string[] = []): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => unsupportedPaths(item, [...path, `${i}`]));
  }
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    UNSUPPORTED.includes(key) ? [[...path, key].join(".")] : unsupportedPaths(value, [...path, key]),
  );
}

/** Every `properties`/`items` object of the tree, root included. */
function objectNodes(node: unknown): Array<Record<string, unknown>> {
  if (node === null || typeof node !== "object") return [];
  const self = node as Record<string, unknown>;
  const nested = Object.values(self).flatMap(objectNodes);
  return self.type === "object" || (Array.isArray(self.type) && self.type.includes("object"))
    ? [self, ...nested]
    : nested;
}

const MODES: DocumentMode[] = ["create", "augment"];

describe("the document reply schemas", () => {
  test("the properties ARE the kind's field list, plus the id", () => {
    for (const kind of DOCUMENT_KINDS) {
      for (const mode of MODES) {
        const props = propertiesJsonSchema(kind, mode).properties as Record<string, unknown>;
        expect(Object.keys(props), `${kind}/${mode}`).toEqual([
          "id",
          ...PROPERTY_FIELDS[kind as PropertiesKind].map((field) => field.key),
        ]);
      }
    }
  });

  test("a select offers the format's own values; a required field is not nullable", () => {
    const scene = propertiesJsonSchema("scene", "augment").properties as Record<string, unknown>;
    expect(scene.type).toEqual({ type: ["string", "null"], enum: [...SCENE_TYPES, null] });
    expect(scene.status).toEqual({ type: ["string", "null"], enum: [...SCENE_STATUSES, null] });
    // `title` is the field a scene cannot lose, so it is a plain string.
    expect(scene.title).toEqual({ type: "string" });
    const npc = propertiesJsonSchema("npc", "create").properties as Record<string, unknown>;
    expect(npc.status).toEqual({ type: ["string", "null"], enum: [...NPC_STATUSES, null] });
    expect(npc.name).toEqual({ type: "string" });
    // A list field, and the key/value field as the pair LIST strict mode
    // needs (a free mapping cannot be expressed at all).
    expect(scene.npcs).toEqual({ type: ["array", "null"], items: { type: "string" } });
    const quickstats = npc.quickstats as Record<string, unknown>;
    expect(quickstats.type).toEqual(["array", "null"]);
    expect((quickstats.items as Record<string, unknown>).required).toEqual(["key", "value"]);
  });

  test("a NEW scene is a draft; an existing one keeps its status", () => {
    const created = propertiesJsonSchema("scene", "create").properties as Record<string, unknown>;
    expect(created.status).toMatchObject({ type: "string", enum: ["draft"] });
    const existing = propertiesJsonSchema("scene", "augment").properties as Record<string, unknown>;
    expect((existing.status as { enum: unknown[] }).enum).toContain("played");
  });

  test("every schema is strict-mode shaped", () => {
    for (const kind of DOCUMENT_KINDS) {
      for (const mode of MODES) {
        const label = `${kind}/${mode}`;
        const schema = documentJsonSchema(kind, mode);
        expect(schema.required, label).toEqual(["properties", "body", "warnings"]);
        expect(unsupportedPaths(schema), label).toEqual([]);
        for (const node of objectNodes(schema)) {
          expect(node.additionalProperties, label).toBe(false);
          // Strict mode has no optional properties.
          expect(node.required, label).toEqual(Object.keys(node.properties as object));
        }
      }
    }
    // The guard has to be able to FIND an offender, or it guards nothing.
    expect(unsupportedPaths({ properties: { a: { pattern: "x" } } })).toEqual([
      "properties.a.pattern",
    ]);
  });

  test("the schema name says kind and mode, and nothing else does", () => {
    expect(documentSchemaName("scene", "create")).toBe("scene_document");
    expect(documentSchemaName("npc", "create")).toBe("npc_document");
    expect(documentSchemaName("location", "create")).toBe("location_document");
    // The augment run is ONE name for all three kinds: the correction turn
    // names it, and „augmented_document" is what the model was handed.
    for (const kind of DOCUMENT_KINDS) {
      expect(documentSchemaName(kind, "augment")).toBe("augmented_document");
    }
  });

  test("a fresh object every call — both transports serialize it into a body", () => {
    const first = documentJsonSchema("scene", "create");
    expect(documentJsonSchema("scene", "create")).not.toBe(first);
    expect(documentJsonSchema("scene", "create")).toEqual(first);
    const reply = documentReplySchema("npc", "create");
    expect(reply.name).toBe("npc_document");
    expect(reply.description).toContain("Figur");
    expect(reply.schema).toEqual(documentJsonSchema("npc" as DocumentKind, "create"));
  });
});
