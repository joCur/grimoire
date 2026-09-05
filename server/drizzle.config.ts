// drizzle-kit configuration — used ONLY to generate migration SQL, never at
// runtime (the server applies the committed files through src/db/client.ts).
//
//   bun run --cwd server db:generate           # diff schema.ts -> new SQL file
//   bun run --cwd server db:generate:custom    # empty file for hand-written SQL
//
// The generated files are committed (planning #52 section 5): the image
// applies them, it never generates them, and a schema change is therefore
// reviewable as SQL in the PR.
//
// `dbCredentials` is required by the config type but irrelevant for
// `generate` — drizzle-kit only reads the schema and the existing snapshots.
// It points at the dev default of GRIMOIRE_DATA so that `drizzle-kit studio`
// happens to work as well.

import type { Config } from "drizzle-kit";

export default {
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: "../data/grimoire.db" },
  strict: true,
  verbose: true,
} satisfies Config;
