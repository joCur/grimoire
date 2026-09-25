// The campaign resource (ADR #31): `GET` and `PATCH /campaigns/:c`, every
// field of the campaign flat — `body` among them — beside its `rev`, and
// every write checked against the campaign's schema. The address the
// campaign once had under `…/entries/` names nothing. The create side of the
// resource is in create-api.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Campaign, CampaignSummary } from "@grimoire/shared";
import { seedCampaign } from "../src/db/seed";
import { app } from "../src/server";
import { getDb } from "../src/store/handle";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const BEISPIEL = "/api/campaigns/beispiel";

/**
 * A SECOND campaign next to `beispiel`, holding nothing but its own row —
 * no name of its own, no description.
 */
const FRESH = "frischling";

async function getCampaign(url = BEISPIEL): Promise<Campaign> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as Campaign;
}

async function patchCampaign(body: unknown, url = BEISPIEL): Promise<Response> {
  return app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchOk(body: unknown, url = BEISPIEL): Promise<Campaign> {
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
      id: "beispiel",
      name: "Der Leuchtturm von Salzhafen",
      description:
        "Eine Küstenkampagne um einen erloschenen Leuchtturm, Schmuggler und die Frage, wer im Hafen wirklich das Sagen hat.",
      body: campaign.body,
      rev: campaign.rev,
    });
    expect(campaign.body).toContain("Kampagnenweite Notizen");
  });

  test("a campaign without a name of its own shows its id, like the list", async () => {
    seedCampaign(await getDb(), { campaign: { id: FRESH, name: "", body: "" } });
    const campaign = await getCampaign(`/api/campaigns/${FRESH}`);
    expect(campaign).toEqual({ id: FRESH, name: FRESH, body: "", rev: campaign.rev });
    expect((await listed(FRESH))?.name).toBe(FRESH);
  });

  test("404 for an unknown campaign", async () => {
    expect((await app.request("/api/campaigns/nirgends")).status).toBe(404);
  });

  test("the entry address of the campaign names nothing — GET and PATCH are 404", async () => {
    const before = await getCampaign();
    const url = entriesUrl("beispiel", "campaign");
    expect((await app.request(url)).status).toBe(404);
    const res = await app.request(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: before.rev, body: "Überschrieben.\n" }),
    });
    expect(res.status).toBe(404);
    expect(await getCampaign()).toEqual(before);
  });
});

describe("writing the campaign", () => {
  test("only the named fields change; the list picks them up right away", async () => {
    const before = await getCampaign();
    const after = await patchOk({ rev: before.rev, description: "Neue Kurzbeschreibung." });
    expect(after).toEqual({ ...before, description: "Neue Kurzbeschreibung.", rev: before.rev + 1 });
    expect(await getCampaign()).toEqual(after);
    expect((await listed("beispiel"))?.description).toBe("Neue Kurzbeschreibung.");
  });

  test("the body is a field like the others — written with the name in one step", async () => {
    const before = await getCampaign();
    const after = await patchOk({
      rev: before.rev,
      name: "Salzhafen",
      body: "\nNeue Notizen ohne Zeilenende",
    });
    expect(after.name).toBe("Salzhafen");
    expect(after.body).toBe("\nNeue Notizen ohne Zeilenende\n");
    expect(after.rev).toBe(before.rev + 1);
    expect(await getCampaign()).toEqual(after);
  });

  test("`null` clears the description", async () => {
    const before = await getCampaign();
    const after = await patchOk({ rev: before.rev, description: null });
    expect(Object.hasOwn(after, "description")).toBe(false);
    expect(Object.hasOwn((await listed("beispiel")) ?? {}, "description")).toBe(false);
  });

  test("a name equal to the id falls back to the id — nothing redundant is stored", async () => {
    const before = await getCampaign();
    const after = await patchOk({ rev: before.rev, name: "beispiel" });
    expect(after.name).toBe("beispiel");
    // A later rename of nothing but the display name round-trips.
    const renamed = await patchOk({ rev: after.rev, name: "Wieder benannt" });
    expect(renamed.name).toBe("Wieder benannt");
  });

  test("a field a campaign does not have, or a value of the wrong shape, is a 400 naming it", async () => {
    const before = await getCampaign();
    for (const [key, value] of [
      ["system", "5e"],
      ["glossaryIntro", "x"],
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
    const res = await patchCampaign({ rev: before.rev, id: "anders" });
    expect(res.status).toBe(400);
    expect(await getCampaign()).toEqual(before);
    const same = await patchOk({ rev: before.rev, id: "beispiel", name: "Salzhafen" });
    expect(same.name).toBe("Salzhafen");
  });

  test("a stale rev is 409 with the current campaign, and nothing is written", async () => {
    const before = await getCampaign();
    const res = await patchCampaign({ rev: before.rev - 1, name: "Überschrieben" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; rev: number; campaign: Campaign };
    expect(body.code).toBe("rev_conflict");
    expect(body.rev).toBe(before.rev);
    expect(body.campaign).toEqual(before);
    expect(await getCampaign()).toEqual(before);
  });

  test("force keeps a field somebody else changed while replacing the text", async () => {
    const read = await getCampaign();
    await patchOk({ rev: read.rev, name: "Salzhafen" });
    const forced = await patchOk({ rev: read.rev, body: "\nTrotzdem gespeichert.\n", force: true });
    expect(forced.body).toBe("\nTrotzdem gespeichert.\n");
    expect(forced.name).toBe("Salzhafen");
  });

  test("404 for an unknown campaign", async () => {
    expect((await patchCampaign({ rev: 1, name: "x" }, "/api/campaigns/nirgends")).status).toBe(
      404,
    );
  });
});
