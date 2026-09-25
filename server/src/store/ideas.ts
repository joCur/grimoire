// Ideas: the idea resource.
//
// An idea is its own resource with its own type (ADR #31,
// @grimoire/shared/idea): listed, read, created and written here, typed by
// its one zod schema. An idea is written once; the one change after that is
// ticking it off (`done`), and every idea carries its own guard `rev`. Ideas
// stand in the order they were created (`pos`, db/schema.ts).

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  ideaCreateSchema,
  ideaPatchSchema,
  ideaSeedSchema,
  type Idea,
  type IdeaCreate,
  type IdeaPatch,
  type IdeaSeed,
} from "@grimoire/shared/idea";
import { ApiError } from "../api-error";
import type { GrimoireDb } from "../db/client";
import { ideas } from "../db/schema";
import { mutate, requireCampaign } from "./campaigns";
import { getDb } from "./handle";
import { nextPos, parseRequest, revConflict } from "./shared";

/** One stored idea row. */
type IdeaRow = typeof ideas.$inferSelect;

// --- rendering and reading ----------------------------------------------------

/** The idea of a row: every field flat, `done` a boolean. */
function renderIdea(row: IdeaRow): Idea {
  return { id: row.id, text: row.text, done: row.done !== 0, rev: row.rev };
}

/** The idea with this id; 404 when the campaign has none. */
function requireIdeaRow(tx: GrimoireDb, campaign: string, id: string): IdeaRow {
  const row = tx
    .select()
    .from(ideas)
    .where(and(eq(ideas.campaignId, campaign), eq(ideas.id, id)))
    .all()[0];
  if (row === undefined) throw new ApiError(404, "idea not found");
  return row;
}

/**
 * GET /api/campaigns/:campaign/ideas — every idea of the campaign in the
 * order it was created (`pos`, the id as the tie-break). No ideas is an empty
 * list (200).
 */
export async function listIdeas(campaign: string): Promise<Idea[]> {
  await requireCampaign(campaign);
  const db = await getDb();
  return db
    .select()
    .from(ideas)
    .where(eq(ideas.campaignId, campaign))
    .orderBy(asc(ideas.pos), asc(ideas.id))
    .all()
    .map(renderIdea);
}

/** GET /api/campaigns/:campaign/ideas/:id */
export async function readIdea(campaign: string, id: string): Promise<Idea> {
  await requireCampaign(campaign);
  return renderIdea(requireIdeaRow(await getDb(), campaign, id));
}

// --- writing ------------------------------------------------------------------

/** The one past the highest `pos` of the campaign — where a new idea stands. */
function nextIdeaPos(tx: GrimoireDb, campaign: string): number {
  return nextPos(
    tx.select({ pos: ideas.pos }).from(ideas).where(eq(ideas.campaignId, campaign)).all(),
  );
}

/** The body of an idea POST, checked against the idea's create form. */
export function readIdeaCreate(raw: unknown): IdeaCreate {
  return parseRequest(ideaCreateSchema, raw, "idea");
}

/**
 * POST /api/campaigns/:campaign/ideas `{ text }` — a new open idea at the
 * end, with an id the server hands out. `text` arrives as one trimmed line.
 */
export async function createIdea(campaign: string, request: IdeaCreate): Promise<Idea> {
  return mutate(campaign, (tx) => {
    const id = randomUUID();
    tx.insert(ideas)
      .values({ campaignId: campaign, id, text: request.text, done: 0, pos: nextIdeaPos(tx, campaign) })
      .run();
    return renderIdea(requireIdeaRow(tx, campaign, id));
  });
}

/**
 * The body of an idea PATCH, checked against the idea's schema: the guard,
 * `force` and `done` — any other key, `text` among them, is a 400 that names
 * it, because an idea's text is written once.
 */
export function readIdeaPatch(raw: unknown): IdeaPatch {
  return parseRequest(ideaPatchSchema, raw, "idea patch");
}

/**
 * PATCH /api/campaigns/:campaign/ideas/:id `{ rev, force?, done? }` — tick
 * an idea off, or back on, against its `rev`. A patch without `done` is 400
 * `nothing_to_write`. The id may be echoed, never changed.
 *
 * A stale `rev` is 409 with the current idea under `idea`; `force` writes on
 * top of it instead. An unknown id is 404.
 */
export async function patchIdea(campaign: string, id: string, patch: IdeaPatch): Promise<Idea> {
  const { rev, force, id: patchedId, done } = patch;
  if (done === undefined && patchedId === undefined) {
    throw new ApiError(400, "nothing to write — send done", { code: "nothing_to_write" });
  }
  return mutate(campaign, (tx) => {
    const row = requireIdeaRow(tx, campaign, id);
    const guard = force === true ? row.rev : rev;
    if (row.rev !== guard) {
      throw revConflict(row.rev, "idea changed", { idea: renderIdea(row) });
    }
    if (patchedId !== undefined && patchedId !== row.id) {
      throw new ApiError(400, "id is the primary key — it is set at creation and never changes");
    }
    const next: IdeaRow = {
      ...row,
      done: done === undefined ? row.done : done ? 1 : 0,
      rev: row.rev + 1,
    };
    tx.update(ideas)
      .set({ done: next.done, rev: next.rev })
      .where(and(eq(ideas.campaignId, campaign), eq(ideas.id, row.id)))
      .run();
    return renderIdea(next);
  });
}

// --- the seed -----------------------------------------------------------------

/**
 * An idea without its guard — a fixture — checked against the idea's schema.
 * A key an idea does not have, or a value of the wrong shape, is refused with
 * the message `what` introduces.
 */
export function readIdeaSeed(raw: unknown, what: string): IdeaSeed {
  return parseRequest(ideaSeedSchema, raw, what);
}

/** Write one idea of a fixture, at the end, INSIDE the caller's transaction. */
export function insertIdeaSeed(tx: GrimoireDb, campaign: string, seed: IdeaSeed): void {
  tx.insert(ideas)
    .values({
      campaignId: campaign,
      id: seed.id,
      text: seed.text,
      done: seed.done ? 1 : 0,
      pos: nextIdeaPos(tx, campaign),
    })
    .run();
}
