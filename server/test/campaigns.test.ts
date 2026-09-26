// The campaign resource (decisions/resources): `GET` and `PATCH /campaigns/:c`, every
// field of the campaign flat — `body` among them — beside its `rev`, and
// every write checked against the campaign's schema. An address under
// `…/entries/` names nothing. The create side of the
// resource is in create-api.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Campaign, CampaignSummary } from "@grimoire/shared";
import { seedCampaign } from "../src/db/seed";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const EXAMPLE = "/api/campaigns/example";

/**
 * A SECOND campaign next to `example`, holding nothing but its own row —
 * no name of its own, no description.
 */
const FRESH = "newcomer";

async function getCampaign(url = EXAMPLE): Promise<Campaign> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as Campaign;
}

async function patchCampaign(body: unknown, url = EXAMPLE): Promise<Response> {
  return app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchOk(body: unknown, url = EXAMPLE): Promise<Campaign> {
  const res = await patchCampaign(body, url);
  expect(res.status).toBe(200);
  return (await res.json()) as Campaign;
}

async function listed(id: string): Promise<CampaignSummary | undefined> {
  const list = (await (await app.request("/api/campaigns")).json()) as CampaignSummary[];
  return list.find((campaign) => campaign.id === id);
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("reading the campaign", () => {
  test("GET answers every field flat — no kind, no path, no properties", async () => {
    const campaign = await getCampaign();
    expect(campaign).toEqual({
      id: "example",
      name: "The Lighthouse of Salt Harbour",
      description:
        "A coastal campaign about a dark lighthouse, smugglers and the question of who really runs the harbour.",
      body: campaign.body,
      glossaryIntro: "",
      rev: campaign.rev,
    });
    expect(campaign.body).toContain("Campaign-wide notes");
  });

  test("a campaign without a name of its own shows its id, like the list", async () => {
    seedCampaign(await getDb(), { campaign: { id: FRESH, name: "", body: "", glossaryIntro: "" } });
    const campaign = await getCampaign(`/api/campaigns/${FRESH}`);
    expect(campaign).toEqual({ id: FRESH, name: FRESH, body: "", glossaryIntro: "", rev: campaign.rev });
    expect((await listed(FRESH))?.name).toBe(FRESH);
  });

  test("404 for an unknown campaign", async () => {
    expect((await app.request("/api/campaigns/nowhere")).status).toBe(404);
  });

  test("the entry address of the campaign names nothing — GET and PATCH are 404", async () => {
    const before = await getCampaign();
    const url = entriesUrl("example", "campaign");
    expect((await app.request(url)).status).toBe(404);
    const res = await app.request(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: before.rev, body: "Overwritten.\n" }),
    });
    expect(res.status).toBe(404);
    expect(await getCampaign()).toEqual(before);
  });
});

describe("writing the campaign", () => {
  test("only the named fields change; the list picks them up right away", async () => {
    const before = await getCampaign();
    const after = await patchOk({ rev: before.rev, description: "New short description." });
    expect(after).toEqual({ ...before, description: "New short description.", rev: before.rev + 1 });
    expect(await getCampaign()).toEqual(after);
    expect((await listed("example"))?.description).toBe("New short description.");
  });

  test("the body is a field like the others — written with the name in one step", async () => {
    const before = await getCampaign();
    const after = await patchOk({
      rev: before.rev,
      name: "Salt Harbour",
      body: "\nNew notes without a line ending",
    });
    expect(after.name).toBe("Salt Harbour");
    expect(after.body).toBe("\nNew notes without a line ending\n");
    expect(after.rev).toBe(before.rev + 1);
    expect(await getCampaign()).toEqual(after);
  });

  test("the glossary intro is a field of the campaign, written like the body", async () => {
    const before = await getCampaign();
    const after = await patchOk({ rev: before.rev, glossaryIntro: "Terms from the module." });
    expect(after).toEqual({
      ...before,
      glossaryIntro: "Terms from the module.\n",
      rev: before.rev + 1,
    });
    expect(await getCampaign()).toEqual(after);
  });

  test("`null` clears the description", async () => {
    const before = await getCampaign();
    const after = await patchOk({ rev: before.rev, description: null });
    expect(Object.hasOwn(after, "description")).toBe(false);
    expect(Object.hasOwn((await listed("example")) ?? {}, "description")).toBe(false);
  });

  test("a name equal to the id falls back to the id — nothing redundant is stored", async () => {
    const before = await getCampaign();
    const after = await patchOk({ rev: before.rev, name: "example" });
    expect(after.name).toBe("example");
    // A later rename of nothing but the display name round-trips.
    const renamed = await patchOk({ rev: after.rev, name: "Named again" });
    expect(renamed.name).toBe("Named again");
  });

  test("a field a campaign does not have, or a value of the wrong shape, is a 400 naming it", async () => {
    const before = await getCampaign();
    for (const [key, value] of [
      ["system", "5e"],
      ["glossaryIntro", 7],
      ["name", 7],
      ["description", ["x"]],
    ] as const) {
      const res = await patchCampaign({ rev: before.rev, [key]: value });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(key);
    }
    expect(await getCampaign()).toEqual(before);
  });

  test("a request that names no field is nothing_to_write", async () => {
    const before = await getCampaign();
    const res = await patchCampaign({ rev: before.rev });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("nothing_to_write");
    expect(await getCampaign()).toEqual(before);
  });

  test("the id may be echoed, never changed", async () => {
    const before = await getCampaign();
    const res = await patchCampaign({ rev: before.rev, id: "other" });
    expect(res.status).toBe(400);
    expect(await getCampaign()).toEqual(before);
    const same = await patchOk({ rev: before.rev, id: "example", name: "Salt Harbour" });
    expect(same.name).toBe("Salt Harbour");
  });

  test("a stale rev is 409 with the current campaign, and nothing is written", async () => {
    const before = await getCampaign();
    const res = await patchCampaign({ rev: before.rev - 1, name: "Overwritten" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; rev: number; campaign: Campaign };
    expect(body.code).toBe("rev_conflict");
    expect(body.rev).toBe(before.rev);
    expect(body.campaign).toEqual(before);
    expect(await getCampaign()).toEqual(before);
  });

  test("force keeps a field somebody else changed while replacing the text", async () => {
    const read = await getCampaign();
    await patchOk({ rev: read.rev, name: "Salt Harbour" });
    const forced = await patchOk({ rev: read.rev, body: "\nSaved anyway.\n", force: true });
    expect(forced.body).toBe("\nSaved anyway.\n");
    expect(forced.name).toBe("Salt Harbour");
  });

  test("404 for an unknown campaign", async () => {
    expect((await patchCampaign({ rev: 1, name: "x" }, "/api/campaigns/nowhere")).status).toBe(
      404,
    );
  });
});
