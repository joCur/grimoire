// The entries: one read and one write for every entry with an address.
//
// WHAT `path` MEANS: an ADDRESS, not a path on disk — no `.md`, no extension at
// all. The complete schema is in ../store/paths.ts:
//
//   campaign · <chapter>
//
// The wire vocabulary follows from that: an entry's fields are `properties`,
// its markdown is `body`, and its optimistic-concurrency token is `rev` (the
// row version).

import { Hono } from "hono";
import type { Context } from "hono";
import { ApiError } from "../api-error";
import { patchEntry, readEntry } from "../store/entries";
import { addressSegments } from "../store/paths";
import { isPlainObject, jsonBody, requireRev } from "./http";

export const entryRoutes = new Hono();

/**
 * The entry address of an `/entries/*` route: everything behind `entries/`,
 * one decoded segment per address segment (an address may carry umlauts).
 * The store layer validates the result (`assertSafeAddress`), so an escape
 * attempt reaches it as an address and is answered with a 400.
 */
function entryAddress(c: Context): string {
  const marker = "/entries/";
  const pathname = new URL(c.req.url).pathname;
  const at = pathname.indexOf(marker);
  const rest = at === -1 ? "" : pathname.slice(at + marker.length);
  if (rest === "") throw new ApiError(400, "missing entry address");
  return addressSegments(rest)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

// GET /api/campaigns/:campaign/entries/<address> -> EntryResponse
// (properties, body, rev). The address IS the path — the schema is in
// store/paths.ts, and it describes the campaign and its chapters. A scene, an
// npc and a location have no address, so reaching for one here is a 404: see
// the scene, npc and location routes.
entryRoutes.get("/campaigns/:campaign/entries/*", async (c) =>
  c.json(await readEntry(c.req.param("campaign"), entryAddress(c))),
);

// PATCH /api/campaigns/:campaign/entries/<address> { rev, properties?, body?, force? }
//   -> EntryResponse
// THE write of one entry (ADR #23): its fields, its text, or both in ONE
// request against ONE `rev`. The address is the path behind `entries/`, the
// same one GET reads.
//
// Fields and text together are ONE write: the row changes once, so `rev`
// steps once no matter how much the request carried.
//
// `properties` is a flat object of keys to set; null deletes a key. `body` is
// the markdown WITHOUT the properties block — exactly what GET hands out as
// `body` — and replaces the stored text. Neither of the two present is a 400
// { code: "nothing_to_write" }: a request that changes nothing is a bug in
// the caller, not a save.
//
// A key the entry's kind has no field for is a 400.
//
// A stale `rev` is 409 { code: "rev_conflict", rev, entry } and writes
// nothing — `entry` is the entry as it stands now, so the conflict dialog
// shows what is in the way without a second request. `force: true` writes the
// given fields on top of that current row instead: only what this request
// carries is written, so a status changed in between survives a forced text
// save.
//
// 404 for an entry that does not exist — including for an address that reaches
// for one of the three LISTS, which have none (ADR #26), and for one that
// reaches for a scene, an npc or a location, each written through its own
// resource. The lists are written through their own endpoints: PUT /glossary,
// POST /inbox, POST /log, the session verbs, PATCH /sessions/:id and the
// review actions.
entryRoutes.patch("/campaigns/:campaign/entries/*", async (c) => {
  const body = await jsonBody(c, ["rev", "properties", "body", "force"]);
  const properties = body.properties;
  const markdown = body.body;
  if (properties !== undefined && !isPlainObject(properties)) {
    throw new ApiError(400, "properties must be an object");
  }
  if (markdown !== undefined && typeof markdown !== "string") {
    throw new ApiError(400, "body must be a string");
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    throw new ApiError(400, "force must be a boolean");
  }
  return c.json(
    await patchEntry(c.req.param("campaign"), entryAddress(c), {
      rev: requireRev(body.rev),
      ...(properties === undefined ? {} : { properties }),
      ...(markdown === undefined ? {} : { body: markdown }),
      ...(body.force === undefined ? {} : { force: body.force }),
    }),
  );
});
