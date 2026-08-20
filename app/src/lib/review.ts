// Pure helpers of the review view ("Fünf Minuten Ernte", issue #10):
// hashtag handling, the inbox list-line parser, the "Offene Fäden"
// checklist parser, the NPC-slug derivation for the stub dialog and the
// short hash that marks a log line as reviewed. No react, no query imports.
//
// Everything degrades (README): unparsable input yields empty results or
// passes through unchanged, never an error.

/**
 * The log/inbox hashtags the review harvests (README, "Hashtags im Log").
 * `#date` is deliberately NOT one of them — in-game dates are no harvest.
 */
export const REVIEW_TAGS = ["thread", "npc", "loot", "decision"] as const;

/** One of the four harvest tags? */
export function isReviewTag(tag: string): boolean {
  const tags: readonly string[] = REVIEW_TAGS;
  return tags.includes(tag);
}

/** Actions the review offers for a tag (prototype: thread/decision → thread). */
export function tagAllowsThread(tag: string): boolean {
  return tag === "thread" || tag === "decision";
}

export function tagAllowsNpc(tag: string): boolean {
  return tag === "npc";
}

// `#tag` — letters/digits (unicode: `#öl` works), then also `_`/`-`.
const HASHTAG = /#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

/** All hashtags of a line, lowercased, in order (without the `#`). */
export function extractHashtags(text: string): string[] {
  return [...text.matchAll(HASHTAG)].map((m) => (m[1] ?? "").toLowerCase());
}

/** The first hashtag from REVIEW_TAGS — the log-line filter of the review. */
export function firstReviewTag(text: string): string | undefined {
  return extractHashtags(text).find(isReviewTag);
}

/**
 * Display text of an entry: hashtags removed, whitespace collapsed
 * (prototype: `text.replace(/\s*#\w+/g, '')`). A line that is nothing but
 * hashtags keeps its original text — an empty card would be worse.
 */
export function stripHashtags(text: string): string {
  const stripped = text
    .replace(/\s*#[\p{L}\p{N}][\p{L}\p{N}_-]*/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    // A leading em dash is log-line formatting (scene-less notes), not content.
    .replace(/^[—–-]\s+/, "");
  return stripped === "" ? text.trim() : stripped;
}

// --- inbox lines --------------------------------------------------------------

export interface InboxLine {
  /** Line index inside the body — stable identity: `inbox-done` rewrites the
   *  line in place, appends go to the end. */
  index: number;
  /** The line EXACTLY as it stands in the body — `/review/inbox-done`
   *  matches it byte for byte. */
  raw: string;
  /** Display text: checkbox marker, leading date and hashtags removed. */
  text: string;
  /** Leading `yyyy-mm-dd` of the inbox convention, when present. */
  date?: string;
  tags: string[];
  /** `- [x] …` — already harvested in an earlier review. */
  done: boolean;
}

const CHECKBOX = /^\[([ xX])\]\s*/;
const LEADING_DATE = /^(\d{4}-\d{2}-\d{2})\s+/;

/**
 * All top-level `- ` list lines of inbox.md (frontmatter-stripped body), in
 * file order. Indented lines are skipped: the write API only accepts lines
 * starting with `- `. Nothing is filtered here — see harvestInboxEntries.
 */
export function parseInboxEntries(body: string): InboxLine[] {
  const out: InboxLine[] = [];
  // Exact split (not /\r?\n/): the raw line has to match the file byte for byte.
  body.split("\n").forEach((raw, index) => {
    if (!raw.startsWith("- ")) return;
    let rest = raw.slice(2);
    let done = false;
    const marker = CHECKBOX.exec(rest);
    if (marker !== null) {
      done = (marker[1] ?? " ") !== " ";
      rest = rest.slice(marker[0].length);
    }
    const dateMatch = LEADING_DATE.exec(rest);
    if (dateMatch !== null) rest = rest.slice(dateMatch[0].length);
    const entry: InboxLine = {
      index,
      raw,
      text: stripHashtags(rest),
      tags: extractHashtags(rest),
      done,
    };
    const date = dateMatch?.[1];
    if (date !== undefined) entry.date = date;
    out.push(entry);
  });
  return out;
}

/**
 * The inbox lines the review offers: only tagged ones (untagged ideas stay
 * in the inbox — prototype), and `- [x] …` lines only when they were acted
 * on in THIS browser session (`keepDone`, so a card does not vanish under
 * the cursor). Everything else stays out so harvested ideas never resurface
 * in a later review (README, inbox exception).
 */
export function harvestInboxEntries(
  body: string,
  keepDone: ReadonlySet<number> = new Set<number>(),
): InboxLine[] {
  return parseInboxEntries(body).filter(
    (line) => line.tags.length > 0 && (!line.done || keepDone.has(line.index)),
  );
}

// --- chapter checklist ("Offene Fäden") ---------------------------------------

export interface ChecklistItem {
  text: string;
  done: boolean;
}

/**
 * Checkbox list items below the H2 with the given text (exact match,
 * case-insensitive). Missing heading or non-checkbox lines simply yield
 * fewer items — never an error.
 */
export function parseChecklist(body: string, heading: string): ChecklistItem[] {
  const lines = body.split(/\r?\n/);
  const wanted = heading.trim().toLowerCase();
  const start = lines.findIndex(
    (line) =>
      /^##(?!#)/.test(line.trim()) &&
      line.trim().replace(/^##\s*/, "").trim().toLowerCase() === wanted,
  );
  if (start === -1) return [];

  const items: ChecklistItem[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    if (/^#{1,6}(\s|$)/.test(line)) break; // next section ends the list
    const m = /^-\s+\[([ xX])\]\s*(.*)$/.exec(line);
    if (m === null) continue;
    items.push({ text: (m[2] ?? "").trim(), done: (m[1] ?? " ") !== " " });
  }
  return items;
}

// --- npc slug ----------------------------------------------------------------

/** Mirrors the server's NPC_SLUG (campaign-write.ts) — kebab-case ids. */
export function isNpcSlug(id: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);
}

const QUOTED = /["“„»'‚]([^"“”„«»'‚‘]{2,40})["”“«'‘]/u;
const CAPITALIZED = /\p{Lu}[\p{L}'-]*(?:\s+\p{Lu}[\p{L}'-]*){0,2}/gu;

/**
 * The name a log line probably introduces: a quoted name wins
 * (`Improvisiert: Fischerin "Old Metta" am Steg` → `Old Metta`), otherwise
 * the first run of capitalized words that is not a label ending in `:`.
 * Undefined when nothing looks like a name — the dialog then starts empty.
 */
export function npcNameFromText(text: string): string | undefined {
  const quoted = QUOTED.exec(text);
  const inQuotes = quoted?.[1]?.trim();
  if (inQuotes !== undefined && inQuotes !== "") return inQuotes;

  for (const match of text.matchAll(CAPITALIZED)) {
    const name = match[0].trim();
    const after = text.charAt((match.index ?? 0) + match[0].length);
    if (after === ":") continue; // "Improvisiert:", "Neuer NPC:" — a label
    if (name !== "") return name;
  }
  return undefined;
}

const UMLAUTS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

/** Kebab-case slug of a display name (German transliteration, diacritics
 *  folded); an empty string when nothing usable is left. */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Slug proposal for the NPC-stub dialog (editable there); "" when the text
 *  carries no recognizable name. */
export function deriveNpcSlug(text: string): string {
  const name = npcNameFromText(text);
  return name === undefined ? "" : toSlug(name);
}

// --- reviewed short hash ------------------------------------------------------

/**
 * The `reviewed` entry of a log line: first 8 hex chars of SHA-256 over the
 * UTF-8 bytes of the RAW line (README; server: campaign-write.ts
 * `shortLineHash`). Byte-identical to the server — the app only compares
 * hashes it computed the same way.
 */
export async function shortLineHash(line: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(line));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

/** line → short hash for a batch of raw log lines (duplicates collapse). */
export async function shortLineHashes(
  lines: readonly string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(lines)];
  const hashes = await Promise.all(unique.map(shortLineHash));
  return Object.fromEntries(unique.map((line, i) => [line, hashes[i] as string]));
}
