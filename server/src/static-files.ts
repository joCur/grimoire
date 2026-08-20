// Static serving of the built frontend (issue #13, deployment).
//
// In production the whole app is ONE process: Hono serves /api and, as a
// fallback, the Vite build in app/dist (SPA routing -> index.html). In dev
// nothing here is active — the Vite dev server serves the app and proxies
// /api (app/vite.config.ts), so server.ts mounts these routes only when it
// is the process entrypoint AND the dist directory exists.
//
// Runtime-neutral by design (DECISIONS #5/#7): node:fs + node:stream only,
// deliberately NOT hono/bun's serveStatic — the same code serves the app on
// Bun and on Node via @hono/node-server.
//
// Not implemented on purpose: Range requests (no media streaming in the
// build), gzip/brotli precompression (behind Tailscale on a LAN this buys
// nothing), directory listings.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";

/** Content types for the extensions the Vite build actually emits. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/vnd.microsoft.icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Extensions that must never fall back to index.html: a missing .js/.css/font
 * is a build problem, and answering it with HTML only produces a confusing
 * MIME error in the browser. `.html` is NOT in this set (a missing page is a
 * client route), and neither are data paths like `.md` — the app has SPA
 * routes such as `/:campaign/file/<chapter>/<scene>.md`.
 */
const HARD_404_EXTENSIONS = new Set(
  Object.keys(CONTENT_TYPES).filter((ext) => ext !== ".html" && ext !== ".txt"),
);

const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
// Everything unhashed (index.html, /grimoire-icon.svg) must be revalidated,
// otherwise a deploy stays invisible until the browser cache expires.
const CACHE_REVALIDATE = "no-cache";

function contentType(abs: string): string {
  return CONTENT_TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Map a URL pathname (already percent-decoded) to an absolute path inside
 * `distDir`, or null when the path is not acceptable.
 *
 * Same lexical-first approach as campaign-fs.ts: reject NUL, backslashes,
 * absolute/Windows paths, empty/`.`/`..`/hidden segments — then resolve and
 * verify the result is still inside distDir. WHATWG URL parsing already
 * collapses `..` (including its encoded spellings) before a request reaches
 * us; this guard is the second line of defence and is unit-tested directly.
 */
export function resolveStaticPath(distDir: string, pathname: string): string | null {
  const dist = path.resolve(distDir);
  const rel = pathname.replace(/^\/+/, "");
  if (rel === "") return path.join(dist, "index.html");
  if (rel.includes("\0") || rel.includes("\\")) return null;
  if (/^[A-Za-z]:/.test(rel)) return null;
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === "." || segment === ".." || segment.startsWith(".")) {
      return null;
    }
  }
  const abs = path.resolve(dist, rel);
  if (abs !== dist && !abs.startsWith(dist + path.sep)) return null;
  return abs;
}

/** Weak validator from size + mtime — enough for `no-cache` revalidation. */
function etagOf(size: number, mtimeMs: number): string {
  return `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

/**
 * Response for one file, or null when it is not a regular file (caller then
 * decides: SPA fallback or 404). Streams the body via node:fs — no whole-file
 * buffering — and answers 304 when the client's ETag still matches.
 */
async function fileResponse(
  abs: string,
  method: string,
  ifNoneMatch: string | undefined,
  cacheControl: string,
): Promise<Response | null> {
  let s;
  try {
    s = await stat(abs);
  } catch {
    return null;
  }
  if (!s.isFile()) return null;

  const etag = etagOf(s.size, s.mtimeMs);
  const headers = new Headers({
    "content-type": contentType(abs),
    "cache-control": cacheControl,
    etag,
    "last-modified": new Date(s.mtimeMs).toUTCString(),
  });

  if (ifNoneMatch !== undefined && ifNoneMatch.split(",").some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("content-length", String(s.size));
  if (method === "HEAD") return new Response(null, { status: 200, headers });

  const body = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: 200, headers });
}

/**
 * Mount the SPA on `app`: GET/HEAD of any non-/api path is served from
 * `distDir`, unknown non-asset paths fall back to index.html (client-side
 * routing). Call this AFTER app.route("/api", …) — /api keeps its own 404s
 * and never sees the HTML fallback.
 */
export function mountStaticApp(app: Hono, distDir: string): void {
  const dist = path.resolve(distDir);
  const indexHtml = path.join(dist, "index.html");

  app.on(["GET", "HEAD"], "*", async (c, next) => {
    const raw = c.req.path;
    if (raw === "/api" || raw.startsWith("/api/")) return next();

    let pathname: string;
    try {
      pathname = decodeURIComponent(raw);
    } catch {
      return c.text("bad request", 400);
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) return next();

    const abs = resolveStaticPath(dist, pathname);
    if (abs === null) return c.text("bad request", 400);

    const method = c.req.method;
    const ifNoneMatch = c.req.header("if-none-match");
    const isHashedAsset = pathname.startsWith("/assets/");

    const hit = await fileResponse(
      abs,
      method,
      ifNoneMatch,
      isHashedAsset ? CACHE_IMMUTABLE : CACHE_REVALIDATE,
    );
    if (hit !== null) return hit;

    // Missing build artefact -> honest 404; missing page -> SPA entry point.
    if (isHashedAsset || HARD_404_EXTENSIONS.has(path.extname(pathname).toLowerCase())) {
      return c.text("not found", 404);
    }
    const fallback = await fileResponse(indexHtml, method, ifNoneMatch, CACHE_REVALIDATE);
    return fallback ?? c.text("not found", 404);
  });
}
