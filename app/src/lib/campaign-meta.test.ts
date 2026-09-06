import { afterEach, describe, expect, test } from "bun:test";
import type { FileResponse } from "@grimoire/shared/types";

import { ApiError } from "@/api";
import {
  campaignMetaPatch,
  canSubmitCampaignMeta,
  prefillCampaignName,
  seedCampaignMetaBase,
  writeCampaignMeta,
} from "./campaign-meta";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Answer every request with the given status/body and record the calls. */
function answerWith(status: number, body: unknown, calls: Call[] = []): Call[] {
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

/** Answer the first request with `first`, every later one with `then`. */
function answerOnce(
  first: { status: number; body: unknown },
  then: { status: number; body: unknown },
): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const answer = calls.length === 0 ? first : then;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return calls;
}

const FILE: FileResponse = {
  path: "_campaign.md",
  kind: "campaign",
  properties: { id: "beispiel", name: "Neuer Name" },
  body: "",
  rev: 42,
  raw: "---\nid: beispiel\nname: Neuer Name\n---\n",
};

describe("campaignMetaPatch", () => {
  test("trims both values", () => {
    expect(campaignMetaPatch({ name: "  Salzhafen  ", description: " Küste " })).toEqual({
      name: "Salzhafen",
      description: "Küste",
    });
  });

  test("a blank description DELETES the key instead of writing an empty line", () => {
    expect(campaignMetaPatch({ name: "Salzhafen", description: "   " })).toEqual({
      name: "Salzhafen",
      description: null,
    });
  });
});

describe("canSubmitCampaignMeta", () => {
  test("the name carries the campaign — blank is not a save", () => {
    expect(canSubmitCampaignMeta({ name: "", description: "x" })).toBe(false);
    expect(canSubmitCampaignMeta({ name: "   ", description: "x" })).toBe(false);
    expect(canSubmitCampaignMeta({ name: "Salzhafen", description: "" })).toBe(true);
  });
});

describe("seedCampaignMetaBase", () => {
  test("no answer yet means nothing to write against", () => {
    expect(seedCampaignMetaBase(undefined, undefined)).toBe(undefined);
  });

  test("the first answer freezes the version the dialog writes against", () => {
    expect(seedCampaignMetaBase(undefined, { rev: 42 })).toEqual({ rev: 42 });
  });

  test("a later poll does NOT advance the base (that would overwrite the foreign edit)", () => {
    const frozen = { rev: 42 };
    // The 5s version poll refetches _campaign.md while the dialog stands; a
    // concurrent edit must answer 409 on save, so the base stays where it was.
    expect(seedCampaignMetaBase(frozen, { rev: 99 })).toBe(frozen);
  });
});

describe("prefillCampaignName", () => {
  test("a name that IS the id is the server's fallback, not an authored value", () => {
    // The dialog must not propose the id as a name (issue #62: both endpoints
    // synthesize it now) — the field starts empty, the id is the placeholder.
    expect(prefillCampaignName("beispiel", "beispiel")).toBe("");
    expect(prefillCampaignName("beispiel", undefined)).toBe("");
    expect(prefillCampaignName("beispiel", "Salzhafen")).toBe("Salzhafen");
  });
});

describe("writeCampaignMeta", () => {
  test("it PATCHes the properties with the guard token the dialog holds", async () => {
    const calls = answerWith(200, FILE);
    const result = await writeCampaignMeta(
      "beispiel",
      { name: "Neuer Name", description: "Neue Zeile" },
      42,
    );
    expect(result).toEqual({ ok: true, file: FILE });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toBe("/api/beispiel/properties");
    expect(calls[0]?.body).toEqual({
      path: "_campaign.md",
      rev: 42,
      patch: { name: "Neuer Name", description: "Neue Zeile" },
    });
  });

  test("409 means nothing was written; the file is re-read for the next attempt", async () => {
    const calls = answerOnce(
      { status: 409, body: { error: "file changed on disk", rev: 99 } },
      { status: 200, body: { ...FILE, rev: 99 } },
    );
    const result = await writeCampaignMeta("beispiel", { name: "X", description: "" }, 42);
    expect(result.ok).toBe(false);
    expect(result.file?.rev).toBe(99);
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.url).toBe("/api/beispiel/file?path=_campaign.md");
  });

  test("a failed reload after the conflict keeps the conflict, not a crash", async () => {
    answerWith(409, { error: "file changed on disk" });
    expect(await writeCampaignMeta("beispiel", { name: "X", description: "" }, 42)).toEqual({
      ok: false,
    });
  });

  test("every other failure throws (the dialog shows the error line)", async () => {
    answerWith(500, { error: "boom" });
    const failure = writeCampaignMeta("beispiel", { name: "X", description: "" }, 42);
    await expect(failure).rejects.toBeInstanceOf(ApiError);
  });
});
