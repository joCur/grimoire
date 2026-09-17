// THE GENERATOR'S DRAFT PARSER, and nothing else.
//
// A model answers with one entry as a single markdown text: a YAML properties
// block, then the body. `parseMarkdown` reads that text back into the
// properties/body pair the store speaks, under the address the draft is
// destined for (server/src/generator.ts, generate-accept.ts,
// naming-check.ts). Nothing STORED is ever parsed this way — the database
// holds columns, and a read renders them (server/src/store/render.ts).
//
// Design rule (ADR #1): the format DEGRADES, it does not validate. Nothing in
// this module ever throws on odd input — broken YAML becomes empty properties
// with the full text as body, wrong-typed values are coerced defensively, and
// unknown keys pass through verbatim for the caller to refuse.

import matter from "gray-matter";
import { kindFromAddress } from "./kind";
import type { ParsedFile } from "./types";

// --- YAML date normalization -------------------------------------------------

/**
 * gray-matter's js-yaml parses unquoted `2026-08-19` and
 * `2026-08-19T19:32:00` as JS Date objects (zone-less timestamps are read
 * as UTC). We normalize them back to the plain strings the format uses:
 * date-only -> `yyyy-mm-dd`, datetime -> `yyyy-mm-ddTHH:MM` (no zone — the
 * wall-clock digits as written, which is why we read them back with the UTC
 * getters).
 *
 * SECONDS are kept when they are not zero: a session's `pauses` intervals are
 * second-precise, and truncating them here would make every pause up to a
 * minute wrong on the next read. The same holds for `started`/`ended` — they
 * are written to the second so that a fresh session's timer starts at
 * 0:00:00 instead of somewhere inside the current minute. Dropping a `:00` is
 * harmless (same instant); a `:37` is not.
 *
 * A datetime that happens to be exactly midnight UTC is indistinguishable
 * from a date-only value and degrades to `yyyy-mm-dd`.
 */
function dateToString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const isMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (isMidnight) return date;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const secs = d.getUTCSeconds();
  return `${date}T${secs === 0 ? time : `${time}:${pad(secs)}`}`;
}

/**
 * Recursively replace Date values (incl. inside arrays and nested objects)
 * with normalized strings. Always returns fresh containers — gray-matter
 * caches parsed results by input string and shares the same object across
 * calls, so the cached original must never be mutated.
 */
function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) return dateToString(value);
  if (Array.isArray(value)) return value.map(normalizeDates);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeDates(v);
    return out;
  }
  return value;
}

// --- parsing ------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

/** The last segment of an address — the id it names. */
function addressStem(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/**
 * Parse one markdown draft into a `ParsedFile` under the address it is
 * destined for. Never throws:
 *
 * - Invalid/unparseable YAML (or a block that is valid YAML but not a
 *   mapping) degrades to properties `{}` with the ENTIRE raw text as body.
 * - Unknown properties keys are preserved verbatim, for the caller to refuse.
 * - Date values are normalized back to strings (see normalizeDates).
 * - Missing `id` falls back to the address's last segment — a draft whose
 *   properties name no id is still destined for exactly one entry.
 * - Missing display name falls back to the id (`title` for scene/chapter,
 *   `name` for npc/location/campaign).
 */
export function parseMarkdown(raw: string, path: string, rev: number): ParsedFile {
  const kind = kindFromAddress(path);

  let data: unknown = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    if (isPlainObject(parsed.data)) {
      data = parsed.data;
      body = parsed.content;
    }
    // Non-mapping properties (e.g. a bare string) degrades like broken
    // YAML: empty properties, full raw as body.
  } catch {
    // Broken YAML: empty properties, full raw as body.
  }

  const properties = normalizeDates(data) as Record<string, unknown>;

  if (typeof properties.id !== "string" || properties.id === "") {
    properties.id =
      properties.id !== undefined && properties.id !== null && properties.id !== ""
        ? String(properties.id)
        : addressStem(path);
  }

  if (kind === "scene" || kind === "chapter") {
    if (typeof properties.title !== "string" || properties.title === "") {
      properties.title =
        properties.title !== undefined && properties.title !== null && properties.title !== ""
          ? String(properties.title)
          : properties.id;
    }
  }
  if (kind === "npc" || kind === "location" || kind === "campaign") {
    if (typeof properties.name !== "string" || properties.name === "") {
      properties.name =
        properties.name !== undefined && properties.name !== null && properties.name !== ""
          ? String(properties.name)
          : properties.id;
    }
  }

  return { path, kind, properties, body, rev };
}

