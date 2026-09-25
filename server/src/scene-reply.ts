// The reply of a SCENE call: one JSON object with the scene's fields, `body`
// among them, and the model's `warnings` beside them. It is read by the
// scene's reply schema (@grimoire/shared/scene) — the very schema the
// provider enforced, handed to it as JSON schema by `sceneReplyRequest` — so
// what the transport guarantees is what parses. A NEW scene's reply narrows
// the status to `draft`; an existing scene's keeps all four. What the model
// is told about each field stands in the scene prompts (generator/).
//
// What this module does not do is judge content: a kebab `id`, the run's
// chapter, references that resolve and known callouts stay with the runs
// that know what they may name (./generator.ts, ./generate-pipeline.ts,
// ./scene-augment.ts).

import { z } from "zod";
import {
  newSceneReplySchema,
  sceneFromReply,
  sceneProposalSchema,
  sceneReplySchema,
  type SceneProposal,
} from "@grimoire/shared";
import type { JsonSchema } from "@grimoire/shared/outline-schema";
import { parseJsonReply, REPAIRED_OBJECT_WARNING } from "./json-reply";
import type { ReplySchema, RunMode } from "./llm-provider";

/** The tool (Claude) or `json_schema` (OpenAI) name a scene call travels under, per run. */
const SCENE_REPLY_NAMES: Record<RunMode, string> = {
  create: "scene",
  augment: "augmented_scene",
};

/** The reply schema of each run: a new scene is a draft, an existing one keeps its status. */
const SCENE_REPLY_SCHEMAS = {
  create: newSceneReplySchema,
  augment: sceneReplySchema,
} as const;

/**
 * The schema a scene call is forced into: the scene's reply schema of that
 * run as JSON schema, under the name of its run. The `$schema` dialect line
 * is dropped — a request carries the schema as data. Built on every call, so
 * no request can reach into the next one's payload.
 */
export function sceneReplyRequest(mode: RunMode): ReplySchema {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(SCENE_REPLY_SCHEMAS[mode]) as JsonSchema;
  return { name: SCENE_REPLY_NAMES[mode], schema };
}

/** One scene reply, read: the scene the run proposes plus the notes. */
export interface SceneReply {
  /** The proposed scene — every field, `body` stored the way the store keeps it. */
  scene: SceneProposal;
  /** The model's notes for the DM; empty when there was nothing to report. */
  warnings: string[];
  /**
   * The keys an AUGMENT reply carried that a scene does not have — echoes of
   * the scene the model was shown, dropped instead of failing the run. Always
   * empty in a create run, where such a key is an error.
   */
  ignored: string[];
}

/**
 * The error a reply that is not the reply object gets back — German, like
 * every correction turn, and naming the keys the object has.
 */
export const NOT_A_SCENE_ERROR =
  "die Antwort ist kein Objekt des Schemas — sie braucht die Felder der Szene als eigene " +
  `Schlüssel (${Object.keys(sceneProposalSchema.shape)
    .map((key) => `\`${key}\``)
    .join(", ")}; \`body\` ist der Fließtext als ein String) und daneben \`warnings\` ` +
  "(eine Liste von Hinweisen). Gib genau dieses Objekt zurück — als ganze Antwort, ohne Code-Zäune.";

/** The fields of a scene reply that are lists of strings. */
const LIST_FIELDS = ["npcs", "handouts", "tags", "warnings"] as const;

/** The issues of a reply parse in German — they travel into the correction turn. */
const GERMAN_ISSUES = z.locales.de();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read one scene reply into the proposed scene, or into the error list for
 * the correction turn.
 *
 * A few leniencies stand in front of the parse: text is trimmed and a blank
 * optional field is „not given", a nullable field the reply left out
 * entirely counts as `null`, a list left out or answered with `null` is
 * empty, a blank entry of a list is dropped, and a scene without a `type` is
 * `planned` — the unmarked case. In an AUGMENT run a key the scene does not
 * have is dropped into `ignored` instead of failing the run: the model was
 * shown the whole scene, and an echo of it is not a proposal.
 */
export function parseSceneReply(
  raw: string,
  mode: RunMode = "create",
): { ok: true; reply: SceneReply } | { ok: false; errors: string[] } {
  const parsed = parseJsonReply(raw);
  if (parsed === null || !isRecord(parsed.value)) {
    return { ok: false, errors: [NOT_A_SCENE_ERROR] };
  }
  const schema = SCENE_REPLY_SCHEMAS[mode];
  const shape: Record<string, z.ZodType> = schema.shape;
  const ignored: string[] = [];
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.value)) {
    if (!(key in shape) && mode === "augment") {
      ignored.push(key);
      continue;
    }
    input[key] = typeof value === "string" && key !== "body" ? value.trim() : value;
  }
  for (const [key, field] of Object.entries(shape)) {
    const value = input[key];
    const blank = value === undefined || value === "";
    if (blank && field.safeParse(null).success) input[key] = null;
  }
  for (const key of LIST_FIELDS) {
    const value = input[key];
    if (value === undefined || value === null) input[key] = [];
    else if (Array.isArray(value)) {
      input[key] = value
        .map((item: unknown) => (typeof item === "string" ? item.trim() : item))
        .filter((item: unknown) => item !== "");
    }
  }
  if (input.type === undefined || input.type === null || input.type === "") input.type = "planned";

  const read = schema.safeParse(input, { error: GERMAN_ISSUES.localeError });
  if (!read.success) {
    const allowed = Object.keys(shape).join(", ");
    return {
      ok: false,
      errors: read.error.issues.map((issue) => {
        const where = issue.path.length === 0 ? "" : `"${issue.path.join(".")}": `;
        const hint = issue.code === "unrecognized_keys" ? ` — erlaubt sind: ${allowed}` : "";
        return `${where}${issue.message}${hint}`;
      }),
    };
  }
  const errors: string[] = [];
  if (read.data.id === "") errors.push('"id" fehlt — jede Szene nennt ihre kebab-case id');
  if (read.data.title === "") errors.push('"title" fehlt — das Feld ist verpflichtend');
  if (errors.length > 0) return { ok: false, errors };

  const { scene, warnings } = sceneFromReply(read.data);
  return {
    ok: true,
    reply: {
      scene: {
        ...scene,
        // The body is stored the way the store keeps it: no leading blank
        // lines and exactly one trailing newline.
        body: `${scene.body.replace(/^\n+/, "").trimEnd()}\n`,
      },
      warnings: parsed.repaired ? [...warnings, REPAIRED_OBJECT_WARNING] : warnings,
      ignored,
    },
  };
}
