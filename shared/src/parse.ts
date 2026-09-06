// Properties parser for the Grimoire markdown data format.
// Mirror of the format contract in /README.md — keep both in sync.
//
// Design rule (README / DECISIONS #1): the format DEGRADES, it does not
// validate. Nothing in this module ever throws on odd input — broken YAML
// becomes an empty properties with the full file as body, wrong-typed
// values are coerced defensively, unknown keys pass through verbatim.

import matter from "gray-matter";
import { kindFromPath } from "./kind";
import type {
  LocationSummary,
  NpcSummary,
  ParsedFile,
  SceneSummary,
  SessionSummary,
} from "./types";

// The path-to-kind table lives in ./kind (no gray-matter, so the app can
// import it too) and stays reachable from here — this module is what the
// server imports.
export { kindFromPath };

// --- YAML date normalization -------------------------------------------------

/**
 * gray-matter's js-yaml parses unquoted `2026-08-19` and
 * `2026-08-19T19:32:00` as JS Date objects (zone-less timestamps are read
 * as UTC). We normalize them back to the plain strings the format uses:
 * date-only -> `yyyy-mm-dd`, datetime -> `yyyy-mm-ddTHH:MM` (no zone — the
 * wall-clock digits as written in the file, which is why we read them back
 * with the UTC getters).
 *
 * SECONDS are kept when they are not zero (issue #40 AK8): the session's
 * `pauses` intervals are second-precise, and truncating them here would make
 * every pause up to a minute wrong on the next read. Since issue #58 the same
 * holds for `started`/`ended`: they are written to the second so that a fresh
 * session's timer starts at 0:00:00 instead of somewhere inside the current
 * minute. Dropping a `:00` is harmless (same instant); a `:37` is not.
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

/** Filename without directories and without the `.md` extension. */
function fileStem(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return basename.endsWith(".md") ? basename.slice(0, -3) : basename;
}

/**
 * Parse one markdown file into a ParsedFile. Never throws:
 *
 * - Invalid/unparseable YAML (or a block that is valid YAML but not a
 *   mapping) degrades to properties `{}` with the ENTIRE raw content as body.
 * - Unknown properties keys are preserved verbatim.
 * - Date values are normalized back to strings (see normalizeDates).
 * - Missing `id` falls back to the filename without `.md` — the file name
 *   is the only stable identity a properties-less file has, and for
 *   sessions/inbox/glossary it matches the convention anyway.
 * - Missing display name falls back to the id (`title` for scene/chapter,
 *   `name` for npc/location/campaign).
 */
export function parseMarkdown(raw: string, path: string, rev: number): ParsedFile {
  const kind = kindFromPath(path);

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
        : fileStem(path);
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

// --- summary builders ----------------------------------------------------------
// Defensive coercion helpers: properties is hand-edited, so every field can
// arrive with the wrong type. Summaries always deliver the shape the tree
// needs and never throw.

/** Coerce to a string array: scalar -> wrapped, members -> String()ed. */
function asStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined && v !== null)
      .map((v) => String(v));
  }
  return [String(value)];
}

/** Coerce a scalar to string; undefined/null/objects yield undefined. */
function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** Coerce to string with a fallback for missing/unusable values. */
function asStringOr(value: unknown, fallback: string): string {
  return asOptionalString(value) ?? fallback;
}

export function sceneSummary(f: ParsedFile): SceneSummary {
  const fm = f.properties;
  const id = asStringOr(fm.id, fileStem(f.path));
  return {
    path: f.path,
    id,
    title: asStringOr(fm.title, id),
    // "planned" is the unmarked case (contingency is the exception),
    // "draft" is the conservative lifecycle default.
    type: asStringOr(fm.type, "planned"),
    status: asStringOr(fm.status, "draft"),
    trigger: asOptionalString(fm.trigger),
    location: asOptionalString(fm.location),
    npcs: asStringArray(fm.npcs),
    tags: asStringArray(fm.tags),
  };
}

export function npcSummary(f: ParsedFile): NpcSummary {
  const fm = f.properties;
  const id = asStringOr(fm.id, fileStem(f.path));
  return {
    path: f.path,
    id,
    name: asStringOr(fm.name, id),
    role: asOptionalString(fm.role),
    status: asStringOr(fm.status, "unknown"),
    chapter: asOptionalString(fm.chapter),
  };
}

export function locationSummary(f: ParsedFile): LocationSummary {
  const fm = f.properties;
  const id = asStringOr(fm.id, fileStem(f.path));
  return {
    path: f.path,
    id,
    name: asStringOr(fm.name, id),
    chapter: asOptionalString(fm.chapter),
  };
}

export function sessionSummary(f: ParsedFile): SessionSummary {
  const fm = f.properties;
  return {
    path: f.path,
    id: asStringOr(fm.id, fileStem(f.path)),
    started: asOptionalString(fm.started),
    ended: asOptionalString(fm.ended),
    scenes_played: asStringArray(fm.scenes_played),
  };
}
