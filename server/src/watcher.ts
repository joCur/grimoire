// File watcher (issue #8): one chokidar watcher on CAMPAIGN_ROOT that
// invalidates the affected campaign's search index and bumps its version
// counter whenever a markdown file changes on disk (external editor,
// generator, git pull — and the app's own writes, which is fine: the
// invalidation is idempotent and the poll-driven refresh converges).
//
// NOT started on module import — server.ts starts it only when it is the
// process entrypoint, so importing the app for in-process tests stays free
// of side effects (and `bun test` does not hang on a live fs watcher).
//
// Client refresh is version-polling, not SSE — see DECISIONS #9.

import { existsSync } from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { getCampaignRoot } from "./config";
import { invalidateCampaign } from "./search-index";

/** Quiet period after the last fs event before invalidations are applied. */
const DEBOUNCE_MS = 200;

/**
 * Start watching CAMPAIGN_ROOT. Events for markdown files are debounced
 * (~200ms, trailing) and collapsed per campaign — an editor save burst or a
 * git checkout causes one invalidation per touched campaign, not one per
 * file. Dotfiles (and dot-directories, e.g. .git) are ignored entirely.
 *
 * Never throws and never crashes the server: a missing root is logged and
 * skipped (returns null), runtime errors (e.g. the root vanishing) only log.
 */
export function startWatcher(): FSWatcher | null {
  const root = getCampaignRoot();
  if (!existsSync(root)) {
    console.warn(`watcher: campaign root does not exist, not watching: ${root}`);
    return null;
  }

  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    for (const campaign of pending) invalidateCampaign(campaign);
    pending.clear();
  };

  const watcher = watch(root, {
    ignoreInitial: true,
    // The root itself may live under a dotted path (e.g. a tmp dir in CI);
    // only entries BELOW it are subject to the dotfile rule.
    ignored: (p) => p !== root && path.basename(p).startsWith("."),
  });

  watcher.on("all", (event, p) => {
    if (event !== "add" && event !== "change" && event !== "unlink") return;
    if (!p.endsWith(".md")) return;
    const rel = path.relative(root, p);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return; // outside the root
    const campaign = rel.split(path.sep)[0];
    if (campaign === undefined || campaign === rel) return; // file directly in the root — no campaign
    pending.add(campaign);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  });

  // E.g. the root or a subtree vanished mid-watch: log, keep serving.
  watcher.on("error", (err) => console.error("watcher error:", err));

  return watcher;
}
