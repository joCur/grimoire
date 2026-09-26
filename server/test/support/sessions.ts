// The sessions of a case, through their own resources (decisions/resources): the
// session under `…/sessions/:id` and its children under it. The session
// cases and those of its pauses and log entries share these.

import { expect } from "bun:test";
import type { Session, SessionSeed } from "@grimoire/shared/session";
import { app } from "../../src/server";

/** The session list of the example campaign; a session's URL is below it. */
export const SESSIONS = "/api/campaigns/beispiel/sessions";

/** The committed fixture's session — ended, with a pause and a log. */
export const FIXTURE_SESSION = "2026-01-15";

/** One request with a JSON body (an empty object when none is given). */
export async function send(method: string, url: string, body: unknown = {}): Promise<Response> {
  return app.request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The session with this id, which has to exist. */
export async function readSession(id: string): Promise<Session> {
  const res = await app.request(`${SESSIONS}/${id}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Session;
}

/** Start a session on the current system clock; it has to be a new one. */
export async function startSession(): Promise<Session> {
  const res = await send("POST", SESSIONS);
  expect(res.status).toBe(201);
  return (await res.json()) as Session;
}

/** End a session at the current system clock, against its current `rev`. */
export async function endSession(id: string): Promise<Session> {
  const { rev } = await readSession(id);
  const res = await send("PATCH", `${SESSIONS}/${id}`, { rev, endedMs: Date.now() });
  expect(res.status).toBe(200);
  return (await res.json()) as Session;
}

/** The running session of the example campaign, when one runs. */
export async function runningSession(): Promise<Session | undefined> {
  const res = await app.request(`${SESSIONS}?running=true`);
  expect(res.status).toBe(200);
  const list = (await res.json()) as Session[];
  expect(list.length).toBeLessThanOrEqual(1);
  return list[0];
}

/** A session fixture with no children — what a case seeds beside the example's own. */
export function sessionSeed(fields: Partial<SessionSeed> & { id: string }): SessionSeed {
  return { started: "", body: "", pauses: [], log: [], ...fields };
}
