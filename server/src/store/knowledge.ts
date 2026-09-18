// Kampagnenwissen: the facts, style rules and naming conventions the DM
// keeps on the settings page.
//
// A list of rows with its own guard token (`campaigns.knowledge_rev`), read
// and written as a whole. Its second job is the generator's: the same rows
// become the `## Kampagnenwissen` block of the prompt and the input of the
// post-run naming check, with `[[slug]]` references resolved and every entry
// flattened to one line.

import { asc, eq } from "drizzle-orm";
import {
  isKnowledgeKind,
  type KnowledgeEntry,
  type KnowledgeResponse,
} from "@grimoire/shared";
import type { GrimoireDb } from "../db/client";
import { campaignKnowledge, campaigns } from "../db/schema";
import { mutate, requireCampaign, requireCampaignRow } from "./campaigns";
import { getDb } from "./handle";
import { expandBodyRefs } from "./refs";
import { guardRev } from "./shared";

// --- the stored rows ----------------------------------------------------------

/**
 * One `campaign_knowledge` row as it comes out of the table. Its own shape
 * (not `KnowledgeEntry`) because `kind` is whatever the column holds: a row
 * written by an older build, or by hand, degrades to `fact` on the way OUT
 * instead of making the read fail (CLAUDE.md, "Format degradiert").
 */
export interface KnowledgeRow {
  kind: string;
  fromText: string;
  toText: string;
  text: string;
  pos: number;
}

/** The campaign-knowledge list in its stored order. */
export function knowledgeRows(db: GrimoireDb, campaign: string): KnowledgeRow[] {
  return db
    .select({
      kind: campaignKnowledge.kind,
      fromText: campaignKnowledge.fromText,
      toText: campaignKnowledge.toText,
      text: campaignKnowledge.text,
      pos: campaignKnowledge.pos,
    })
    .from(campaignKnowledge)
    .where(eq(campaignKnowledge.campaignId, campaign))
    .orderBy(asc(campaignKnowledge.pos))
    .all() as KnowledgeRow[];
}

/** One stored row as the API shape — an unknown `kind` degrades to `fact`. */
export function knowledgeEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    kind: isKnowledgeKind(row.kind) ? row.kind : "fact",
    from: row.fromText,
    to: row.toText,
    text: row.text,
  };
}

/** GET /api/campaigns/:campaign/knowledge -> `{ entries, rev }`. */
export async function readKnowledge(campaign: string): Promise<KnowledgeResponse> {
  const row = await requireCampaign(campaign);
  const db = await getDb();
  return {
    entries: knowledgeRows(db, campaign).map(knowledgeEntry),
    rev: row.knowledgeRev,
  };
}

// --- PUT /api/campaigns/:campaign/knowledge -----------------------------------

/**
 * PUT /api/campaigns/:campaign/knowledge `{ entries, rev }` -> the stored list + its
 * fresh `rev`.
 *
 * Exactly the glossary's contract, deliberately: the DM edits both lists on
 * the same page, so "the whole list plus its guard token" is ONE thing to
 * understand instead of two. The list is replaced rather than diffed — which
 * is what makes reordering, deleting and editing the same request — and
 * `pos` is handed out fresh from the array order.
 *
 * ENTRIES ARE NOT DROPPED HERE for being half-filled: an empty `to` is a
 * convention the DM has not finished typing, and swallowing it on save would
 * lose work. The PROMPT skips those lines instead (`knowledgeText` below),
 * which is where an incomplete rule can actually do damage.
 */
export async function writeKnowledge(
  campaign: string,
  entries: KnowledgeEntry[],
  rev: number,
): Promise<KnowledgeResponse> {
  return mutate(campaign, (tx) => {
    const row = requireCampaignRow(tx, campaign);
    guardRev(row.knowledgeRev, rev, "campaign knowledge changed");
    tx.delete(campaignKnowledge).where(eq(campaignKnowledge.campaignId, campaign)).run();
    let pos = 0;
    for (const entry of entries) {
      tx.insert(campaignKnowledge)
        .values({
          campaignId: campaign,
          pos: pos++,
          kind: entry.kind,
          fromText: entry.from,
          toText: entry.to,
          text: entry.text,
        })
        .run();
    }
    const nextRev = row.knowledgeRev + 1;
    tx.update(campaigns)
      .set({ knowledgeRev: nextRev })
      .where(eq(campaigns.id, campaign))
      .run();
    return { entries: knowledgeRows(tx, campaign).map(knowledgeEntry), rev: nextRev };
  });
}

// --- the prompt block ---------------------------------------------------------

/**
 * The KNOWLEDGE lines of the prompt — the list the generator
 * puts above the glossary, in stored order, one line per entry:
 *
 *     - Namenskonvention: schreibe „Alt“ immer als „Neu“.
 *     - Fakt: <Satz>
 *     - Stilregel: <Satz>
 *
 * German, like the rest of the prompt (llm-provider.ts: the pipeline's target
 * language is German) — this is prompt CONTENT, not UI copy, so it does not
 * belong in the app's catalog.
 *
 * `[[slug]]` references are RESOLVED here with the same expansion the
 * search index uses (store/refs.ts): a fact written as „[[fenn]] lügt immer“
 * must reach the model as „Fenn lügt immer“ — the model has never seen a
 * slug table and would otherwise copy the brackets into the prose.
 *
 * `undefined` when the campaign has no knowledge at all, so the prompt keeps
 * the exact shape it had before this feature.
 */
export async function knowledgeText(campaign: string): Promise<string | undefined> {
  const db = await getDb();
  const rows = knowledgeRows(db, campaign);
  const lines: string[] = [];
  for (const row of rows) {
    const entry = knowledgeEntry(row);
    const resolve = (value: string): string =>
      promptInline(expandBodyRefs(db, campaign, value));
    if (entry.kind === "naming") {
      if (entry.from.trim() === "" || entry.to.trim() === "") continue;
      lines.push(
        `- Namenskonvention: schreibe „${resolve(entry.from)}“ immer als „${resolve(entry.to)}“.`,
      );
      continue;
    }
    if (entry.text.trim() === "") continue;
    const label = entry.kind === "fact" ? "Fakt" : "Stilregel";
    lines.push(`- ${label}: ${resolve(entry.text)}`);
  }
  return lines.length === 0 ? undefined : lines.join("\n");
}

/**
 * The naming conventions as `from`/`to` pairs — the input of the post-run
 * check (naming-check.ts).
 *
 * REF-EXPANDED like the prompt lines: a rule written as
 * „[[fenn]]“ → „Fennwyn“ reaches the model as „Fenn“ → „Fennwyn“, so the
 * check has to search the drafts for „Fenn“ too — searching for the literal
 * „[[fenn]]“ would silently never match and make the rule look obeyed. Both
 * sides are expanded, because `to` is what the check uses to recognise the
 * already-correct spelling (naming-check.ts findRuleHits).
 */
export async function namingRules(campaign: string): Promise<Array<{ from: string; to: string }>> {
  const db = await getDb();
  const expand = (value: string): string =>
    promptInline(expandBodyRefs(db, campaign, value)).trim();
  return knowledgeRows(db, campaign)
    .map(knowledgeEntry)
    .filter((e) => e.kind === "naming" && e.from.trim() !== "" && e.to.trim() !== "")
    .map((e) => ({ from: expand(e.from), to: expand(e.to) }))
    .filter((e) => e.from !== "" && e.to !== "");
}

/**
 * One stored entry as it may appear INSIDE a prompt line.
 *
 * The lists are assembled into a markdown prompt, so an entry is a
 * fragment of an entry the model reads as instructions. The endpoints
 * already refuse newlines (routes/api.ts), and this is the second half of
 * that: whatever is in the database — a row from an older build, a hand-made
 * one, a value that slipped past a validator — can only ever become ONE line
 * of text here.
 *
 *   * all whitespace collapses to single spaces, so no entry can open a line
 *     of its own;
 *   * a leading „#“ is escaped to „\#“, so no entry can become a HEADING and
 *     pose as a section of the prompt („## Kampagnenwissen“ is the section
 *     the prompt itself writes, and it is binding).
 *
 * Defensive, not decorative: the DM is the only author, but the source text
 * they paste in is not theirs, and an entry is the one place where foreign
 * text is quoted into the instruction half of the prompt.
 */
export function promptInline(value: string): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.startsWith("#") ? `\\${flat}` : flat;
}
