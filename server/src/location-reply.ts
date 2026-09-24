// The reply of a LOCATION call: one JSON object with the location's fields,
// `body` among them, and the model's `warnings` beside them. It is read by
// the location's reply schema (@grimoire/shared/location) — the very schema
// the provider enforced — so what the transport guarantees is what parses.
//
// What this module does not do is judge content: a kebab `id`, references
// that resolve and known callouts stay with the runs that know what they may
// name (./generate-pipeline.ts, ./location-augment.ts).

import { z } from "zod";
import {
  locationProposalSchema,
  locationReplySchemas,
  type EntryMode,
  type LocationProposal,
} from "@grimoire/shared";
import { parseJsonReply, REPAIRED_ENTRY_WARNING } from "./entry-reply";

/** One location reply, read: the location the run proposes plus the notes. */
export interface LocationReply {
  /** The proposed location — every field, `body` stored the way the store keeps it. */
  location: LocationProposal;
  /** The model's notes for the DM; empty when there was nothing to report. */
  warnings: string[];
  /**
   * The keys an AUGMENT reply carried that a location does not have — echoes
   * of the location the model was shown, dropped instead of failing the run.
   * A validator that has a rule about one (a location never has a `status`)
   * reads it here. Always empty in a create run, where such a key is an error.
   */
  ignored: string[];
}

/**
 * The error a reply that is not the reply object gets back — German, like
 * every correction turn, and naming the keys the object has.
 */
export const NOT_A_LOCATION_ERROR =
  "die Antwort ist kein Objekt des Schemas — sie braucht die Felder des Orts als eigene " +
  `Schlüssel (${Object.keys(locationProposalSchema.shape)
    .map((key) => `\`${key}\``)
    .join(", ")}; \`body\` ist der Fließtext als ein String) und daneben \`warnings\` ` +
  "(eine Liste von Hinweisen). Gib genau dieses Objekt zurück — als ganze Antwort, ohne Code-Zäune.";

/** The issues of a reply parse in German — they travel into the correction turn. */
const GERMAN_ISSUES = z.locales.de();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read one location reply into the proposed location, or into the error list
 * for the correction turn.
 *
 * Three leniencies stand in front of the parse: text is trimmed and a blank
 * optional field is „not given", a nullable field the reply left out
 * entirely counts as `null`, and `warnings: null` is no warnings. In an
 * AUGMENT run a key the location does not have is dropped into `ignored`
 * instead of failing the run: the model was shown the whole location, and an
 * echo of it is not a proposal.
 */
export function parseLocationReply(
  raw: string,
  mode: EntryMode = "create",
): { ok: true; reply: LocationReply } | { ok: false; errors: string[] } {
  const parsed = parseJsonReply(raw);
  if (parsed === null || !isRecord(parsed.value)) {
    return { ok: false, errors: [NOT_A_LOCATION_ERROR] };
  }
  const schema = locationReplySchemas[mode];
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
  const { id, name, body, warnings, chapter, roll20Page, atmosphere } = read.data;
  const errors: string[] = [];
  if (id === "") errors.push('"id" fehlt — jeder Ort nennt seine kebab-case id');
  if (name === "") errors.push('"name" fehlt — das Feld ist verpflichtend');
  if (errors.length > 0) return { ok: false, errors };

  const location: LocationProposal = {
    id,
    name,
    ...(chapter === null ? {} : { chapter }),
    ...(roll20Page === null ? {} : { roll20Page }),
    ...(atmosphere === null ? {} : { atmosphere }),
    // The body is stored the way the store keeps it: no leading blank lines
    // and exactly one trailing newline.
    body: `${body.replace(/^\n+/, "").trimEnd()}\n`,
  };
  const notes = warnings.map((warning) => warning.trim()).filter((warning) => warning !== "");
  return {
    ok: true,
    reply: {
      location,
      warnings: parsed.repaired ? [...notes, REPAIRED_ENTRY_WARNING] : notes,
      ignored,
    },
  };
}
