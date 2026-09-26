// The reply of a scene call (decisions/resources): every field of the scene beside the
// model's `warnings`, read by the very reply schema the provider enforced —
// a NEW scene's with the status narrowed to `draft`, an existing scene's
// with all four.
//
// The cases are the ones the schema cannot cover: a reply that is not the
// object at all, the tolerant way in, `null` read as „not given", and the PO
// case — a body whose German quotation marks are closed with an ASCII `"`
// travels byte for byte, because the transport escapes it and nobody
// hand-writes the JSON.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sceneToReply, type SceneProposal } from "@grimoire/shared";
import { REPAIRED_OBJECT_WARNING } from "../src/json-reply";
import { NOT_A_SCENE_ERROR, parseSceneReply, sceneReplyRequest } from "../src/scene-reply";

/** The PO case: opening U+201E, closed with the ASCII `"`. */
const PO_LINE = '„Wer nachts hier steht, hat was zu verbergen", murrt die Wache.';

function scene(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "night-watch-quay",
    title: " Nachtwache am Kai ",
    type: "planned",
    trigger: null,
    chapter: "01-salzhafen",
    location: "",
    npcs: ["fenn", " "],
    handouts: [],
    tags: ["stealth"],
    status: "draft",
    body: `\n\n## Flow\n\n${PO_LINE}`,
    warnings: [" Der Quelltext nennt keinen DC — DC 13 gesetzt. ", ""],
    ...over,
  });
}

function read(raw: string, mode: "create" | "augment" = "create") {
  const outcome = parseSceneReply(raw, mode);
  if (!outcome.ok) throw new Error(`expected a reply, got: ${outcome.errors.join(" | ")}`);
  return outcome.reply;
}

function errors(raw: string, mode: "create" | "augment" = "create"): string[] {
  const outcome = parseSceneReply(raw, mode);
  if (outcome.ok) throw new Error("expected errors");
  return outcome.errors;
}

/** The example campaign's smuggler scene, as its fixture holds it — the scene without its guard. */
const CAPTURED = JSON.parse(
  readFileSync(
    join(import.meta.dir, "..", "..", "fixtures", "beispiel", "scenes", "smuggler-captured.json"),
    "utf8",
  ),
) as SceneProposal;

describe("parseSceneReply", () => {
  test("reads the object as the proposed scene", () => {
    const reply = read(scene());
    expect(reply.scene).toEqual({
      id: "night-watch-quay",
      title: "Nachtwache am Kai",
      type: "planned",
      chapter: "01-salzhafen",
      npcs: ["fenn"],
      handouts: [],
      tags: ["stealth"],
      status: "draft",
      // Stored the way the store keeps a body: no leading blank lines, one
      // closing newline.
      body: `## Flow\n\n${PO_LINE}\n`,
    });
    expect(reply.warnings).toEqual(["Der Quelltext nennt keinen DC — DC 13 gesetzt."]);
    expect(reply.ignored).toEqual([]);
  });

  test("the body survives the PO spelling byte for byte", () => {
    expect(read(scene()).scene.body).toContain(PO_LINE);
  });

  test("a list left out or answered with null is empty; a missing type is planned", () => {
    const { npcs: _npcs, type: _type, ...rest } = JSON.parse(scene()) as Record<string, unknown>;
    const reply = read(JSON.stringify({ ...rest, tags: null }));
    expect(reply.scene.npcs).toEqual([]);
    expect(reply.scene.tags).toEqual([]);
    expect(reply.scene.type).toBe("planned");
  });

  test("a fence, prose around it and a single repair all cost no correction turn", () => {
    expect(read(`Hier ist die Szene:\n\n\`\`\`json\n${scene()}\n\`\`\`\n`).scene.id).toBe(
      "night-watch-quay",
    );
    const repaired = read(scene().replace(/}$/, ",}"));
    expect(repaired.scene.id).toBe("night-watch-quay");
    // …and the run says that it had to be repaired.
    expect(repaired.warnings).toContain(REPAIRED_OBJECT_WARNING);
  });

  test("anything that is not the object is the ONE shape error, naming the fields", () => {
    for (const raw of ["", "kein Objekt", "---\nid: kai\n---\n\n## Flow\n", "[1]"]) {
      expect(errors(raw)).toEqual([NOT_A_SCENE_ERROR]);
    }
    for (const key of ["`id`", "`chapter`", "`npcs`", "`body`", "`warnings`"]) {
      expect(NOT_A_SCENE_ERROR).toContain(key);
    }
  });

  test("a NEW scene can only be a draft; an existing one keeps its status", () => {
    expect(errors(scene({ status: "ready" })).join(" ")).toContain('"status"');
    expect(read(scene({ status: "played" }), "augment").scene.status).toBe("played");
  });

  test("a field the scene does not have, and a value of the wrong shape", () => {
    const unknown = errors(scene({ mood: "düster" })).join(" ");
    expect(unknown).toContain("mood");
    expect(unknown).toContain("erlaubt sind");
    expect(errors(scene({ npcs: "fenn" })).join(" ")).toContain('"npcs"');
    expect(errors(scene({ title: 7 })).join(" ")).toContain('"title"');
    expect(errors(scene({ type: "optional" })).join(" ")).toContain('"type"');
  });

  test("a title or an id of whitespace only is missing, not empty", () => {
    expect(errors(scene({ title: "   " }))).toEqual(['"title" fehlt — das Feld ist verpflichtend']);
    expect(errors(scene({ id: " " })).join(" ")).toContain('"id" fehlt');
  });

  test("an unknown key fails a create run and is dropped by an augment run", () => {
    expect(errors(scene({ mood: "düster" })).join(" ")).toContain("mood");
    const augmented = read(scene({ mood: "düster" }), "augment");
    expect(Object.hasOwn(augmented.scene, "mood")).toBe(false);
    expect(augmented.ignored).toEqual(["mood"]);
  });

  test("a scene shown in its reply form reads back as itself", () => {
    const shown = { ...sceneToReply(CAPTURED), warnings: [] };
    expect(read(JSON.stringify(shown), "augment").scene).toEqual({
      ...CAPTURED,
      body: `${CAPTURED.body.replace(/^\n+/, "").trimEnd()}\n`,
    });
  });
});

describe("sceneReplyRequest", () => {
  test("names the run and carries the derived schema, without its dialect line", () => {
    const create = sceneReplyRequest("create");
    const augment = sceneReplyRequest("augment");
    expect(create.name).toBe("scene");
    expect(augment.name).toBe("augmented_scene");
    expect(Object.hasOwn(create.schema, "$schema")).toBe(false);
    const status = (schema: Record<string, unknown>) =>
      (schema.properties as Record<string, Record<string, unknown>>).status;
    expect(status(create.schema)).toEqual({ type: "string", enum: ["draft"] });
    expect(status(augment.schema)?.enum).toContain("played");
  });

  test("a copy every call — both transports serialize it into a body", () => {
    const first = sceneReplyRequest("create");
    const second = sceneReplyRequest("create");
    expect(second.schema).not.toBe(first.schema);
    expect(second).toEqual(first);
  });
});
