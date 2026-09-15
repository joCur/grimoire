// The outline schema (issue #107, Zuschnitt 2) and its agreement with the
// semantic validation.
//
// Both providers now FORCE the outline into this schema — a tool call on the
// Claude path, `response_format: json_schema` on the OpenAI path. That only
// helps if the schema and `validateOutlineReply` say the same thing about the
// shape: a schema that allowed a fourth scene type, a longer id or a
// thirteenth scene would be a run that fails validation on a reply the API
// promised was valid, which is the worst of both worlds.
//
// So this test compares the two sources against each other rather than
// against a hand-written copy of either.

import { describe, expect, test } from "bun:test";
import { SCENE_TYPES } from "@grimoire/shared";
import { ENTITY_SLUG } from "@grimoire/shared/slug";
import {
  MAX_OUTLINE_ENTRIES,
  MAX_OUTLINE_SCENES,
  OUTLINE_ENTRY_KINDS,
  OUTLINE_ID_DESCRIPTION,
  outlineJsonSchema,
} from "@grimoire/shared/outline-schema";

/**
 * The keywords OpenAI's strict mode refuses. One of them anywhere in the
 * schema is a 400 on every outline call and therefore a permanent, silent
 * downgrade to plain `json_object` for the whole process — the guard would be
 * gone and nothing would say so (issue #107 review).
 */
const UNSUPPORTED = ["pattern", "minItems", "maxItems", "minLength", "maxLength", "format"];

/** Every place any of `UNSUPPORTED` appears, as a dotted path. */
function unsupportedPaths(node: unknown, path: string[] = []): string[] {
  if (Array.isArray(node)) return node.flatMap((item, i) => unsupportedPaths(item, [...path, `${i}`]));
  if (node === null || typeof node !== "object") return [];
  const entries = Object.entries(node as Record<string, unknown>);
  return entries.flatMap(([key, value]) =>
    UNSUPPORTED.includes(key)
      ? [[...path, key].join(".")]
      : unsupportedPaths(value, [...path, key]),
  );
}

/** A nested property of the schema, by path. */
function at(path: string[]): Record<string, unknown> {
  let node = outlineJsonSchema();
  for (const key of path) node = node[key] as Record<string, unknown>;
  return node;
}

const scenes = () => at(["properties", "scenes"]);
const sceneProps = () => at(["properties", "scenes", "items", "properties"]);
const entries = () => at(["properties", "entries"]);

describe("the outline schema", () => {
  test("names the same scene types, ids and bounds as the validation", () => {
    expect(sceneProps().type).toEqual({ type: "string", enum: [...SCENE_TYPES] });
    // The id rule and the bounds travel as PROSE (see the strict-mode test
    // below) — but they are still built from the constants the server reads.
    expect(sceneProps().id).toEqual({ type: "string", description: OUTLINE_ID_DESCRIPTION });
    expect(OUTLINE_ID_DESCRIPTION).toContain(ENTITY_SLUG.source);
    expect(scenes().description).toContain(String(MAX_OUTLINE_SCENES));
    expect(entries().description).toContain(String(MAX_OUTLINE_ENTRIES));
    expect(at(["properties", "entries", "items", "properties", "kind"]).enum).toEqual([
      ...OUTLINE_ENTRY_KINDS,
    ]);
  });

  test("is strict-mode shaped: every key required, nothing extra allowed", () => {
    const root = outlineJsonSchema();
    expect(root.additionalProperties).toBe(false);
    expect(root.required).toEqual(["scenes", "entries", "warnings"]);
    for (const path of [
      ["properties", "scenes", "items"],
      ["properties", "entries", "items"],
    ]) {
      const node = at(path);
      expect(node.additionalProperties).toBe(false);
      // Strict mode has no optional properties: every property is required…
      expect(node.required).toEqual(Object.keys(node.properties as object));
    }
    // …so the two genuinely optional fields are NULLABLE instead, which is
    // what `stringField`/`isRecord` in the validation read as "not given".
    expect(sceneProps().location).toMatchObject({ type: ["string", "null"] });
    expect(sceneProps().sourceExcerpt).toMatchObject({ type: ["object", "null"] });
  });

  test("carries no keyword strict mode rejects — anywhere in the tree", () => {
    expect(unsupportedPaths(outlineJsonSchema())).toEqual([]);
    // The check itself has to be able to FIND one, or it guards nothing.
    expect(unsupportedPaths({ properties: { a: { items: { pattern: "x" } } } })).toEqual([
      "properties.a.items.pattern",
    ]);
  });

  test("a fresh object every call — both transports serialize it into a body", () => {
    const first = outlineJsonSchema();
    expect(outlineJsonSchema()).not.toBe(first);
    expect(outlineJsonSchema()).toEqual(first);
  });
});
