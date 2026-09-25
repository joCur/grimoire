// The Ideen-Einwurf, against the database stack.
//
// `POST /inbox` appends one idea as a row and answers the whole list with the
// list's own guard token. The inbox has no address and no text (ADR #26), so
// the answer is an `InboxResponse` and nothing else.
//
// Every case runs against its OWN in-memory database, seeded from the
// committed JSON fixtures by the real loader (test/support/store.ts), so the
// cases cannot build on each other. The system time is faked per case
// (setSystemTime) for deterministic dates.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { InboxResponse } from "@grimoire/shared";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { seedCampaign } from "../src/db/seed";
import { dropStore, seedStore } from "./support/store";

async function postJson(url: string, body?: unknown): Promise<Response> {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

/** A POST that answers the INBOX list. */
async function postInbox(url: string, body?: unknown): Promise<InboxResponse> {
  const res = await postJson(url, body);
  expect(res.status).toBe(200);
  return (await res.json()) as InboxResponse;
}

async function getInbox(campaign = "beispiel"): Promise<InboxResponse> {
  const res = await app.request(`/api/campaigns/${campaign}/inbox`);
  expect(res.status).toBe(200);
  return (await res.json()) as InboxResponse;
}

/**
 * A SECOND campaign next to `beispiel`, holding nothing but its own row: no
 * name, no sessions, no inbox. That is what the "there is nothing yet" cases
 * need, and a campaign row on its own is exactly it.
 */
const FRESH = "frischling";

async function withFreshCampaign(fn: () => Promise<void>): Promise<void> {
  seedCampaign(await getDb(), { campaign: { id: FRESH, name: "", body: "" } });
  await fn();
}

beforeEach(async () => {
  // 2026-08-19 21:05 local time unless a test overrides it.
  setSystemTime(new Date(2026, 7, 19, 21, 5));
  await seedStore();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("POST /api/campaigns/:campaign/inbox", () => {
  test("appends one idea as a row and answers the whole list", async () => {
    const before = await getInbox();
    const after = await postInbox("/api/campaigns/beispiel/inbox", {
      text: "Schmied beobachten #thread",
    });
    // Append-only: the existing rows are a PREFIX of the new list, and the
    // new idea is the last row.
    expect(after.entries.slice(0, before.entries.length)).toEqual(before.entries);
    expect(after.entries.at(-1)).toEqual({
      id: expect.any(String),
      text: "Schmied beobachten #thread",
      done: false,
    });
    // The list's own guard token moved, and a subsequent GET agrees.
    expect(after.rev).toBeGreaterThan(before.rev);
    expect(await getInbox()).toEqual(after);
  });

  test("the first idea of an empty inbox is one row, with no heading in front", async () => {
    // A campaign with no inbox rows at all: the inbox is an EMPTY list, not a
    // missing one — GET answers 200 — and the first idea is one row. No
    // heading row is written in front of it: a table has no skeleton.
    await withFreshCampaign(async () => {
      expect((await getInbox(FRESH)).entries).toEqual([]);
      const list = await postInbox(`/api/campaigns/${FRESH}/inbox`, { text: "Erste Idee" });
      expect(list.entries).toEqual([{ id: "0", text: "Erste Idee", done: false }]);
    });
  });

  test("400 on empty text", async () => {
    expect((await postJson("/api/campaigns/beispiel/inbox", { text: "  " })).status).toBe(400);
    expect((await postJson("/api/campaigns/beispiel/inbox", {})).status).toBe(400);
  });

  test("404 for an unknown campaign", async () => {
    expect((await postJson("/api/campaigns/nope/inbox", { text: "x" })).status).toBe(404);
    expect((await postJson("/api/campaigns/nope/session/start")).status).toBe(404);
  });
});
