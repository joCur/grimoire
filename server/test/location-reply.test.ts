// The reply of a location call (decisions/resources): every field of the location beside
// the model's `warnings`, read by the very reply schema the provider
// enforced.

import { describe, expect, test } from "bun:test";
import { NOT_A_LOCATION_ERROR, parseLocationReply } from "../src/location-reply";

function location(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "alte-mole",
    name: " Die alte Mole ",
    chapter: null,
    roll20Page: "",
    atmosphere: "Salz in der Luft.",
    body: "\n## Beim ersten Betreten\n\nNebel.",
    warnings: [" Kein Roll20-Name im Quelltext. ", ""],
    ...over,
  });
}

describe("parseLocationReply", () => {
  test("reads the object as the proposed location", () => {
    const outcome = parseLocationReply(location());
    if (!outcome.ok) throw new Error(outcome.errors.join(" | "));
    // Trimmed, a null or blank field left out, the body in its stored form.
    expect(outcome.reply.location).toEqual({
      id: "alte-mole",
      name: "Die alte Mole",
      atmosphere: "Salz in der Luft.",
      body: "## Beim ersten Betreten\n\nNebel.\n",
    });
    expect(outcome.reply.warnings).toEqual(["Kein Roll20-Name im Quelltext."]);
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
      properties: { id: "alte-mole", name: "Die alte Mole" },
      body: "## Text\n",
      warnings: [],
    });
    const outcome = parseLocationReply(nested);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.join(" ")).toContain("properties");
    expect(parseLocationReply("kein Objekt")).toEqual({
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
