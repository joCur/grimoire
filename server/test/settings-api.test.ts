// GET/PUT /api/settings — the instance's UI language.
//
// The setting is CAMPAIGN-INDEPENDENT and works on an EMPTY instance too: the
// cold start has no campaign yet and still has to be able to ask which
// language it is in. Both cases are covered below.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { InstanceSettings } from "@grimoire/shared";
import { app } from "../src/server";
import { dropStore, emptyStore, seedStore } from "./support/store";

async function get(): Promise<InstanceSettings> {
  const res = await app.request("/api/settings");
  expect(res.status).toBe(200);
  return (await res.json()) as InstanceSettings;
}

async function put(body: unknown): Promise<Response> {
  return app.request("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterAll(() => {
  dropStore();
});

describe("GET /api/settings", () => {
  test("a fresh instance has not decided — locale is null", async () => {
    await emptyStore();
    expect(await get()).toEqual({ locale: null });
  });

  test("answers on a seeded instance the same way", async () => {
    await seedStore();
    expect(await get()).toEqual({ locale: null });
  });
});

describe("PUT /api/settings", () => {
  beforeEach(async () => {
    await emptyStore();
  });

  test("stores the language and reads it back", async () => {
    const res = await put({ locale: "en" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "en" });
    expect(await get()).toEqual({ locale: "en" });
  });

  test("a second switch replaces the first — one row, not a history", async () => {
    await put({ locale: "en" });
    await put({ locale: "de" });
    expect(await get()).toEqual({ locale: "de" });
  });

  test("null clears it — back to following the browser", async () => {
    await put({ locale: "en" });
    const res = await put({ locale: null });
    expect(res.status).toBe(200);
    expect(await get()).toEqual({ locale: null });
  });

  test("an unknown language is refused and changes nothing", async () => {
    await put({ locale: "de" });
    const res = await put({ locale: "fr" });
    expect(res.status).toBe(400);
    expect(await get()).toEqual({ locale: "de" });
  });

  test("a missing locale is a 400, not a silent clear", async () => {
    await put({ locale: "de" });
    expect((await put({})).status).toBe(400);
    expect(await get()).toEqual({ locale: "de" });
  });

  test("an unknown body key is refused", async () => {
    expect((await put({ locale: "de", theme: "dark" })).status).toBe(400);
  });
});
