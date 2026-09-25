// The sessions in the suite: `…/session` (the active one), `…/sessions` and
// `…/sessions/:id`. A session is a table, not an entity with a text (ADR
// #26): its log, its pauses and its played scenes come back as rows and lists.

import type { SessionResponse, SessionSummary } from "@grimoire/shared/types";
import { exists, underCampaign, type Api } from "./api";

/** The request path of one session, or, without an id, of the session list. */
export function sessionPath(api: Api, id?: string): string {
  return id === undefined ? underCampaign(api, "sessions") : underCampaign(api, "sessions", id);
}

/**
 * The ACTIVE session — or, with `includeEnded`, the last started one.
 * `undefined` when the campaign has no such session: the endpoint answers
 * 200 with a `null` body, because "nothing runs" is an ordinary state.
 *
 * A session id the app starts is an opaque random string, so no spec can
 * spell one out: "the session the app just started" is a question only the
 * server can answer, and this asks it.
 */
export async function getActiveSession(
  api: Api,
  includeEnded = false,
): Promise<SessionResponse | undefined> {
  const path = `${underCampaign(api, "session")}${includeEnded ? "?includeEnded=1" : ""}`;
  // "Nothing runs" is a null body, not a status — so it is read as a value
  // here, exactly as the app reads it.
  return (await api.get<SessionResponse | null>(path)) ?? undefined;
}

/** Id of the active session (see `getActiveSession`), or undefined. */
export async function activeSessionId(
  api: Api,
  includeEnded = false,
): Promise<string | undefined> {
  return (await getActiveSession(api, includeEnded))?.id;
}

/** ONE session by its id; throws when the id names none (404). */
export function getSession(api: Api, id: string): Promise<SessionResponse> {
  return api.get<SessionResponse>(sessionPath(api, id));
}

/** Whether a session with that id exists (404 = no). */
export function sessionExists(api: Api, id: string): Promise<boolean> {
  return exists(api, sessionPath(api, id));
}

/** Every session of the campaign, newest first. */
export function listSessions(api: Api): Promise<SessionSummary[]> {
  return api.get<SessionSummary[]>(sessionPath(api));
}

/**
 * The date-shaped id of a session a spec SEEDS itself.
 *
 * NOT the id of a session the app starts: those are opaque random strings and
 * only the server knows them (`activeSessionId`). A date-shaped id stays
 * perfectly legal, which is why a seeded session may spell one.
 */
export function todaySessionId(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
