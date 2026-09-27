// The OPERATIONS of a generator patch call and what the server makes of them
// (decisions/generator): a `set` of a field, a `replace`, `insertAfter` or
// `remove` of one block of `body` named by its text, or a `note`
// (@grimoire/shared/patch-reply).
//
// Two calls reply with operations: the patch round on a finished part, whose
// operations change a proposal of the run (./generator-patch.ts), and the
// extension of an npc or location the campaign already has, whose operations
// change its stored row (./generate-pipeline.ts `runExtensionPart`). Both
// read the reply here and judge every operation on its own against the
// entity the model saw:
//
//   anchors  a block operation hits exactly one block of that entity
//            (@grimoire/shared/body-patch), and every other byte of the body
//            stays as it is. An anchor that hits nothing or several blocks is
//            not applied; it becomes a finding that carries it.
//   fields   a `set` is read into the entity's own form and checked against
//            the entity's schema and against what the run may name; an
//            invalid value is not applied and becomes a finding. A `set` that
//            changes nothing is no change.
//
// A finding is data (`PatchFinding`), never a sentence: the app says it in
// the DM's language. The model's own `note` operations are its notes, free
// text like its `warnings`.

import { z } from "zod";
import {
  locationChangeSchema,
  locationFromReply,
  locationPatchReplySchema,
  locationToReply,
  npcChangeSchema,
  npcFromReply,
  npcPatchReplySchema,
  npcToReply,
  sceneChangeSchema,
  sceneFromReply,
  scenePatchReplySchema,
  sceneToReply,
  type GeneratorJobPart,
  type LocationProposal,
  type LocationReplyFields,
  type LocationReplyObject,
  type NpcProposal,
  type NpcReplyFields,
  type NpcReplyObject,
  type PartChange,
  type PatchFinding,
  type SceneProposal,
  type SceneReplyFields,
  type SceneReplyObject,
} from "@grimoire/shared";
import {
  applyBodyOperation,
  findAnchor,
  type BodyOperation,
  type BodyPatchFailure,
} from "@grimoire/shared/body-patch";
import type { PatchOperation, PatchReplySchema } from "@grimoire/shared/patch-reply";
import type { JsonSchema } from "@grimoire/shared/outline-schema";
import { bodyRefSlugs } from "@grimoire/shared/refs";
import { ASSET_FILES, unknownCallouts } from "./generator";
import { sameValue } from "./generator-augment";
import { parseJsonReply } from "./json-reply";
import type { ReplySchema } from "./llm-provider";

/** The entity a patch call is about. */
export type PartKind = GeneratorJobPart["kind"];

/** A proposal of a scene run, whatever its entity. */
export type Proposal = SceneProposal | NpcProposal | LocationProposal;

/** What a patch call of each entity is forced into and told about its fields. */
export const ENTITY: Record<
  PartKind,
  {
    reply: PatchReplySchema;
    replyName: string;
    change: z.ZodObject;
    /** The prompt file that describes the entity's fields. */
    fields: string;
  }
> = {
  scene: {
    reply: scenePatchReplySchema,
    replyName: "scene_patch",
    change: sceneChangeSchema,
    fields: ASSET_FILES.scene.fields,
  },
  npc: {
    reply: npcPatchReplySchema,
    replyName: "npc_patch",
    change: npcChangeSchema,
    fields: ASSET_FILES.npc.fields,
  },
  location: {
    reply: locationPatchReplySchema,
    replyName: "location_patch",
    change: locationChangeSchema,
    fields: ASSET_FILES.location.fields,
  },
};

/** A proposal in its entity's reply form — how the prompt shows it. */
export function replyForm(
  kind: PartKind,
  proposal: Proposal,
): SceneReplyFields | NpcReplyFields | LocationReplyFields {
  if (kind === "scene") return sceneToReply(proposal as SceneProposal);
  if (kind === "npc") return npcToReply(proposal as NpcProposal);
  return locationToReply(proposal as LocationProposal);
}

/** A reply form back as the proposal it stands for. */
export function fromReplyForm(kind: PartKind, form: Record<string, unknown>): Record<string, unknown> {
  const reply = { ...form, warnings: [] };
  if (kind === "scene") return sceneFromReply(reply as unknown as SceneReplyObject).scene;
  if (kind === "npc") return npcFromReply(reply as unknown as NpcReplyObject).npc;
  return locationFromReply(reply as unknown as LocationReplyObject).location;
}

// --- reading the reply ----------------------------------------------------------

/** One operation of a reply as the server read it — or one it could not read. */
export type ReadOperation = { ok: true; operation: PatchOperation } | { ok: false };

/** The schema a patch call is forced into, under the name of its entity. */
export function patchReplyRequest(kind: PartKind): ReplySchema {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(ENTITY[kind].reply) as JsonSchema;
  return { name: ENTITY[kind].replyName, schema };
}

/**
 * Read a patch reply. The envelope is the contract — an object with its list
 * of `operations`, or a correction turn. An operation that does not read as
 * one of the entity's operations is kept as unreadable: it costs that
 * operation, never the round.
 */
export function readPatchReply(
  raw: string,
  kind: PartKind,
): { ok: true; result: { operations: ReadOperation[] } } | { ok: false; errors: string[] } {
  const parsed = parseJsonReply(raw);
  const value = parsed?.value;
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray((value as Record<string, unknown>).operations)
  ) {
    return {
      ok: false,
      errors: ['reply must be a JSON object with an "operations" array'],
    };
  }
  const item = ENTITY[kind].reply.shape.operations.element;
  const operations = ((value as Record<string, unknown>).operations as unknown[]).map(
    (entry): ReadOperation => {
      const read = item.safeParse(entry);
      return read.success ? { ok: true, operation: read.data } : { ok: false };
    },
  );
  return { ok: true, result: { operations } };
}

// --- applying the operations ------------------------------------------------------

/** What the run may name — the context of the part's checks. */
export interface PatchScope {
  /** The run's chapter: a scene stays in it. */
  chapter: string;
  npcIds: ReadonlySet<string>;
  locationIds: ReadonlySet<string>;
  refIds: ReadonlySet<string>;
}

/** The finding an operation earns when its block cannot be changed. */
function anchorFinding(reason: BodyPatchFailure, anchor: string): PatchFinding {
  if (reason === "ambiguous") return { kind: "anchor_ambiguous", anchor };
  if (reason === "empty") return { kind: "text_empty", anchor };
  return { kind: "anchor_missing", anchor };
}

/** Why a new value of `field` cannot stand, or undefined when it can. */
function fieldFinding(
  kind: PartKind,
  field: string,
  value: unknown,
  scope: PatchScope,
): PatchFinding | undefined {
  const schema = ENTITY[kind].change.shape[field] as z.ZodType | undefined;
  if (schema === undefined || field === "id" || field === "body") {
    return { kind: "field_unknown", field };
  }
  if (value === "" || (value === null && !schema.safeParse(null).success)) {
    return { kind: "field_empty", field };
  }
  if (!schema.safeParse(value).success) return { kind: "field_invalid", field };
  if (kind !== "scene") return undefined;
  if (field === "chapter" && value !== scope.chapter) {
    return { kind: "chapter_outside", chapter: scope.chapter };
  }
  if (field === "location" && typeof value === "string" && !scope.locationIds.has(value)) {
    return { kind: "ids_unknown", field, ids: [value] };
  }
  if (field === "npcs" && Array.isArray(value)) {
    const unknown = value.filter((npc) => typeof npc !== "string" || !scope.npcIds.has(npc));
    if (unknown.length > 0) return { kind: "ids_unknown", field, ids: unknown.map(String) };
  }
  return undefined;
}

/** A value as the reply form holds it, with its text trimmed. */
function trimmed(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : item))
      .filter((item) => item !== "");
  }
  return value;
}

/**
 * Turn the operations of a reply into the round's changes, the model's notes
 * and the findings, against the proposal the model saw. Every operation is
 * judged on its own against that proposal; nothing here writes anything.
 */
export function applyPatchOperations(
  kind: PartKind,
  proposal: Proposal,
  operations: readonly ReadOperation[],
  scope: PatchScope,
): { changes: PartChange[]; notes: string[]; findings: PatchFinding[] } {
  const changes: PartChange[] = [];
  const notes: string[] = [];
  const findings: PatchFinding[] = [];
  const nextId = () => `c${changes.length + 1}`;
  const form: Readonly<Record<string, unknown>> = replyForm(kind, proposal);
  const current = proposal as Record<string, unknown>;
  for (const read of operations) {
    if (!read.ok) {
      findings.push({ kind: "unreadable" });
      continue;
    }
    const operation = read.operation;
    if (operation.op === "note") {
      const text = operation.text.trim();
      if (text !== "" && !notes.includes(text)) notes.push(text);
      continue;
    }
    if (operation.op === "set") {
      const { field } = operation;
      const raw = trimmed(operation.value);
      // A blank text is "not given" in the reply form, like in every reply.
      const clearable = (ENTITY[kind].change.shape[field] as z.ZodType | undefined)?.safeParse(
        null,
      ).success;
      const given = raw === "" && clearable === true ? null : raw;
      const value = fromReplyForm(kind, { ...form, [field]: given })[field] ?? null;
      const finding = fieldFinding(kind, field, value, scope);
      if (finding !== undefined) {
        findings.push(finding);
        continue;
      }
      if (sameValue(current[field], value)) continue;
      changes.push({ id: nextId(), op: "set", field, value });
      continue;
    }
    const outcome = bodyChange(proposal.body, operation, scope);
    if (outcome.ok) changes.push({ id: nextId(), ...outcome.change });
    else findings.push(...outcome.findings);
  }
  return { changes, notes, findings };
}

/** One block operation, checked against the body the model saw. */
function bodyChange(
  body: string,
  operation: BodyOperation,
  scope: PatchScope,
):
  | { ok: true; change: BodyOperation & { block: string } }
  | { ok: false; findings: PatchFinding[] } {
  const applied = applyBodyOperation(body, operation);
  if (!applied.ok) return { ok: false, findings: [anchorFinding(applied.reason, operation.anchor)] };
  if (operation.op !== "remove") {
    const { anchor, text } = operation;
    const callouts = unknownCallouts(text);
    const ids = bodyRefSlugs(text).filter((id) => !scope.refIds.has(id));
    const findings: PatchFinding[] = [
      ...(callouts.length === 0 ? [] : [{ kind: "callouts_unknown" as const, anchor, callouts }]),
      ...(ids.length === 0 ? [] : [{ kind: "refs_unknown" as const, anchor, ids: [...new Set(ids)] }]),
    ];
    if (findings.length > 0) return { ok: false, findings };
  }
  const found = findAnchor(body, operation.anchor);
  const block = found.ok ? found.markdown : operation.anchor;
  return { ok: true, change: { ...operation, block } };
}

// --- applying taken changes to a stored row ----------------------------------------

/**
 * The taken changes of an extension, applied to the row as it is stored now:
 * the fields they set and the body their block changes leave, in the order
 * the model gave them. A block change whose anchor does not name exactly one
 * block of the body as it stands changes nothing and becomes a finding. What
 * comes back names only the fields that change — empty when nothing does.
 */
export function applyTakenChanges(
  current: { body: string },
  changes: readonly PartChange[],
): { fields: Record<string, unknown>; findings: PatchFinding[] } {
  const fields: Record<string, unknown> = {};
  const findings: PatchFinding[] = [];
  let body = current.body;
  for (const change of changes) {
    if (change.op === "set") {
      fields[change.field] = change.value;
      continue;
    }
    const { id: _id, block: _block, ...operation } = change;
    const applied = applyBodyOperation(body, operation);
    if (applied.ok) body = applied.body;
    else findings.push(anchorFinding(applied.reason, operation.anchor));
  }
  if (body !== current.body) fields.body = body;
  return { fields, findings };
}
