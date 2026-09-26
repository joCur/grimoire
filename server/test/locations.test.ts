// The location resource (decisions/resources): `GET …/locations`, `GET` and `PATCH
// …/locations/:id`, every field of a location flat — `body` among them —
// beside its `rev`, and the PATCH checked against the location's schema.
// `…/entries/locations/<id>` names nothing.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Location } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, seedStore } from "./support/store";
import { entriesUrl } from "./support/urls";

const LOCATIONS = "/api/campaigns/example/locations";
const TOWER = `${LOCATIONS}/lighthouse`;

async function getLocation(url = TOWER): Promise<Location> {
  const res = await app.request(url);
  expect(res.status).toBe(200);
  return (await res.json()) as Location;
}

async function patchLocation(body: Record<string, unknown>, url = TOWER): Promise<Response> {
  return app.request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await seedStore();
});

afterEach(() => {
  dropStore();
});

describe("reading a location", () => {
  test("GET answers every field flat — no kind, no path, no properties", async () => {
    const tower = await getLocation();
    expect(tower).toEqual({
      id: "lighthouse",
      name: "The Lighthouse of Salt Harbour",
      chapter: "01-salt-harbour",
      roll20Page: "Lighthouse",
      atmosphere:
        "Left in a hurry, not in a fight: nothing is knocked over, but everything is left where it stood.",
      body: tower.body,
      rev: tower.rev,
    });
    expect(tower.body).toContain("## On first entering");
    expect(typeof tower.rev).toBe("number");
  });

  test("the list answers every location in its own shape, sorted by name", async () => {
    const res = await app.request(LOCATIONS);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Location[];
    expect(list.map((location) => location.id)).toEqual(["lighthouse", "cove"]);
    expect(list[0]).toEqual(await getLocation());
  });

  test("404 for an unknown location or campaign", async () => {
    expect((await app.request(`${LOCATIONS}/does-not-exist`)).status).toBe(404);
    expect((await app.request("/api/campaigns/nowhere/locations/lighthouse")).status).toBe(404);
  });

  test("the entry address of a location names nothing — GET and PATCH are 404", async () => {
    const url = entriesUrl("example", "locations/lighthouse");
    expect((await app.request(url)).status).toBe(404);
    const before = await getLocation();
    const res = await app.request(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev: before.rev, body: "Overwritten.\n" }),
    });
    expect(res.status).toBe(404);
    expect(await getLocation()).toEqual(before);
  });
});

describe("writing a location", () => {
  test("only the named fields change; `null` clears an optional one", async () => {
    const before = await getLocation();
    const res = await patchLocation({ rev: before.rev, name: "The Old Lighthouse", roll20Page: null });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Location;
    expect(after.name).toBe("The Old Lighthouse");
    expect(Object.hasOwn(after, "roll20Page")).toBe(false);
    expect(after.chapter).toBe(before.chapter);
    expect(after.atmosphere).toBe(before.atmosphere);
    expect(after.body).toBe(before.body);
    expect(after.rev).toBe(before.rev + 1);
    expect(await getLocation()).toEqual(after);
  });

  test("the body is a field like the others — written with a field in one step", async () => {
    const before = await getLocation();
    const res = await patchLocation({
      rev: before.rev,
      atmosphere: "Fog hangs in the stairwell.",
      body: "## On first entering\n\nSilence.",
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Location;
    expect(after.atmosphere).toBe("Fog hangs in the stairwell.");
    expect(after.body).toBe("## On first entering\n\nSilence.\n");
    expect(after.rev).toBe(before.rev + 1);
  });

  test("400 for a field a location does not have — named, and nothing written", async () => {
    const before = await getLocation();
    for (const extra of [
      { status: "alive" },
      { properties: { name: "X" } },
      { "roll20-page": "X" },
      { kind: "location" },
      { path: "locations/lighthouse" },
    ]) {
      const res = await patchLocation({ rev: before.rev, ...extra });
      expect(res.status).toBe(400);
      const key = Object.keys(extra)[0]!;
      expect(((await res.json()) as { error: string }).error).toContain(key);
    }
    expect((await getLocation()).rev).toBe(before.rev);
  });

  test("400 for a value of the wrong shape, naming the field — nothing written", async () => {
    const before = await getLocation();
    for (const [key, value] of [
      ["name", 7],
      ["name", null],
      ["atmosphere", ["Fog"]],
      ["body", 3],
    ] as const) {
      const res = await patchLocation({ rev: before.rev, [key]: value });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(key);
    }
    expect((await patchLocation({ name: "without rev" })).status).toBe(400);
    expect((await getLocation()).rev).toBe(before.rev);
  });

  test("the id may be echoed, never changed; an empty patch writes nothing", async () => {
    const before = await getLocation();
    expect((await patchLocation({ rev: before.rev, id: "tower" })).status).toBe(400);
    const empty = await patchLocation({ rev: before.rev });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ code: "nothing_to_write" });
    expect((await getLocation()).rev).toBe(before.rev);
  });

  test("a chapter has to exist — 400 with the create-this-first code", async () => {
    const before = await getLocation();
    const res = await patchLocation({ rev: before.rev, chapter: "99-nowhere" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "chapter_unknown" });
    expect(await getLocation()).toEqual(before);
  });

  test("a stale rev is 409 with the current location; force writes only what it carries", async () => {
    const read = await getLocation();
    expect((await patchLocation({ rev: read.rev, roll20Page: "Tower (foreign)" })).status).toBe(200);

    const refused = await patchLocation({ rev: read.rev, atmosphere: "New mood." });
    expect(refused.status).toBe(409);
    const conflict = (await refused.json()) as { code: string; rev: number; location: Location };
    expect(conflict.code).toBe("rev_conflict");
    expect(conflict.location.roll20Page).toBe("Tower (foreign)");
    expect(conflict.rev).toBe(conflict.location.rev);

    const forced = await patchLocation({ rev: read.rev, atmosphere: "New mood.", force: true });
    expect(forced.status).toBe(200);
    const written = (await forced.json()) as Location;
    expect(written.atmosphere).toBe("New mood.");
    expect(written.roll20Page).toBe("Tower (foreign)");
  });

  test("404 for an unknown location", async () => {
    const res = await patchLocation({ rev: 1, name: "X" }, `${LOCATIONS}/does-not-exist`);
    expect(res.status).toBe(404);
  });

  test("the search index follows a rename, and the hit carries no address", async () => {
    const before = await getLocation();
    expect((await patchLocation({ rev: before.rev, name: "Cape Beaconfire" })).status).toBe(200);
    const res = await app.request("/api/campaigns/example/search?q=Beaconfire");
    const { results } = (await res.json()) as { results: Array<Record<string, unknown>> };
    const hit = results.find((r) => r.kind === "location" && r.id === "lighthouse");
    expect(hit).toBeDefined();
    expect(hit?.title).toBe("Cape Beaconfire");
    expect(Object.hasOwn(hit!, "path")).toBe(false);
  });
});
