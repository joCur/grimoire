// The reply of a location call (decisions/resources): every field of the location beside
// the model's `warnings`, read by the very reply schema the provider
// enforced.

import { describe, expect, test } from "bun:test";
import { NOT_A_LOCATION_ERROR, parseLocationReply } from "../src/location-reply";

function location(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "old-mole",
    name: " The Old Mole ",
    chapter: null,
    roll20Page: "",
    atmosphere: "Salt in the air.",
    body: "\n## On first entering\n\nFog.",
    warnings: [" No Roll20 name in the source. ", ""],
    ...over,
  });
}

describe("parseLocationReply", () => {
  test("reads the object as the proposed location", () => {
    const outcome = parseLocationReply(location());
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    // Trimmed, a null or blank field left out, the body in its stored form.
    expect(outcome.reply.location).toEqual({
      id: "old-mole",
      name: "The Old Mole",
      atmosphere: "Salt in the air.",
      body: "## On first entering\n\nFog.\n",
    });
    expect(outcome.reply.warnings).toEqual(["No Roll20 name in the source."]);
    expect(outcome.reply.ignored).toEqual([]);
  });

  test("a nullable field the reply leaves out entirely is not given", () => {
    const reply = JSON.parse(location({ roll20Page: "Mole" })) as Record<string, unknown>;
    delete reply.chapter;
    const outcome = parseLocationReply(JSON.stringify(reply));
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    expect(outcome.reply.location.roll20Page).toBe("Mole");
    expect(Object.hasOwn(outcome.reply.location, "chapter")).toBe(false);
  });

  test("a blank name is missing, and a wrong shape is named", () => {
    const blank = parseLocationReply(location({ name: "  " }));
    expect(blank.ok).toBe(false);
    // The correction message is German production text sent back to the model.
    if (!blank.ok) expect(blank.errors.join(" ")).toContain('"name" fehlt');
    const wrong = parseLocationReply(location({ atmosphere: 7 }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors.join(" ")).toContain('"atmosphere"');
  });

  test("an unknown key fails a create run and is dropped by an augment run", () => {
    const created = parseLocationReply(location({ status: "alive" }));
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.errors.join(" ")).toContain("status");
    const augmented = parseLocationReply(location({ status: "alive" }), "augment");
    if (!augmented.ok) throw new Error(augmented.errors.join(" | "));
    expect(augmented.reply.ignored).toEqual(["status"]);
  });

  test("a `properties` object is not a location reply", () => {
    const nested = JSON.stringify({
      properties: { id: "old-mole", name: "The Old Mole" },
      body: "## Text\n",
      warnings: [],
    });
    const outcome = parseLocationReply(nested);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.join(" ")).toContain("properties");
    expect(parseLocationReply("not an object")).toEqual({
      ok: false,
      errors: [NOT_A_LOCATION_ERROR],
    });
  });

  test("the not-an-object error names every field of the location", () => {
    for (const key of ["id", "name", "chapter", "roll20Page", "atmosphere", "body"]) {
      expect(NOT_A_LOCATION_ERROR).toContain(`\`${key}\``);
    }
  });
});
