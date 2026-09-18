// The conflict guard: a stale `rev` must be rejected, never silently applied.
//
// The optimistic-concurrency token is the ROW's `rev` (store/render.ts
// rule 3): an integer that starts at 1 and is incremented by every write
// inside the write's own transaction. It has nothing to do with wall-clock
// time, so two writes that land in the SAME clock second cannot collide:
//
//     A reads the scene  -> rev = T
//     B reads the scene  -> rev = T
//     A writes with T    -> ok, the row's rev is now T + 1
//     B writes with T    -> 409, carrying the CURRENT rev and entry
//
// That is what this file pins. A write against a spent `rev` is a 409 that
// carries the rev the app needs to reload and retry, and the loser's change
// never lands — for fields, for text, and across the two, because
// properties and body are one row and therefore one guard (ADR #23).
//
// The system time is deliberately FROZEN: the guard is independent of
// wall-clock time, and a test that is not about timing is the point.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { EntryResponse, PatchEntryRequest } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const SCENE = "01-salzhafen/leuchtturm/lighthouse-arrival";

async function getEntry(rel: string): Promise<EntryResponse> {
  const res = await app.request(entriesUrl("beispiel", rel));
  expect(res.status).toBe(200);
  return (await res.json()) as EntryResponse;
}

/** The one write of the reference scene. */
async function patchReq(request: PatchEntryRequest): Promise<Response> {
  return app.request(entriesUrl("beispiel", SCENE), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
}

interface Conflict {
  error: string;
  code: string;
  rev: number;
  entry: EntryResponse;
}

beforeEach(async () => {
  // FROZEN — every request in this file happens in the same clock second, the
  // situation the guard must still tell apart.
  setSystemTime(new Date(2026, 7, 19, 21, 5, 30));
  await seedStore();
});

afterEach(() => {
  setSystemTime();
  dropStore();
});

describe("two writes with the same guard token, same clock second", () => {
  test("properties: first wins, second is 409, the loser did not land", async () => {
    const read = await getEntry(SCENE);

    // Both "tabs" hold the SAME token — the one read above.
    const first = await patchReq({ rev: read.rev, properties: { status: "played" } });
    expect(first.status).toBe(200);
    const won = (await first.json()) as EntryResponse;
    expect(won.properties.status).toBe("played");
    expect(won.rev).toBe(read.rev + 1);

    const second = await patchReq({ rev: read.rev, properties: { status: "draft" } });
    expect(second.status).toBe(409);
    const conflict = (await second.json()) as Conflict;
    expect(typeof conflict.error).toBe("string");
    expect(conflict.code).toBe("rev_conflict");
    // The 409 carries the CURRENT rev, so the app can reload and retry — and
    // the current ENTRY, so it can show what is in the way right away.
    expect(conflict.rev).toBe(won.rev);
    expect(conflict.entry).toEqual(won);

    // The whole point: the second write did NOT land.
    const after = await getEntry(SCENE);
    expect(after.properties.status).toBe("played");
    expect(after.rev).toBe(won.rev);

    // …and retrying with the token from the 409 succeeds, in the same second.
    const retry = await patchReq({ rev: conflict.rev, properties: { status: "draft" } });
    expect(retry.status).toBe(200);
    const retried = (await retry.json()) as EntryResponse;
    expect(retried.properties.status).toBe("draft");
    expect(retried.rev).toBe(conflict.rev + 1);
  });

  test("body: first wins, second is 409, the loser's body did not land", async () => {
    const read = await getEntry(SCENE);

    const first = await patchReq({ rev: read.rev, body: "\n## Flow\n\nVersion A.\n" });
    expect(first.status).toBe(200);
    const won = (await first.json()) as EntryResponse;
    expect(won.body).toBe("\n## Flow\n\nVersion A.\n");
    expect(won.rev).toBe(read.rev + 1);

    const second = await patchReq({ rev: read.rev, body: "\n## Flow\n\nVersion B.\n" });
    expect(second.status).toBe(409);
    const conflict = (await second.json()) as Conflict;
    expect(conflict.rev).toBe(won.rev);
    // The conflict body is the winner's entry, text included: what the app
    // shows next to the DM's own version.
    expect(conflict.entry.body).toBe("\n## Flow\n\nVersion A.\n");

    // Version B is nowhere — not in the row, not in the rendering.
    const after = await getEntry(SCENE);
    expect(after.body).toBe("\n## Flow\n\nVersion A.\n");
    expect(after.body).not.toContain("Version B");
    expect(after.rev).toBe(won.rev);

    const retry = await patchReq({ rev: conflict.rev, body: "\n## Flow\n\nVersion B.\n" });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as EntryResponse).body).toBe("\n## Flow\n\nVersion B.\n");
  });

  test("fired together: exactly one lands, whichever the runtime schedules first", async () => {
    // The sequential cases above are the deterministic contract. This one is
    // the concurrent shape — two requests in flight at once — and it asserts
    // the property that matters without pinning an order: ONE 200, ONE 409
    // whose token is the winner's, and a row that shows exactly the winner's
    // value.
    const read = await getEntry(SCENE);
    const responses = await Promise.all([
      patchReq({ rev: read.rev, properties: { status: "played" } }),
      patchReq({ rev: read.rev, properties: { status: "ready" } }),
    ]);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);

    const okRes = responses[responses.findIndex((r) => r.status === 200)]!;
    const conflictRes = responses[responses.findIndex((r) => r.status === 409)]!;
    const won = (await okRes.json()) as EntryResponse;
    const conflict = (await conflictRes.json()) as Conflict;

    expect(won.rev).toBe(read.rev + 1);
    expect(conflict.rev).toBe(won.rev);

    // The row carries the winner's value and NOTHING of the loser's: the
    // rev moved by exactly one, for exactly one write.
    const after = await getEntry(SCENE);
    expect(after.properties.status).toBe(won.properties.status);
    expect(after.rev).toBe(read.rev + 1);
  });

  test("fields and text share one token — a saved field invalidates a held text", async () => {
    // Properties and body are one row, so they are one guard. An app that
    // saved the status and then the text with the token it read BEFORE the
    // status write must be told, not silently allowed to revert.
    const read = await getEntry(SCENE);
    const patched = await patchReq({ rev: read.rev, properties: { status: "played" } });
    expect(patched.status).toBe(200);

    const staleBody = await patchReq({
      rev: read.rev,
      body: "\n## Flow\n\nAus einem alten Tab.\n",
    });
    expect(staleBody.status).toBe(409);
    expect(((await staleBody.json()) as Conflict).rev).toBe(read.rev + 1);
    expect((await getEntry(SCENE)).body).toBe(read.body);

    // …and the reverse direction, still in the same second.
    const body = await patchReq({ rev: read.rev + 1, body: "\n## Flow\n\nJetzt aber.\n" });
    expect(body.status).toBe(200);
    const staleProps = await patchReq({ rev: read.rev + 1, properties: { status: "draft" } });
    expect(staleProps.status).toBe(409);
    expect(((await staleProps.json()) as Conflict).rev).toBe(read.rev + 2);
    expect((await getEntry(SCENE)).properties.status).toBe("played");
  });

  test("both halves in one request move the rev once and cannot half-land", async () => {
    const read = await getEntry(SCENE);
    const res = await patchReq({
      rev: read.rev,
      properties: { status: "played" },
      body: "\n## Flow\n\nBeides zusammen.\n",
    });
    expect(res.status).toBe(200);
    const written = (await res.json()) as EntryResponse;
    expect(written.properties.status).toBe("played");
    expect(written.body).toBe("\n## Flow\n\nBeides zusammen.\n");
    // ONE write: one row update, one rev step, one version bump — the token
    // the client gets back is the one it must send next.
    expect(written.rev).toBe(read.rev + 1);
    const after = await getEntry(SCENE);
    expect(after.rev).toBe(written.rev);
    expect(after.properties.status).toBe("played");
    expect(after.body).toBe("\n## Flow\n\nBeides zusammen.\n");

    // A refused half writes NOTHING: an unknown key with a valid body.
    const refused = await patchReq({
      rev: written.rev,
      properties: { nonsense: "x" },
      body: "\n## Flow\n\nDarf nicht landen.\n",
    });
    expect(refused.status).toBe(400);
    const unchanged = await getEntry(SCENE);
    expect(unchanged.rev).toBe(written.rev);
    expect(unchanged.body).toBe("\n## Flow\n\nBeides zusammen.\n");
  });

  test("force writes the held fields on top of the current row", async () => {
    // The conflict dialog's "save anyway": the DM's text wins, and the field
    // somebody else changed meanwhile SURVIVES — force writes only what the
    // request carries.
    const read = await getEntry(SCENE);
    const other = await patchReq({ rev: read.rev, properties: { status: "played" } });
    expect(other.status).toBe(200);

    const forced = await patchReq({
      rev: read.rev, // the stale token the editor still holds
      body: "\n## Flow\n\nMein Text gewinnt.\n",
      force: true,
    });
    expect(forced.status).toBe(200);
    const written = (await forced.json()) as EntryResponse;
    expect(written.body).toBe("\n## Flow\n\nMein Text gewinnt.\n");
    expect(written.properties.status).toBe("played");
    // The other tab's write and this one: two writes, two rev steps.
    expect(written.rev).toBe(read.rev + 2);

    const after = await getEntry(SCENE);
    expect(after.body).toBe("\n## Flow\n\nMein Text gewinnt.\n");
    expect(after.properties.status).toBe("played");
  });
});
