// The tolerant JSON reader every generator reply shares.
//
// Every call answers a JSON object the provider was forced into — the scene,
// the npc and the location each in their own reply form (./scene-reply.ts,
// ./npc-reply.ts, ./location-reply.ts), the outline in its own
// (./generate-pipeline.ts). The object is forced for every call — Claude gets
// the schema as a tool with `tool_choice`, an OpenAI-compatible endpoint gets
// `response_format: json_schema` with `strict: true` (llm-provider.ts) — so
// the shape the API guarantees is the shape the readers read. The body
// travels as a JSON string, which the TRANSPORT escapes: quotation marks,
// newlines and backslashes survive because nobody hand-wrote them.
//
// What this module does NOT do is judge content: it reads the value, and each
// entity's reader checks it against that entity's schema.

import { jsonrepair } from "jsonrepair";

/**
 * The run warning a REPAIRED reply object earns — the sibling of
 * REPAIRED_REPLY_WARNING (generate-pipeline.ts), and there for the same
 * reason: the repair is silent otherwise, and a provider whose replies need
 * patching every single run is a provider to reconsider.
 */
export const REPAIRED_OBJECT_WARNING =
  "Antwort musste repariert werden — das Modell hat seine Antwort nicht als " +
  "gültiges JSON-Objekt geliefert.";

/**
 * One raw reply as a JSON value — with ONE tolerant repair attempt before a
 * correction turn is spent. Shared by every call: the scene, npc and location
 * replies and the outline (generate-pipeline `parseOutlineJson`).
 *
 * Three stages, first one that PARSES wins: the whole text (what a
 * schema-forced reply is), the content of a ```json fence, and the brace
 * SPANS — from the first `{` to a closing brace, the last one first and then
 * progressively earlier ones. The walk back matters because a reply may carry
 * prose that itself contains a `}` („… wie `{ "a": 1 }` oben"): one span to
 * the very last brace would then never parse and every stage would fail on a
 * reply that is perfectly readable a few characters earlier. A candidate
 * that merely LOOKS like an object is then handed to `jsonrepair` once — a
 * trailing comma or a single-quoted key is mechanical, and much cheaper to fix
 * than to re-ask for.
 *
 * `repaired` says which way in it was, so the run can say so too. The result
 * goes through the unchanged validation either way: the repair loosens the
 * parsing, never the rules.
 */
export function parseJsonReply(raw: string): { value: unknown; repaired: boolean } | null {
  const spans = braceSpans(raw);
  for (const candidate of [raw, fenceContent(raw), ...spans]) {
    if (candidate === null) continue;
    const trimmed = candidate.trim();
    if (trimmed === "") continue;
    try {
      return { value: JSON.parse(trimmed), repaired: false };
    } catch {
      // next stage
    }
  }
  // Prose without an object is NOT repaired: jsonrepair would happily turn a
  // sentence into a JSON string, and the run would then fail with a message
  // about the wrong thing.
  for (const span of spans) {
    try {
      const value: unknown = JSON.parse(jsonrepair(span));
      // A span STARTS with `{`, so a repair that produced anything else
      // invented structure rather than fixing a comma: `{"a":1} Fertig, ja.`
      // repairs into a three-element ARRAY, and a run that accepted that
      // would fail with a message about the wrong thing. The next (earlier)
      // span is the one that is actually meant.
      if (isRecord(value)) return { value, repaired: true };
    } catch {
      // next span
    }
  }
  return null;
}

/** ```json fence (labelled wins) or a bare ``` fence — the FIRST of the reply. */
const LABELLED_FENCE = /```json\b[ \t]*\r?\n?([\s\S]*?)```/i;
const BARE_FENCE = /```[ \t]*\r?\n([\s\S]*?)```/;

function fenceContent(raw: string): string | null {
  const labelled = LABELLED_FENCE.exec(raw);
  if (labelled !== null) return labelled[1]!;
  const bare = BARE_FENCE.exec(raw);
  return bare === null ? null : bare[1]!;
}

/** How many closing braces the span walk tries before it gives up. */
const BRACE_SPAN_ATTEMPTS = 5;

/**
 * The spans from the first `{` to a closing brace, the LAST one first and
 * then progressively earlier ones — bounded, so a body full of braces cannot
 * turn one reply into a quadratic parse. Prose on both sides falls off.
 */
function braceSpans(raw: string): string[] {
  const start = raw.indexOf("{");
  if (start === -1) return [];
  const spans: string[] = [];
  let end = raw.lastIndexOf("}");
  while (end > start && spans.length < BRACE_SPAN_ATTEMPTS) {
    spans.push(raw.slice(start, end + 1));
    end = raw.lastIndexOf("}", end - 1);
  }
  return spans;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
