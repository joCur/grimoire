/// <reference types="vite/client" />

/**
 * Build id of this bundle, injected by Vite's `define` (see vite.config.ts).
 * "dev" whenever GRIMOIRE_BUILD was not set at build time. Read it through
 * `APP_BUILD` in src/lib/build-id.ts, never directly — outside a Vite build
 * (bun test) the identifier does not exist at all.
 */
declare const __GRIMOIRE_BUILD__: string;
