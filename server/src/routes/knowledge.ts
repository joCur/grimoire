// The knowledge base: the generator's naming conventions, facts and style
// rules, read and written as a whole list.

import { Hono } from "hono";
import { isKnowledgeKind, KNOWLEDGE_KINDS, type KnowledgeEntry } from "@grimoire/shared";
import { ApiError } from "../api-error";
import { readKnowledge, writeKnowledge } from "../store/knowledge";
import { isPlainObject, jsonBody, requireRev } from "./http";

export const knowledgeRoutes = new Hono();

/**
 * One SINGLE-LINE field of a knowledge entry.
 *
 * The knowledge list feeds the generator prompt, where an entry becomes one
 * bullet in markdown the model reads as INSTRUCTIONS
 * (store/knowledge.ts knowledgeText). A newline inside an entry is
 * therefore not a formatting detail: it lets an entry open lines of its own —
 * a `## ` heading that poses as a section of the prompt, for instance. The UI
 * has single-line inputs and cannot produce one, so refusing it costs the DM
 * nothing and closes the door for every other client.
 *
 * The prompt assembly stays defensive as well (`promptInline`) — this is the
 * validator, not the only line of defence.
 */
function requireSingleLine(value: string, key: string): string {
  if (/[\r\n]/u.test(value)) throw new ApiError(400, `${key} must be a single line`);
  return value;
}

// GET /api/campaigns/:campaign/knowledge -> { entries: [{ kind, from, to, text }], rev }
// The campaign's KNOWLEDGE BASE for the generator: naming
// conventions ("write <from> as <to>"), facts and style rules that outrank
// the source material. Its own list next to the glossary because it answers
// a different question — the glossary translates a term, an entry here
// overrides the source (db/schema.ts campaignKnowledge). Guard token:
// `campaigns.knowledge_rev`.
knowledgeRoutes.get("/campaigns/:campaign/knowledge", async (c) =>
  c.json(await readKnowledge(c.req.param("campaign"))),
);

// PUT /api/campaigns/:campaign/knowledge { entries: [{ kind, from?, to?, text? }], rev }
//   -> { entries, rev }
// The knowledge list's write, with the glossary's contract to the letter:
// the whole list, the array order IS the order, `rev` guards it and a stale
// one is a 409 `rev_conflict` carrying the current `rev`. Same page, same
// rules. It carries no `entry`, because the knowledge base has no entry
// address of its own — the list itself is the resource.
//
// A `naming` entry's pair may be HALF-FILLED here on purpose — that is a
// convention the DM has not finished typing, and refusing the save would
// lose the rest of the list with it. The prompt skips incomplete rules
// instead (store/knowledge.ts knowledgeText), which is where a half rule could do
// damage.
//
// An entry's fields must be SINGLE LINE (400 otherwise): an entry becomes
// ONE bullet of the generator prompt, and a newline would let it open lines
// — headings, even — of its own. The glossary keeps taking wrapped
// explanations and is flattened for the prompt instead.
knowledgeRoutes.put("/campaigns/:campaign/knowledge", async (c) => {
  const body = await jsonBody(c, ["entries", "rev"]);
  const raw = body.entries;
  if (!Array.isArray(raw)) throw new ApiError(400, "entries must be an array");
  const entries: KnowledgeEntry[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) throw new ApiError(400, "each entry must be an object");
    if (!isKnowledgeKind(item.kind)) {
      throw new ApiError(400, `each entry needs a kind of ${KNOWLEDGE_KINDS.join(", ")}`);
    }
    const str = (key: "from" | "to" | "text"): string => {
      const value = item[key];
      if (value === undefined || value === null) return "";
      if (typeof value !== "string") throw new ApiError(400, `${key} must be a string`);
      return requireSingleLine(value, key);
    };
    entries.push({ kind: item.kind, from: str("from"), to: str("to"), text: str("text") });
  }
  return c.json(await writeKnowledge(c.req.param("campaign"), entries, requireRev(body.rev)));
});
