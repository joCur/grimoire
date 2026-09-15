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
  outlineJsonSchema,
} from "@grimoire/shared/outline-schema";

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
    expect(sceneProps().id).toEqual({ type: "string", pattern: ENTITY_SLUG.source });
    expect(scenes().maxItems).toBe(MAX_OUTLINE_SCENES);
    expect(scenes().minItems).toBe(1);
    expect(entries().maxItems).toBe(MAX_OUTLINE_ENTRIES);
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

  test("a fresh object every call — both transports serialize it into a body", () => {
    const first = outlineJsonSchema();
    expect(outlineJsonSchema()).not.toBe(first);
    expect(outlineJsonSchema()).toEqual(first);
  });
});
