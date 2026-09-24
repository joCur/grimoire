// AN NPC — its one zod schema and the forms derived from it (ADR #31).
//
// `npcSchema` is the npc as `GET /api/campaigns/:c/npcs/:id` answers it. The
// TypeScript type, the PATCH the resource accepts, the npc a fixture holds and
// a generator run proposes, and the generator's reply are each derived from
// it below with zod's own API, so a new field of an npc is one line in the
// schema and one in its form fields.
//
// The FORM FIELDS the app's dialog is built from stand here too, keyed by the
// same field names: which control edits a field, which list a reference picks
// from, and where it is edited. They are typed against the schema, so a field
// without a form entry — or a form entry without a field — does not compile.

import { z } from "zod";
import type { PropertyFieldDef } from "./property-fields";

/** An npc's states. A CHECK constraint holds the column to them (ADR #25). */
export const NPC_STATUSES = ["alive", "dead", "missing", "unknown"] as const;
export type NpcStatus = (typeof NPC_STATUSES)[number];

/**
 * An npc, exactly as `GET /api/campaigns/:c/npcs/:id` answers it: `id` its
 * stable key, `name` the display name (the id stands in for an npc that has
 * none), `role` a one-liner, `chapter` the chapter it is introduced in,
 * `status` whether it is alive, `statblock` the Roll20 sheet it refers to
 * (never a copy), `quickstats` the few values the table needs socially (a
 * free key/value set, `{ "insight": "+2" }`), `voice` and `appearance` how it
 * comes across, `motivation` what it wants — shown on the npc card and in the
 * reference preview —, `body` its markdown, and `rev` the row version a PATCH
 * sends back as its guard.
 */
export const npcSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
  chapter: z.string().optional(),
  status: z.enum(NPC_STATUSES),
  statblock: z.string().optional(),
  quickstats: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  voice: z.string().optional(),
  appearance: z.string().optional(),
  motivation: z.string().optional(),
  body: z.string(),
  rev: z.number(),
});

export type Npc = z.infer<typeof npcSchema>;

/** The fields of an npc by name, its guard aside. */
export type NpcFields = Omit<Npc, "rev">;

/**
 * An npc without its guard: what a fixture holds
 * (`fixtures/<campaign>/npcs/<id>.json`), what a generator run proposes and
 * what accepting that proposal writes.
 */
export const npcProposalSchema = npcSchema.omit({ rev: true });

export type NpcProposal = z.infer<typeof npcProposalSchema>;

/** The optional fields of an npc as they are cleared: `null` removes the value. */
const clearableNpcFields = {
  role: z.string().nullable(),
  chapter: z.string().nullable(),
  statblock: z.string().nullable(),
  quickstats: npcSchema.shape.quickstats.unwrap().nullable(),
  voice: z.string().nullable(),
  appearance: z.string().nullable(),
  motivation: z.string().nullable(),
};

/**
 * The body of `PATCH /api/campaigns/:c/npcs/:id`: the guard, the optional
 * `force`, and any subset of the fields — `body` is one of them, and `null`
 * clears an optional one. The id may be echoed, never changed. Strict like
 * the schema it comes from: a key that is none of these is a 400 naming it.
 */
export const npcPatchSchema = npcProposalSchema
  .extend(clearableNpcFields)
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type NpcPatch = z.infer<typeof npcPatchSchema>;

/** The fields of one npc write, guard and `force` aside — what an editing surface builds. */
export const npcChangeSchema = npcPatchSchema.omit({ rev: true, force: true });

export type NpcChange = z.infer<typeof npcChangeSchema>;

/**
 * The body of `POST /api/campaigns/:c/npcs`: the typed name, the id the DM
 * set (absent: derived from the name) and the npc's markdown (absent: empty).
 */
export const npcCreateSchema = z.strictObject({
  name: z.string(),
  id: z.string().optional(),
  body: z.string().optional(),
});

export type NpcCreate = z.infer<typeof npcCreateSchema>;

/**
 * One `quickstats` value in a generator reply. A free key/value set cannot
 * be said in the strict form a provider enforces, so the reply carries it as
 * a list of pairs, every value a string (`"+2"`).
 */
export const quickstatPairSchema = z.strictObject({ key: z.string(), value: z.string() });

export type QuickstatPair = z.infer<typeof quickstatPairSchema>;

/**
 * The reply of an npc call, in the strict form a provider enforces: the
 * proposed npc with every optional field nullable instead — the model says
 * „not given" with `null` —, `quickstats` as its list of pairs, and the
 * model's `warnings` for the DM beside the fields. Create and augment runs
 * share it.
 */
export const npcReplySchema = npcProposalSchema.extend({
  role: z.string().nullable(),
  chapter: z.string().nullable(),
  statblock: z.string().nullable(),
  quickstats: z.array(quickstatPairSchema).nullable(),
  voice: z.string().nullable(),
  appearance: z.string().nullable(),
  motivation: z.string().nullable(),
  warnings: z.array(z.string()),
});

export type NpcReplyObject = z.infer<typeof npcReplySchema>;

/** The npc in its reply form, `warnings` aside — how an augment prompt shows it. */
export type NpcReplyFields = Omit<NpcReplyObject, "warnings">;

/**
 * An npc reply as the proposal it stands for, the one conversion every run
 * uses: the npc without its guard — an optional field the model answered with
 * `null` is absent, never `null`, and the pairs of `quickstats` are folded
 * into its key/value set (a pair without a key is dropped, and a set without
 * a pair is absent) — and the model's `warnings` apart from it.
 */
export function npcFromReply(reply: NpcReplyObject): {
  npc: NpcProposal;
  warnings: string[];
} {
  const {
    role,
    chapter,
    statblock,
    quickstats,
    voice,
    appearance,
    motivation,
    warnings,
    ...fields
  } = reply;
  const stats = Object.fromEntries(
    (quickstats ?? [])
      .map((pair): [string, string] => [pair.key.trim(), pair.value.trim()])
      .filter(([key]) => key !== ""),
  );
  return {
    npc: {
      ...fields,
      ...(role === null ? {} : { role }),
      ...(chapter === null ? {} : { chapter }),
      ...(statblock === null ? {} : { statblock }),
      ...(Object.keys(stats).length === 0 ? {} : { quickstats: stats }),
      ...(voice === null ? {} : { voice }),
      ...(appearance === null ? {} : { appearance }),
      ...(motivation === null ? {} : { motivation }),
    },
    warnings,
  };
}

/**
 * An npc in the reply form, `warnings` aside — the reverse of
 * `npcFromReply`: an absent optional field is `null`, and `quickstats` is its
 * list of pairs. An augment prompt shows the npc this way, so the model reads
 * it in the very shape it has to answer in. A stored number travels as its
 * string (`2` becomes `"2"`), the one form a pair value has.
 */
export function npcToReply(npc: NpcProposal): NpcReplyFields {
  return {
    id: npc.id,
    name: npc.name,
    role: npc.role ?? null,
    chapter: npc.chapter ?? null,
    status: npc.status,
    statblock: npc.statblock ?? null,
    quickstats:
      npc.quickstats === undefined
        ? null
        : Object.entries(npc.quickstats).map(([key, value]) => ({ key, value: String(value) })),
    voice: npc.voice ?? null,
    appearance: npc.appearance ?? null,
    motivation: npc.motivation ?? null,
    body: npc.body,
  };
}

/**
 * A change applied to an npc proposal: a named field replaces the value,
 * `null` clears an optional one, and a field the change leaves out keeps the
 * proposal's value. What a review edit does to a proposed npc before it is
 * written.
 */
export function withNpcChange(npc: NpcProposal, change: NpcChange): Record<string, unknown> {
  const next: Record<string, unknown> = { ...npc };
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

// --- the form fields ------------------------------------------------------------

/**
 * How the app edits each field, in the order the dialog shows them. `id` is
 * fixed at creation (ADR #21) and `body` has its own editor, so neither is
 * here; `motivation` is edited beside the body, not in the dialog
 * (`surface: "text"`, ADR #29).
 */
const NPC_FORM: {
  [K in Exclude<keyof NpcFields, "id" | "body">]-?: Omit<PropertyFieldDef, "key">;
} = {
  name: { control: "text", required: true },
  role: { control: "text" },
  chapter: { control: "reference", source: "chapters" },
  status: { control: "select", values: NPC_STATUSES },
  statblock: { control: "text" },
  quickstats: { control: "pairs" },
  voice: { control: "textarea" },
  appearance: { control: "textarea" },
  motivation: { control: "textarea", surface: "text" },
};

/** The form fields of an npc, as a list in dialog order. */
export const NPC_FIELDS: readonly PropertyFieldDef[] = Object.entries(NPC_FORM).map(
  ([key, def]) => ({ key, ...def }),
);
