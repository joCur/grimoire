// The suite's handle on one server's HTTP API, bound to one campaign.
//
// It knows requests, not entities: raw `fetch` for status-code assertions,
// `get`/`send` that parse JSON and throw on a non-2xx answer, and the request
// path of anything under the bound campaign. What the suite knows about an
// entity lives in that entity's own module — `campaign.ts`, `chapter.ts`,
// `scene.ts`, `npc.ts`, `location.ts`, `thread.ts`, `idea.ts`,
// `glossary-term.ts`, `knowledge-item.ts` and `session.ts` — as functions
// that take this handle first:
//
//   const npc = await getNpc(api, "fenn");
//   await patchScene(api, "lighthouse-arrival", { status: "played" });
//
// The database is the truth (ADR #13), and the API is how a spec looks at it
// — the same way the app does.

import { CAMPAIGN } from "./paths";

export interface Api {
  /** The campaign every path under `underCampaign` belongs to. */
  campaignId: string;
  /** Absolute URL of an API path (`/api/campaigns/beispiel/tree` or just `campaigns/…`). */
  url(apiPath: string): string;
  /** Raw fetch — for status-code assertions (409, 400, 404). */
  fetch(apiPath: string, init?: RequestInit): Promise<Response>;
  /** GET, parsed as JSON; throws with the body on a non-2xx answer. */
  get<T>(apiPath: string): Promise<T>;
  /** POST/PATCH/PUT/DELETE with a JSON body, parsed as JSON; throws on non-2xx. */
  send<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", apiPath: string, body?: unknown): Promise<T>;
}

/** The `api` handle for any server URL and campaign (the fixture is this, bound). */
export function apiFor(baseUrl: string, campaignId: string = CAMPAIGN): Api {
  const url = (apiPath: string) =>
    apiPath.startsWith("http")
      ? apiPath
      : `${baseUrl}/api/${apiPath.replace(/^\/?api\//, "").replace(/^\//, "")}`;

  const fetchApi = (apiPath: string, init?: RequestInit) => fetch(url(apiPath), init);

  async function json<T>(response: Response, what: string): Promise<T> {
    const text = await response.text();
    if (!response.ok) throw new Error(`${what}: HTTP ${response.status} — ${text}`);
    return JSON.parse(text) as T;
  }

  return {
    campaignId,
    url,
    fetch: fetchApi,
    async get<T>(apiPath: string) {
      return json<T>(await fetchApi(apiPath), `GET ${apiPath}`);
    },
    async send<T>(method: "POST" | "PATCH" | "PUT" | "DELETE", apiPath: string, body?: unknown) {
      const response = await fetchApi(apiPath, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return json<T>(response, `${method} ${apiPath}`);
    },
  };
}

/**
 * The request path of the bound campaign, or of something under it:
 * `underCampaign(api, "npcs", "fenn")` is `campaigns/beispiel/npcs/fenn`.
 * Every segment is URL-encoded.
 */
export function underCampaign(api: Api, ...segments: string[]): string {
  return ["campaigns", api.campaignId, ...segments].map(encodeURIComponent).join("/");
}

/**
 * Whether GET on `apiPath` finds something: `false` on a 404, `true` on a
 * 2xx, and an error on any other answer.
 */
export async function exists(api: Api, apiPath: string): Promise<boolean> {
  const response = await api.fetch(apiPath);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`GET ${apiPath}: HTTP ${response.status}`);
  return true;
}
