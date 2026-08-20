// Version handshake between bundle and server (issue #24).
//
// After a deploy an open tab keeps running the OLD bundle against the NEW
// server — the incident that motivated this: a client expecting a synchronous
// POST /generate result got 202 { jobId } and crashed. The fix is not a
// smarter client but a visible one: both sides carry a build id, the version
// poll that already runs (use-campaign-version.ts) compares them, and a
// mismatch surfaces a reload banner. Never an automatic reload — that would
// throw away whatever the GM has half-typed into the live log.

import { useSyncExternalStore } from "react";

/**
 * Build id of this bundle. Vite's `define` replaces the identifier at build
 * time (vite.config.ts); the typeof guard keeps the module usable where no
 * such replacement happened — plain `bun test` — instead of throwing.
 */
export const APP_BUILD: string =
  typeof __GRIMOIRE_BUILD__ === "string" && __GRIMOIRE_BUILD__ !== ""
    ? __GRIMOIRE_BUILD__
    : "dev";

/**
 * True when the two build ids are known AND different, i.e. the tab is running
 * a bundle the server no longer ships.
 *
 * Either side reporting "dev" (or nothing at all, e.g. an older server without
 * the field) skips the check on purpose: a Vite dev bundle against a deployed
 * server — and a locally built server against a production bundle — are both
 * normal working setups, and neither would be helped by a permanent banner.
 * The handshake is only meaningful between two burned-in ids.
 */
export function isStaleBuild(appBuild: string, serverBuild: string | undefined): boolean {
  if (serverBuild === undefined) return false;
  if (appBuild === "" || serverBuild === "") return false;
  if (appBuild === "dev" || serverBuild === "dev") return false;
  return appBuild !== serverBuild;
}

// Module-level flag instead of a context: the reporter (the version poll) sits
// BELOW the layout that renders the banner in the route tree, so a provider
// above both would have to thread a setter down through the Outlet. One
// sticky boolean plus useSyncExternalStore is the smaller thing. Sticky on
// purpose: once a mismatch is seen the banner stays until the tab reloads.
let stale = false;
const listeners = new Set<() => void>();

/**
 * Feed the server's build id in (called on every version poll). `appBuild`
 * only exists so tests can drive the flag: under `bun test` there is no Vite
 * `define`, so APP_BUILD is always "dev" and the real call path could never
 * reach a mismatch. Production callers pass one argument.
 */
export function reportServerBuild(serverBuild: string | undefined, appBuild = APP_BUILD): void {
  if (stale || !isStaleBuild(appBuild, serverBuild)) return;
  stale = true;
  for (const listener of listeners) listener();
}

/** Current flag value — the store's snapshot. */
export function getStaleBuild(): boolean {
  return stale;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component to the mismatch flag. */
export function useStaleBuild(): boolean {
  return useSyncExternalStore(subscribe, getStaleBuild, () => false);
}

/** Test-only reset of the module flag. */
export function resetStaleBuild(): void {
  stale = false;
  for (const listener of listeners) listener();
}
