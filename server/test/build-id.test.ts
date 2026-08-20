// Build id handshake, server half (issue #24): the id rides on the version
// poll the app already runs, plus a header on every /api response.
// In-process via app.request(), against the example campaign.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getBuildId, getCampaignRoot, setCampaignRoot } from "../src/config";
import { app } from "../src/server";

const EXAMPLES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../examples");

let originalRoot: string;
const originalEnv = process.env.GRIMOIRE_BUILD;

beforeAll(() => {
  originalRoot = getCampaignRoot();
  setCampaignRoot(EXAMPLES);
});

afterAll(() => {
  setCampaignRoot(originalRoot);
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.GRIMOIRE_BUILD;
  else process.env.GRIMOIRE_BUILD = originalEnv;
});

describe("getBuildId", () => {
  test('defaults to "dev" without GRIMOIRE_BUILD', () => {
    delete process.env.GRIMOIRE_BUILD;
    expect(getBuildId()).toBe("dev");
  });

  test("returns the env value, trimmed", () => {
    process.env.GRIMOIRE_BUILD = "  0f1e2d3  ";
    expect(getBuildId()).toBe("0f1e2d3");
  });

  test('an empty or whitespace value degrades to "dev" (no banner)', () => {
    process.env.GRIMOIRE_BUILD = "   ";
    expect(getBuildId()).toBe("dev");
    process.env.GRIMOIRE_BUILD = "";
    expect(getBuildId()).toBe("dev");
  });
});

describe("GET /api/:campaign/version", () => {
  async function version(): Promise<{ version: number; build: string }> {
    const res = await app.request("/api/beispiel/version");
    expect(res.status).toBe(200);
    return (await res.json()) as { version: number; build: string };
  }

  test('carries the build id additively — "dev" in a dev process', async () => {
    delete process.env.GRIMOIRE_BUILD;
    const body = await version();
    expect(body.build).toBe("dev");
    expect(typeof body.version).toBe("number");
  });

  test("carries GRIMOIRE_BUILD when the image set one", async () => {
    process.env.GRIMOIRE_BUILD = "deadbee";
    expect((await version()).build).toBe("deadbee");
  });
});

describe("x-grimoire-build header", () => {
  test("is on read responses", async () => {
    process.env.GRIMOIRE_BUILD = "deadbee";
    const campaigns = await app.request("/api/campaigns");
    expect(campaigns.headers.get("x-grimoire-build")).toBe("deadbee");
    const tree = await app.request("/api/beispiel/tree");
    expect(tree.headers.get("x-grimoire-build")).toBe("deadbee");
  });

  test("is on error responses too", async () => {
    process.env.GRIMOIRE_BUILD = "deadbee";
    const res = await app.request("/api/nope/version");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-grimoire-build")).toBe("deadbee");
  });

  test('falls back to "dev" outside an image', async () => {
    delete process.env.GRIMOIRE_BUILD;
    const res = await app.request("/api/campaigns");
    expect(res.headers.get("x-grimoire-build")).toBe("dev");
  });
});
