// The prompts every run assembles, checked across entities: the rules that
// travel exactly once in every assembled prompt, the reply object each
// prompt describes, and the few-shots that show it.
//
// The rules are load-bearing in their WORDING, so the checks compare text:
// a rule the model meets twice in slightly different company is a rule it
// can weigh against itself.

import { describe, expect, test } from "bun:test";
import { ASSET_FILES, buildCorrectionMessage, loadAsset } from "../src/generator";
import { formatContract } from "../src/generator-augment";
import { sceneSystemPrompt } from "../src/generate-pipeline";
import { locationAugmentSystemPrompt } from "../src/location-augment";
import { npcAugmentSystemPrompt } from "../src/npc-augment";
import { sceneAugmentSystemPrompt } from "../src/scene-augment";
import { parseSceneReply } from "../src/scene-reply";
import { sceneProposalSchema } from "@grimoire/shared";

/**
 * One numbered rule's own text, from its bold label to the start of the NEXT
 * rule (or the next section). The list position differs per prompt — rule 10
 * in one, 12 in another — so the NUMBER is deliberately not part of what is
 * compared; the wording is.
 */
function ruleParagraph(doc: string, label: string): string {
  const rest = doc.slice(doc.indexOf(label));
  const next = rest.search(/\n(?:\d+\.\s|\n|## )/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Every prompt of the scene: create, one scene of an outline, augment. */
async function scenePrompts(): Promise<Array<[string, string]>> {
  return [
    ["scene", await loadAsset(ASSET_FILES.scene.systemPrompt)],
    ["scene/single", await sceneSystemPrompt()],
    ["scene/augment", await sceneAugmentSystemPrompt()],
  ];
}

describe("the orthography rule", () => {
  const ORTHOGRAPHY_RULE = "**Deutsche Orthografie**";

  test("every prompt kind carries it exactly once, with the same core wording", async () => {
    const assembled: Array<[string, string]> = [
      ...(await scenePrompts()),
      ["outline", await loadAsset(ASSET_FILES.outline.systemPrompt)],
      ["npc", await loadAsset(ASSET_FILES.npc.systemPrompt)],
      ["npc/augment", await npcAugmentSystemPrompt()],
      ["location", await loadAsset(ASSET_FILES.location.systemPrompt)],
      ["location/augment", await locationAugmentSystemPrompt()],
    ];
    for (const [kind, prompt] of assembled) {
      expect(prompt.split(ORTHOGRAPHY_RULE).length - 1, kind).toBe(1);
      expect(prompt, kind).toContain("ä, ö, ü und ß stehen als genau diese Zeichen");
      expect(prompt, kind).toContain("**Einzige Ausnahme**: `id`-Werte");
    }
  });

  test("the scene's prompts share ONE sentence", async () => {
    // An npc's, a location's and the outline's prompts name their own fields
    // in it; the three prompts of the scene name the scene's.
    const wordings = new Set(
      (await scenePrompts()).map(([, doc]) => ruleParagraph(doc, ORTHOGRAPHY_RULE)),
    );
    expect(wordings.size).toBe(1);
  });
});

describe("the table rule", () => {
  const TABLE_RULE = "**Tabellen**";

  test("every prompt that writes a scene, an npc or a location carries it once", async () => {
    const assembled: Array<[string, string]> = [
      ...(await scenePrompts()),
      ["npc", await loadAsset(ASSET_FILES.npc.systemPrompt)],
      ["location", await loadAsset(ASSET_FILES.location.systemPrompt)],
      ["npc/augment", await npcAugmentSystemPrompt()],
      ["location/augment", await locationAugmentSystemPrompt()],
    ];
    for (const [kind, prompt] of assembled) {
      expect(prompt.split(TABLE_RULE).length - 1, kind).toBe(1);
      // The FORM is the contract: header row, delimiter row, edge pipes.
      expect(prompt, kind).toContain("GFM-Pipe-Tabelle");
      expect(prompt, kind).toContain("`|---|`");
      expect(prompt, kind).toContain("Rand-Pipes");
      // …and the boundary: tables only.
      expect(prompt, kind).toContain("**Aus GFM nutzt\n   du ausschließlich diese Pipe-Tabelle**");
      expect(prompt, kind).toContain("Aufgabenlisten (`- [x]`)");
    }
    const wordings = new Set(assembled.map(([, doc]) => ruleParagraph(doc, TABLE_RULE)));
    expect(wordings.size).toBe(1);

    // The OUTLINE prompt does not carry it: that call writes no text with
    // callouts at all, so the rule would be a rule about nothing.
    const outline = await loadAsset(ASSET_FILES.outline.systemPrompt);
    expect(outline).not.toContain(TABLE_RULE);
  });
});

describe("the scene's prompts", () => {
  const OBJECT_RULE = "Du antwortest mit **einem JSON-Objekt**";

  test("each describes the scene's reply object once, and speaks of the scene", async () => {
    for (const [kind, prompt] of await scenePrompts()) {
      expect(prompt.split(OBJECT_RULE).length - 1, kind).toBe(1);
      expect(prompt, kind).toContain("die Felder der Szene");
      expect(prompt, kind).toContain("`body`");
      expect(prompt, kind).toContain("`warnings`");
      expect(prompt, kind).toContain("Der Server");
      // The fields stand side by side: no halves, no collective term.
      expect(prompt, kind).not.toContain("`properties`");
      expect(prompt, kind).not.toContain("Eintrag");
      expect(prompt, kind).not.toContain("Eigenschaft");
      expect(prompt, kind).not.toContain("Adresse");
    }
    // The outline prompt describes its OWN object, so it must not carry this
    // one: two output schemas in one prompt is the contradiction the augment
    // run's `formatContract` exists to avoid.
    const outline = await loadAsset(ASSET_FILES.outline.systemPrompt);
    expect(outline).not.toContain(OBJECT_RULE);
  });

  test("the augment prompt: the rule for a scene plus the scene's fields, one output format", async () => {
    const prompt = await sceneAugmentSystemPrompt();
    expect(prompt).toContain("System-Prompt: Szene ergänzen");
    expect(prompt).toContain("Die Ergänzungsregel");
    expect(prompt).toContain("Vorhandenes bleibt Wort für Wort stehen");
    expect(prompt).toContain("## Die Felder der Szene");
    expect(prompt).toContain('"npcs"');
    expect(prompt.split("## Ausgabeformat").length - 1).toBe(1);
    // The create prompt's own rules stay behind — the augmentation rule wins.
    expect(prompt).not.toContain("**Szenen-Schnitt**");
  });

  test("the few-shot is a scene reply with every field, in German, and it reads", async () => {
    const raw = await loadAsset(ASSET_FILES.scene.fewShotTarget);
    const { body, warnings, ...fields } = JSON.parse(raw) as Record<string, unknown> & {
      body: string;
    };
    for (const key of Object.keys(sceneProposalSchema.shape)) {
      expect(Object.hasOwn({ ...fields, body }, key), key).toBe(true);
    }
    expect(Array.isArray(warnings)).toBe(true);
    // The model imitates what it reads: real German spelling in the fields
    // and in the text.
    expect(JSON.stringify(fields)).toMatch(/[äöüß]/);
    expect(body).toMatch(/[äöüß]/);
    expect(parseSceneReply(raw).ok).toBe(true);
  });

  test("the few-shot shows a table inside a callout", async () => {
    const { body } = JSON.parse(await loadAsset(ASSET_FILES.scene.fewShotTarget)) as {
      body: string;
    };
    const lines = body.split("\n");
    const delimiter = lines.findIndex((line) => /^>\s*\|\s*-{3,}\s*\|/.test(line));
    expect(delimiter).toBeGreaterThan(0);
    // The row above it is the header row, and both carry the callout marker.
    expect(lines[delimiter - 1]).toMatch(/^>\s*\|.*\|\s*$/);
    expect(lines[delimiter + 1]).toMatch(/^>\s*\|.*\|\s*$/);
  });
});

describe("shared mechanics", () => {
  test("the correction turn names the schema it wants corrected", () => {
    const message = buildCorrectionMessage(["scene: id fehlt"], "die Szene enthalten", "scene");
    expect(message).toContain("korrigierten JSON-Objekt");
    expect(message).toContain("gleiches Schema (`scene`)");
    expect(message).toContain("kein Text außerhalb des Objekts");
    // Without a schema (a provider that forces nothing) the sentence still
    // reads — it just has no name to point at.
    const bare = buildCorrectionMessage(["outline: leer"], "alle Szenen");
    expect(bare).toContain("gleiches Schema,");
  });

  test("a prompt without the format heading travels whole", () => {
    expect(formatContract("# Titel\n\n## Regeln\n\nnichts\n", "## Die Felder der Szene")).toContain(
      "## Regeln",
    );
  });
});
