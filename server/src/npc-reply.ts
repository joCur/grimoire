// The reply of an NPC call: one JSON object with the npc's fields, `body`
// among them, and the model's `warnings` beside them. It is read by the npc's
// reply schema (@grimoire/shared/npc) — the very schema the provider
// enforced, handed to it as JSON schema by `npcReplyRequest` — so what the
// transport guarantees is what parses. What the model is told about each
// field stands in the npc prompts (generator/).
//
// What this module does not do is judge content: a kebab `id`, references
// that resolve and known callouts stay with the runs that know what they may
// name (./generator.ts, ./generate-pipeline.ts, ./npc-augment.ts).

import { z } from "zod";
import {
  npcFromReply,
  npcProposalSchema,
  npcReplySchema,
  type NpcProposal,
} from "@grimoire/shared";
import type { JsonSchema } from "@grimoire/shared/outline-schema";
import { parseJsonReply, REPAIRED_OBJECT_WARNING } from "./json-reply";
import type { ReplySchema, RunMode } from "./llm-provider";

/** The tool (Claude) or `json_schema` (OpenAI) name an npc call travels under, per run. */
const NPC_REPLY_NAMES: Record<RunMode, string> = {
  create: "npc",
  augment: "augmented_npc",
};

/**
 * The schema an npc call is forced into: the npc's reply schema as JSON
 * schema, under the name of its run. The `$schema` dialect line is dropped —
 * a request carries the schema as data. Built on every call, so no request
 * can reach into the next one's payload.
 */
export function npcReplyRequest(mode: RunMode): ReplySchema {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(npcReplySchema) as JsonSchema;
  return { name: NPC_REPLY_NAMES[mode], schema };
}

/** One npc reply, read: the npc the run proposes plus the notes. */
export interface NpcReply {
  /** The proposed npc — every field, `body` stored the way the store keeps it. */
  npc: NpcProposal;
  /** The model's notes for the DM; empty when there was nothing to report. */
  warnings: string[];
  /**
   * The keys an AUGMENT reply carried that an npc does not have — echoes of
   * the npc the model was shown, dropped instead of failing the run. Always
   * empty in a create run, where such a key is an error.
   */
  ignored: string[];
}

/**
 * The error a reply that is not the reply object gets back — German, like
 * every correction turn, and naming the keys the object has.
 */
export const NOT_AN_NPC_ERROR =
  "die Antwort ist kein Objekt des Schemas — sie braucht die Felder des NPC als eigene " +
  `Schlüssel (${Object.keys(npcProposalSchema.shape)
    .map((key) => `\`${key}\``)
    .join(", ")}; \`body\` ist der Fließtext als ein String) und daneben \`warnings\` ` +
  "(eine Liste von Hinweisen). Gib genau dieses Objekt zurück — als ganze Antwort, ohne Code-Zäune.";

/** The issues of a reply parse in German — they travel into the correction turn. */
const GERMAN_ISSUES = z.locales.de();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read one npc reply into the proposed npc, or into the error list for the
 * correction turn.
 *
 * Three leniencies stand in front of the parse: text is trimmed and a blank
 * optional field is „not given", a nullable field the reply left out
 * entirely counts as `null`, and `warnings: null` is no warnings. In an
 * AUGMENT run a key the npc does not have is dropped into `ignored` instead
 * of failing the run: the model was shown the whole npc, and an echo of it
 * is not a proposal. `quickstats` is folded from its pairs into its
 * key/value set (@grimoire/shared/npc `npcFromReply`).
 */
export function parseNpcReply(
  raw: string,
  mode: RunMode = "create",
): { ok: true; reply: NpcReply } | { ok: false; errors: string[] } {
  const parsed = parseJsonReply(raw);
  if (parsed === null || !isRecord(parsed.value)) {
    return { ok: false, errors: [NOT_AN_NPC_ERROR] };
  }
  const schema = npcReplySchema;
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
  if (input.warnings === null) input.warnings = [];

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
  if (read.data.id === "") errors.push('"id" fehlt — jeder NPC nennt seine kebab-case id');
  if (read.data.name === "") errors.push('"name" fehlt — das Feld ist verpflichtend');
  if (errors.length > 0) return { ok: false, errors };

  const { npc, warnings } = npcFromReply(read.data);
  const notes = warnings.map((warning) => warning.trim()).filter((warning) => warning !== "");
  return {
    ok: true,
    reply: {
      npc: {
        ...npc,
        // The body is stored the way the store keeps it: no leading blank
        // lines and exactly one trailing newline.
        body: `${npc.body.replace(/^\n+/, "").trimEnd()}\n`,
      },
      warnings: parsed.repaired ? [...notes, REPAIRED_OBJECT_WARNING] : notes,
      ignored,
    },
  };
}
