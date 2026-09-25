// The API: assembles the route modules, one per resource (./<resource>.ts).
// Mounted under /api in server.ts. Response shapes are the contracts in
// @grimoire/shared: each entity's type from its own module, the other shapes
// in types.ts. THE ROUTE MODULES ARE THE API's documentation:
// every endpoint is described right above its route, and there is no second
// list anywhere that could drift away from it. HTTP helpers several modules
// share live in ./http.ts.
//
// ERROR BODIES ARE LANGUAGE-FREE. Every error a HUMAN reads carries a stable
// `code` from `@grimoire/shared/error-codes` plus the parameters its sentence
// needs; the `error` text next to it is the ENGLISH technical fallback (curl,
// logs, a client that does not know the code). The app renders the sentence
// from its own catalog (app/src/i18n, keys `server.<code>`) and degrades to
// that text for a code it does not know. Codes are APPEND-ONLY — the full
// list lives in shared/src/error-codes.ts.
//
// CREATING CONTENT: five POSTs, one shape (campaigns, chapters, scenes, npcs,
// locations): the DM types a NAME, the server derives the id with
// the shared slug rule (@grimoire/shared/slug) and answers with what it
// created in the shape its kind's GET answers — a `Campaign`, a `Chapter`, a
// `Scene`, an `Npc` or a `Location` — so the app can navigate straight into
// it. A taken id is `409 { code: "slug_taken", kind, id, suggestion }`; a
// name that yields no slug at all is a 400 that says so (store/shared.ts
// explains why neither is silently resolved). Every one of them also accepts an explicit `id` — that
// exists for ONE flow: taking the 409's `suggestion` in one click instead of
// making the DM invent another name.

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getBuildId } from "../config";
import { ApiError } from "../api-error";
import { campaignRoutes } from "./campaigns";
import { chapterRoutes } from "./chapters";
import { generateRoutes } from "./generate";
import { glossaryTermRoutes } from "./glossary-terms";
import { ideaRoutes } from "./ideas";
import { knowledgeItemRoutes } from "./knowledge-items";
import { locationRoutes } from "./locations";
import { npcRoutes } from "./npcs";
import { reviewRoutes } from "./review";
import { sceneRoutes } from "./scenes";
import { searchRoutes } from "./search";
import { sessionRoutes } from "./sessions";
import { settingsRoutes } from "./settings";
import { threadRoutes } from "./threads";

export const api = new Hono();

// Map ApiError to a small JSON error body; anything else is a real 500.
api.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message, ...err.extra }, err.status as ContentfulStatusCode);
  }
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});

// Every /api response carries the server's build id. The primary
// carrier is GET /campaigns/:campaign/version (the app polls it anyway); this header is
// the cheap belt-and-braces copy for anything that talks to the API without
// that poll — curl during a deploy, a future client, the browser network tab.
// Set on the finished response so handlers that return a raw Response (not
// c.json) get it too.
api.use("*", async (c, next) => {
  await next();
  c.res.headers.set("x-grimoire-build", getBuildId());
});

// Every route module is mounted at the root of /api — each one spells its full
// paths itself. No two modules register a pattern that matches the same
// request, so the order below changes nothing about which route answers;
// the build-id middleware above is registered first and wraps them all.
api.route("/", settingsRoutes);
api.route("/", campaignRoutes);
api.route("/", chapterRoutes);
api.route("/", sceneRoutes);
api.route("/", npcRoutes);
api.route("/", locationRoutes);
api.route("/", threadRoutes);
api.route("/", ideaRoutes);
api.route("/", glossaryTermRoutes);
api.route("/", knowledgeItemRoutes);

// A session answers its OWN shape on its own endpoints — `SessionResponse`,
// rows all the way down.
api.route("/", sessionRoutes);

api.route("/", reviewRoutes);
api.route("/", searchRoutes);
api.route("/", generateRoutes);
