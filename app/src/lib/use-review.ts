// The review model (issue #10, app half): the union of today's tagged
// session-log lines and the tagged inbox lines, plus the done-state that
// comes from the server files ONLY — log lines via the session's `reviewed`
// short hashes, inbox lines via their `- [x]` marker. Used by the review
// route and by the topbar (progress, pool affordance); both share the same
// query cache, so nothing fetches twice.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchFile } from "@/api";
import { fmStringArray } from "@/lib/frontmatter";
import { useActedKeys } from "@/lib/review-memory";
import {
  firstReviewTag,
  harvestInboxEntries,
  isReviewTag,
  shortLineHashes,
  stripHashtags,
  tagAllowsNpc,
  tagAllowsThread,
} from "@/lib/review";
import { parseLogEntries, todaySessionRel } from "@/lib/session";
import { noSessionYet, useSessionFile } from "@/lib/use-session";

export const INBOX_PATH = "inbox.md";

export interface ReviewEntry {
  /** Stable identity: the line index in its file (log is append-only, the
   *  inbox rewrite happens in place). */
  key: string;
  source: "log" | "inbox";
  /** Prototype card label. */
  sourceLabel: string;
  /** Mono meta column: `HH:MM` for log lines, `yyyy-mm-dd` for inbox lines. */
  meta?: string;
  /** Hashtag without the `#`. */
  tag: string;
  /** Display text — hashtags stripped. */
  text: string;
  /** The line as it stands in the file: hashed for `reviewed` (log) or
   *  matched byte for byte by `inbox-done` (inbox). */
  rawLine: string;
  /** Short hash of rawLine — log entries only. */
  hash?: string;
  done: boolean;
  canThread: boolean;
  canNpc: boolean;
}

export interface ReviewModel {
  entries: ReviewEntry[];
  total: number;
  seenCount: number;
  pendingCount: number;
  /** Topbar progress per the prototype. */
  progressLabel: string;
  /** Still loading session/inbox/hashes — nothing decided yet. */
  isPending: boolean;
  /** No session file for today (the review has nothing to harvest). */
  noSession: boolean;
  /** The session file could not be loaded at all (server down …). */
  isError: boolean;
  /** WebCrypto unavailable (insecure origin) — log done-states unknown. */
  hashUnavailable: boolean;
  sessionPath: string;
}

interface UseReviewOptions {
  enabled?: boolean;
}

export function useReviewEntries(
  campaign: string,
  { enabled = true }: UseReviewOptions = {},
): ReviewModel {
  const sessionPath = todaySessionRel();
  // Inbox lines acted on in THIS browser session keep their (now `- [x]`)
  // card visible instead of vanishing under the cursor — and the topbar
  // counts the same cards as the page because the memory sits above both.
  const acted = useActedKeys(campaign);
  const keepDoneInbox = useMemo(
    () =>
      new Set(
        [...acted.keys()]
          .filter((key) => key.startsWith("inbox:"))
          .map((key) => Number(key.slice("inbox:".length))),
      ),
    [acted],
  );
  const session = useSessionFile(campaign, enabled);
  // inbox.md may not exist yet (404) — that is an empty inbox, not an error.
  const inbox = useQuery({
    queryKey: ["file", campaign, INBOX_PATH],
    queryFn: () => fetchFile(campaign, INBOX_PATH),
    enabled: enabled && campaign !== "",
    retry: false,
  });

  const sessionBody = session.data?.body ?? "";
  const inboxBody = inbox.data?.body ?? "";

  // Tagged log lines (README: #thread/#npc/#loot/#decision), keeping the raw
  // line and the index in the full log for the hash and the stable key.
  const logLines = useMemo(
    () =>
      parseLogEntries(sessionBody)
        .map((entry, index) => ({ entry, index }))
        .flatMap(({ entry, index }) => {
          const tag = firstReviewTag(entry.text);
          return tag === undefined ? [] : [{ entry, index, tag }];
        }),
    [sessionBody],
  );

  const rawLines = useMemo(() => logLines.map((l) => l.entry.raw), [logLines]);
  const hashes = useQuery({
    // Deterministic in its input — never goes stale, but a key for an older
    // log state may be collected normally.
    queryKey: ["review-hash", rawLines],
    queryFn: () => shortLineHashes(rawLines),
    enabled: enabled && rawLines.length > 0,
    staleTime: Infinity,
    retry: false,
  });

  const reviewed = useMemo(
    () => new Set(fmStringArray(session.data?.frontmatter.reviewed)),
    [session.data?.frontmatter.reviewed],
  );

  const entries = useMemo<ReviewEntry[]>(() => {
    const hashOf = hashes.data;
    const logEntries: ReviewEntry[] = logLines.map(({ entry, index, tag }) => {
      const hash = hashOf?.[entry.raw];
      const item: ReviewEntry = {
        key: `log:${index}`,
        source: "log",
        sourceLabel: "Log",
        tag,
        text: stripHashtags(entry.text),
        rawLine: entry.raw,
        done: hash !== undefined && reviewed.has(hash),
        canThread: tagAllowsThread(tag),
        canNpc: tagAllowsNpc(tag),
      };
      if (entry.time !== undefined) item.meta = entry.time;
      if (hash !== undefined) item.hash = hash;
      return item;
    });

    const inboxEntries: ReviewEntry[] = harvestInboxEntries(inboxBody, keepDoneInbox).map(
      (line) => {
        // Inbox rule: the first hashtag names the entry — but a harvest tag
        // anywhere in the line wins, so `#idee #npc` still offers the stub.
        const tag = line.tags.find(isReviewTag) ?? line.tags[0] ?? "";
        const item: ReviewEntry = {
          key: `inbox:${line.index}`,
          source: "inbox",
          sourceLabel: "Inbox",
          tag,
          text: line.text,
          rawLine: line.raw,
          done: line.done,
          canThread: tagAllowsThread(tag),
          canNpc: tagAllowsNpc(tag),
        };
        if (line.date !== undefined) item.meta = line.date;
        return item;
      },
    );

    return [...logEntries, ...inboxEntries];
  }, [logLines, inboxBody, keepDoneInbox, hashes.data, reviewed]);

  const seenCount = entries.filter((e) => e.done).length;
  const total = entries.length;
  const noSession = session.isError && noSessionYet(session.error);
  const hashesWaiting = rawLines.length > 0 && hashes.data === undefined && !hashes.isError;

  return {
    entries,
    total,
    seenCount,
    pendingCount: total - seenCount,
    progressLabel: `${seenCount} von ${total} gesichtet`,
    isPending: session.isPending || inbox.isPending || hashesWaiting,
    noSession,
    isError: session.isError && !noSession,
    hashUnavailable: hashes.isError,
    sessionPath,
  };
}
