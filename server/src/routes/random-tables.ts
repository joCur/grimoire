// The random tables and their sources: import, list, read and remove.
//
// A RANDOM TABLE AND ITS SOURCE ARE EACH THEIR OWN RESOURCE
// (decisions/resources): `/random-table-sources[/:id]` answering
// `RandomTableSource` — `{ id, title, authors, url, rev }` — and
// `/random-tables[/:id]` answering `RandomTable` — `{ id, source, name,
// caption, intro, die, columns, rows, rev }`. Both are reference data of the
// instance (decisions/reference-data): they hang under no campaign, and the
// DM's import of a 5etools file is their only writer. None ships with the app.

import { Hono } from "hono";
import { randomTableSourceDeleteSchema } from "@grimoire/shared/random-table";
import { ApiError } from "../api-error";
import {
  deleteRandomTableSource,
  importRandomTableSources,
  listRandomTableSources,
  readRandomTableSource,
} from "../store/random-table-sources";
import { listRandomTables, readRandomTable } from "../store/random-tables";
import { parseRequest } from "../store/shared";
import { jsonBody } from "./http";

export const randomTableRoutes = new Hono();

// GET /api/random-table-sources -> RandomTableSource[]
// Every imported source, sorted by title. None imported answers an empty list.
randomTableRoutes.get("/random-table-sources", async (c) => c.json(await listRandomTableSources()));

// GET /api/random-table-sources/:id -> RandomTableSource
// One source. 404 for a source that is not imported.
randomTableRoutes.get("/random-table-sources/:id", async (c) =>
  c.json(await readRandomTableSource(c.req.param("id"))),
);

// POST /api/random-table-sources <5etools file> -> 201 RandomTableSource[]
// Imports a 5etools homebrew file, sent as it is: every source of its
// `_meta.sources` that has tables in its `table` list, with those tables,
// in one transaction. A source that is already imported is replaced — its
// tables are the file's afterwards — and its `rev` moves. The answer is the
// sources written, in the file's order. The server never fetches the file
// itself.
//
// 400 { code: "import_not_fivetools" } for a body that is no 5etools file,
// 400 { code: "import_no_tables" } for one without any table; neither writes.
randomTableRoutes.post("/random-table-sources", async (c) =>
  c.json(await importRandomTableSources(await jsonBody(c, null)), 201),
);

// DELETE /api/random-table-sources/:id { rev } -> 204
// Removes the source with its tables for good; there is no trash, because
// importing the file again brings them back. A stale `rev` is 409 { code:
// "rev_conflict", rev, randomTableSource } and removes nothing. 404 for a
// source that is not imported.
randomTableRoutes.delete("/random-table-sources/:id", async (c) => {
  const request = parseRequest(
    randomTableSourceDeleteSchema,
    await jsonBody(c, null),
    "random table source delete",
  );
  await deleteRandomTableSource(c.req.param("id"), request);
  return c.body(null, 204);
});

// GET /api/random-tables[?source=<id>] -> RandomTable[]
// Every imported table with its rows, or with `?source=` the tables of one
// source, in the order of their source file. An empty `source` is a 400.
randomTableRoutes.get("/random-tables", async (c) => {
  const source = c.req.query("source");
  if (source === "") throw new ApiError(400, "source must name a source");
  return c.json(await listRandomTables(source));
});

// GET /api/random-tables/:id -> RandomTable
// One table with its rows. 404 for an id no imported source has.
randomTableRoutes.get("/random-tables/:id", async (c) =>
  c.json(await readRandomTable(c.req.param("id"))),
);
