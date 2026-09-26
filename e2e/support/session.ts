// A session in the suite: its resource `…/sessions/:id` (ADR #31), every
// field flat, its pauses and log entries embedded — each child with its own
// id and rev. Its type is the one `@grimoire/shared/session`
// derives from the session's schema.

import type { Session } from "@grimoire/shared/session";
import { exists, underCampaign, type Api } from "./api";

/** The request path of one session, or, without an id, of the session list. */
export function sessionPath(api: Api, id?: string): string {
  return id === undefined ? underCampaign(api, "sessions") : underCampaign(api, "sessions", id);
}

/** The request path of a session's log, or of one of its entries. */
export function logEntryPath(api: Api, sessionId: string, id?: string): string {
  const base = `${sessionPath(api, sessionId)}/log`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** The request path of a session's pauses, or of one of them. */
export function pausePath(api: Api, sessionId: string, id?: string): string {
  const base = `${sessionPath(api, sessionId)}/pauses`;
  return id === undefined ? base : `${base}/${encodeURIComponent(id)}`;
}

/** Every session of the campaign, newest first, each with its children. */
export function listSessions(api: Api): Promise<Session[]> {
  return api.get<Session[]>(sessionPath(api));
}

/**
 * The RUNNING session (`?running=true`), or undefined when none runs — which
 * is an ordinary state, not an error.
 *
 * A session id the app starts is an opaque random string, so no spec can
 * spell one out: "the session the app just started" is a question only the
 * server can answer, and this asks it.
 */
export async function getRunningSession(api: Api): Promise<Session | undefined> {
  const [running] = await api.get<Session[]>(`${sessionPath(api)}?running=true`);
  return running;
}

/** Id of the running session (see `getRunningSession`), or undefined. */
export async function runningSessionId(api: Api): Promise<string | undefined> {
  return (await getRunningSession(api))?.id;
}

/**
 * The last STARTED session, ended or not — the first of the list, and the
 * one the review harvests. Undefined when the campaign has no session.
 */
export async function getLastStartedSession(api: Api): Promise<Session | undefined> {
  const [last] = await listSessions(api);
  return last;
}

/** ONE session by its id; throws when the id names none (404). */
export function getSession(api: Api, id: string): Promise<Session> {
  return api.get<Session>(sessionPath(api, id));
}

/** Whether a session with that id exists (404 = no). */
export function sessionExists(api: Api, id: string): Promise<boolean> {
  return exists(api, sessionPath(api, id));
}

/**
 * The date-shaped id of a session a spec SEEDS itself.
 *
 * NOT the id of a session the app starts: those are opaque random strings and
 * only the server knows them (`runningSessionId`). A date-shaped id stays
 * perfectly legal, which is why a seeded session may spell one.
 */
export function todaySessionId(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
