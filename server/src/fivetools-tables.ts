// Reading the random tables of a 5etools homebrew file.
//
// The 5etools homebrew repository (TheGiddyLimit/homebrew) keeps its tables in
// one shape: a file names its sources in `_meta.sources`, and each entry of its
// `table` list has a `name`, the `source` it belongs to, `colLabels`, and
// `rows`, whose first cell is the die result a row stands for ("7", "2-5",
// "96-00") where the table is rolled with a die. Cells hold 5etools inline
// tags (`{@creature goblin|MM}`) and, rarely, entry objects instead of text.
//
// The format degrades: a cell of an unknown shape becomes whatever text it
// holds, a table whose first column is not a die result is read as a list of
// equally likely rows, and nothing here throws on the content of a table. Only
// a file that is not a 5etools file at all is refused.

import { z } from "zod";
import { toSlug } from "@grimoire/shared/slug";
import type { RandomTableRow } from "@grimoire/shared/random-table";
import { ApiError } from "./api-error";

/** The parts of a 5etools file an import reads; everything else is ignored. */
const fivetoolsFileSchema = z.looseObject({
  _meta: z.looseObject({
    sources: z.array(
      z.looseObject({
        json: z.string(),
        full: z.string().optional(),
        authors: z.array(z.string()).optional(),
        url: z.string().optional(),
      }),
    ),
  }),
  table: z
    .array(
      z.looseObject({
        name: z.string(),
        source: z.string(),
        caption: z.string().optional(),
        colLabels: z.array(z.unknown()).optional(),
        intro: z.array(z.unknown()).optional(),
        rows: z.array(z.array(z.unknown())),
      }),
    )
    .optional(),
});

/** One source of a file, with the tables that belong to it. */
export interface ImportedSource {
  id: string;
  title: string;
  authors: string[];
  url: string;
  tables: ImportedTable[];
}

/** One table of a source, ready to be written. */
export interface ImportedTable {
  id: string;
  name: string;
  caption: string;
  intro: string;
  die: number | null;
  columns: string[];
  rows: RandomTableRow[];
}

/**
 * The sources of a 5etools file with their tables, in the file's order. A
 * source without a table is left out; a file that is no 5etools file, or has
 * no table at all, is a 400 that writes nothing.
 */
export function readFivetoolsTables(raw: unknown): ImportedSource[] {
  const parsed = fivetoolsFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "not a 5etools file — it needs _meta.sources and a table list", {
      code: "import_not_fivetools",
    });
  }
  const file = parsed.data;
  const sources: ImportedSource[] = [];
  for (const meta of file._meta.sources) {
    const id = toSlug(meta.json) || toSlug(meta.full ?? "");
    if (id === "" || sources.some((source) => source.id === id)) continue;
    const taken = new Set<string>();
    const tables = (file.table ?? [])
      .filter((table) => table.source === meta.json)
      .map((table) => readTable(id, table, taken));
    if (tables.length === 0) continue;
    sources.push({
      id,
      title: plainText(meta.full ?? meta.json),
      authors: (meta.authors ?? []).map(plainText),
      url: meta.url ?? "",
      tables,
    });
  }
  if (sources.length === 0) {
    throw new ApiError(400, "the file holds no random table", { code: "import_no_tables" });
  }
  return sources;
}

type FivetoolsTable = NonNullable<z.infer<typeof fivetoolsFileSchema>["table"]>[number];

/** One table of a source; `taken` keeps the ids of the source's tables apart. */
function readTable(source: string, table: FivetoolsTable, taken: Set<string>): ImportedTable {
  const base = `${source}-${toSlug(table.name) || "table"}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);

  const labels = (table.colLabels ?? []).map(cellText);
  const ranges = table.rows.map((row) => dieRange(row[0]));
  const ranged = table.rows.length > 0 && ranges.every((range) => range !== null);
  const width = Math.max(labels.length, ...table.rows.map((row) => row.length));
  const first = ranged ? 1 : 0;
  const columns = Array.from({ length: width - first }, (_, i) => labels[first + i] ?? "");
  const rows = table.rows.map((row, i) => {
    const range = ranged ? ranges[i]! : null;
    const cells = columns.map((_, c) => cellText(row[first + c]));
    return { min: range?.min ?? null, max: range?.max ?? null, cells };
  });
  const die = ranged ? Math.max(...rows.map((row) => row.max!)) : null;
  return {
    id,
    name: plainText(table.name),
    caption: plainText(table.caption ?? ""),
    intro: (table.intro ?? [])
      .map(cellText)
      .filter((text) => text !== "")
      .join("\n\n"),
    die: die !== null && die > 0 ? die : null,
    columns,
    rows,
  };
}

/**
 * The die results a first cell stands for: `7`, `2-5`, `96-00` (a d100's
 * `00` is 100), or a 5etools cell object with `roll: { exact }` or
 * `roll: { min, max }`. Anything else is null.
 */
export function dieRange(cell: unknown): { min: number; max: number } | null {
  if (typeof cell === "number" && Number.isInteger(cell)) return { min: cell, max: cell };
  if (typeof cell === "string") {
    const match = /^\s*(\d+)\s*(?:[-–—]\s*(\d+))?\s*$/.exec(plainText(cell));
    if (match === null) return null;
    const min = dieNumber(match[1]!);
    const max = match[2] === undefined ? min : dieNumber(match[2]);
    return min <= max ? { min, max } : null;
  }
  if (isRecord(cell) && isRecord(cell.roll)) {
    const { exact, min, max } = cell.roll;
    if (typeof exact === "number") return { min: exact, max: exact };
    if (typeof min === "number" && typeof max === "number" && min <= max) return { min, max };
  }
  return null;
}

/** A die number as written; `00` (and `000`) is the top face of a d100 (d1000). */
function dieNumber(digits: string): number {
  return /^0{2,}$/.test(digits) ? 10 ** digits.length : Number(digits);
}

/**
 * The plain text of a cell: a string without its inline tags, a number as
 * written, and an entry object as the text it holds (its name, its entries,
 * its items), joined by spaces.
 */
export function cellText(cell: unknown): string {
  if (typeof cell === "string") return plainText(cell);
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
  if (Array.isArray(cell)) return join(cell.map(cellText));
  if (!isRecord(cell)) return "";
  const range = dieRange(cell);
  if (range !== null && cell.entry === undefined) {
    return range.min === range.max ? String(range.min) : `${range.min}-${range.max}`;
  }
  const parts: string[] = [];
  for (const key of ["name", "entry", "entries", "items", "rows"]) {
    if (cell[key] !== undefined) parts.push(cellText(cell[key]));
  }
  return join(parts);
}

function join(parts: string[]): string {
  return parts.filter((part) => part !== "").join(" ");
}

/**
 * Tags whose display text is the first part, never a later one: their later
 * parts are addresses (a book's chapter and section), not a label.
 */
const FIRST_PART_TAGS = new Set([
  "book",
  "adventure",
  "dice",
  "damage",
  "d20",
  "scaledice",
  "scaledamage",
]);

/**
 * A string with its 5etools inline tags read as the text they display:
 * `{@creature goblin|MM}` is "goblin", `{@item longsword|PHB|a sword}` is
 * "a sword", `{@dc 15}` is "DC 15", `{@hit 4}` is "+4", `{@b bold}` is
 * "bold". Nested tags are read from the inside out.
 */
export function plainText(text: string): string {
  let out = text;
  const tag = /\{@(\w+)\s*([^{}]*)\}/g;
  for (let guard = 0; guard < 10 && out.includes("{@"); guard += 1) {
    out = out.replace(tag, (_, name: string, body: string) => tagText(name, body));
  }
  return out.trim();
}

function tagText(name: string, body: string): string {
  const parts = body.split("|");
  const first = parts[0]!.trim();
  switch (name) {
    case "dc":
      return `DC ${first}`;
    case "hit":
      return first.startsWith("-") || first.startsWith("+") ? first : `+${first}`;
    case "h":
      return "Hit:";
    case "atk":
      return "Attack:";
    case "recharge":
      return first === "" ? "(Recharge 6)" : `(Recharge ${first}-6)`;
    default:
      if (name === "chance") return parts[1]?.trim() || `${first}%`;
      if (FIRST_PART_TAGS.has(name)) return first;
      return parts[2]?.trim() || first;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
