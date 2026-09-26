// A PAUSE — an interval of a session in which its clock stands — its one zod
// schema and the forms derived from it (decisions/resources).
//
// `pauseSchema` is the pause as the session embeds it and as
// `POST`/`PATCH /api/campaigns/:c/sessions/:s/pauses[/:id]` answer it. The
// TypeScript type, the PATCH the resource accepts and the pause a fixture
// holds are each derived from it below with zod's own API.
//
// A pause hangs UNDER its session: it never exists without it and never
// moves to another one.
//
// Its two ends are zone-less wall-clock strings, read in the SERVER's
// timezone; `fromMs`/`toMs` are the server's epoch reading of them. Only the
// server knows which wall clock those digits belong to, so a client never
// builds such a string: it reads the epoch values, and it writes an end as an
// epoch value too.

import { z } from "zod";

/**
 * A pause, exactly as the resource answers it: `id` its stable key — an
 * opaque id the server hands out —, `from` when it began and `to` when it
 * ended (`yyyy-mm-ddTHH:MM:SS`, local to the server), each beside its epoch
 * reading `fromMs`/`toMs`, and `rev` the row version a PATCH sends back as
 * its guard. A pause without `to` is the running one: the clock stands. An
 * epoch reading is absent when the server cannot read its string.
 */
export const pauseSchema = z.strictObject({
  id: z.string(),
  from: z.string(),
  fromMs: z.number().optional(),
  to: z.string().optional(),
  toMs: z.number().optional(),
  rev: z.number(),
});

export type Pause = z.infer<typeof pauseSchema>;

/**
 * A pause as a session fixture embeds it (`fixtures/<campaign>/sessions/<id>.json`):
 * without its guard and without the epoch readings, which are the server's
 * reading of the strings in its own timezone and not something a fixture
 * could state.
 */
export const pauseSeedSchema = pauseSchema.omit({ rev: true, fromMs: true, toMs: true });

export type PauseSeed = z.infer<typeof pauseSeedSchema>;

/**
 * The body of `POST /api/campaigns/:c/sessions/:s/pauses`: nothing. A new
 * pause begins now, on the server's clock.
 */
export const pauseCreateSchema = pauseSchema.pick({});

export type PauseCreate = z.infer<typeof pauseCreateSchema>;

/**
 * The body of `PATCH /api/campaigns/:c/sessions/:s/pauses/:id`: the guard,
 * the optional `force`, and its ends as epoch values — `toMs` ends the pause,
 * and either end may be corrected by hand. The server stores the reading of
 * that moment in its own timezone. The id may be echoed, never changed.
 * Strict like the schema it comes from: a key that is none of these — the
 * strings `from` and `to` among them — is a 400 naming it.
 */
export const pausePatchSchema = pauseSchema
  .pick({ id: true, fromMs: true, toMs: true })
  .partial()
  .extend({ rev: z.number(), force: z.boolean().optional() });

export type PausePatch = z.infer<typeof pausePatchSchema>;
