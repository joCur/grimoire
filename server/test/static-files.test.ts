// Static SPA serving tests (issue #13). The dist directory is a temp fixture
// that mimics a Vite build (index.html + hashed /assets/*), so the tests do
// not depend on whether app/dist has been built.
//
// The app under test is composed exactly like server.ts does it in production:
// /api first, then the static catch-all (mountStaticApp) — the real app object
// stays API-only on import, so these routes cannot leak into the other suites.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { api } from "../src/routes/api";
import { mountStaticApp, resolveStaticPath } from "../src/static-files";
import { dropStore, seedStore } from "./support/store";

const INDEX_HTML = '<!doctype html>\n<html lang="de"><body><div id="root"></div></body></html>\n';
const APP_JS = 'console.log("grimoire");\n';

let dist = "";
let app: Hono;

beforeAll(async () => {
  // The boot imports nothing since issue #79 — the campaign the /api
  // assertion below asks for is seeded explicitly.
  await seedStore();
  dist = await mkdtemp(path.join(os.tmpdir(), "grimoire-dist-"));
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await writeFile(path.join(dist, "index.html"), INDEX_HTML);
  await writeFile(path.join(dist, "assets", "index-abc123.js"), APP_JS);
  await writeFile(path.join(dist, "assets", "index-abc123.css"), ":root{color:red}\n");
  await writeFile(path.join(dist, "assets", "literata-latin-xyz.woff2"), "not-a-real-font");
  await writeFile(path.join(dist, "grimoire-icon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");

  // Same order as server.ts: API routes win, static is the fallback.
  app = new Hono();
  app.route("/api", api);
  mountStaticApp(app, dist);
});

afterAll(async () => {
  dropStore();
  if (dist !== "") await rm(dist, { recursive: true, force: true });
});

describe("index.html", () => {
  test("GET / serves index.html, no-cache", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toBe(INDEX_HTML);
  });

  test("HEAD / has the headers but no body", async () => {
    const res = await app.request("/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(INDEX_HTML)));
    expect(await res.text()).toBe("");
  });

  test("unknown client route falls back to index.html (SPA routing)", async () => {
    for (const p of ["/beispiel", "/beispiel/live", "/beispiel/list/npcs", "/nope/deep/route"]) {
      const res = await app.request(p);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(await res.text()).toBe(INDEX_HTML);
    }
  });

  test("a file-like client route keeps working (/…/file/<scene>)", async () => {
    // The scene route carries a campaign-relative .md path in the URL; that
    // must not be mistaken for a missing build artefact.
    const res = await app.request("/beispiel/file/01-salzhafen/hafen/ankunft-leuchtturm");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX_HTML);
  });

  test("ETag revalidation answers 304", async () => {
    const first = await app.request("/");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    const second = await app.request("/", { headers: { "if-none-match": etag! } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });
});

describe("assets", () => {
  test("hashed asset is served immutable with its content type", async () => {
    const res = await app.request("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe(APP_JS);
  });

  test("content types for css, woff2 and svg", async () => {
    const css = await app.request("/assets/index-abc123.css");
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const font = await app.request("/assets/literata-latin-xyz.woff2");
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(font.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const svg = await app.request("/grimoire-icon.svg");
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    // unhashed -> must revalidate
    expect(svg.headers.get("cache-control")).toBe("no-cache");
  });

  test("missing asset is a 404, never the HTML fallback", async () => {
    for (const p of ["/assets/gone-deadbee.js", "/nope.js", "/nope.css", "/nope.woff2"]) {
      const res = await app.request(p);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).not.toBe("text/html; charset=utf-8");
    }
  });
});

describe("path safety", () => {
  test("resolveStaticPath rejects traversal, absolute, hidden and NUL paths", () => {
    for (const p of [
      "/../etc/passwd",
      "/../../etc/passwd",
      "/assets/../../etc/passwd",
      "/./index.html",
      "/.env",
      "/.git/config",
      "/assets/.hidden",
      "/C:/windows/system32",
      "/a\\..\\..\\etc",
      "/index.html\0.png",
    ]) {
      expect(resolveStaticPath(dist, p)).toBeNull();
    }
  });

  test("resolveStaticPath keeps legitimate paths inside dist", () => {
    expect(resolveStaticPath(dist, "/")).toBe(path.join(dist, "index.html"));
    expect(resolveStaticPath(dist, "/assets/index-abc123.js")).toBe(
      path.join(dist, "assets", "index-abc123.js"),
    );
  });

  test("traversal over HTTP never returns content from outside dist", async () => {
    // WHATWG URL parsing already collapses `..` (and its encoded spellings)
    // before routing, so these end up as 404/400 or the SPA fallback — in no
    // case as a file from outside the build directory.
    for (const p of [
      "/../../etc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/assets/..%2f..%2fetc%2fpasswd",
      "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/.env",
      "/index.html%00.png",
    ]) {
      const res = await app.request(p);
      expect([200, 400, 404]).toContain(res.status);
      const body = res.status === 200 ? await res.text() : "";
      if (body !== "") expect(body).toBe(INDEX_HTML);
    }
  });

  test("malformed percent-encoding is a 400", async () => {
    const res = await app.request("/%E0%A4%A");
    expect(res.status).toBe(400);
  });
});

describe("/api is untouched", () => {
  test("the API still answers under the static catch-all", async () => {
    const res = await app.request("/api/campaigns");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((c) => c.id)).toContain("beispiel");
  });

  test("unknown /api paths 404 instead of falling back to index.html", async () => {
    for (const p of ["/api/nope", "/api/", "/api"]) {
      const res = await app.request(p);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toBe(INDEX_HTML);
    }
  });

  test("POST is not intercepted by the static routes", async () => {
    const res = await app.request("/beispiel/live", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toBe(INDEX_HTML);
  });
});
