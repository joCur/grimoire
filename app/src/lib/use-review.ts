// The review model (issue #10, app half): the union of the harvested
// session's tagged log lines and the tagged inbox lines, plus the done-state that
// comes from the server ONLY — log lines via the session's `reviewed`
// short hashes, inbox lines via their `- [x]` marker. Used by the review
// route and by the topbar (progress, pool affordance); both share the same
// query cache, so nothing fetches twice.
//
// It is a HOOK, not a pure helper, so the two readable labels it produces —
// the source chip and the progress line — come from the catalog through
// `useT()` (issue #69, same as lib/use-rev-write.ts); the lib layer stays
// free of copy of its own.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchEntry, fetchTree } from "@/api";
import { useT } from "@/i18n";
import { sceneTitle } from "@/lib/campaign";
import { fmStringArray } from "@/lib/properties";
import { useActedKeys } from "@/lib/review-memory";
import {
  PC_TAG,
  extractHashtags,
  firstReviewTag,
  groupByPcTag,
  harvestInboxEntries,
  hasPcTag,
  inboxNoteEntries,
  inboxPcEntries,
  pcGroupTag,
  isReviewTag,
  shortLineHashes,
  stripHashtags,
  tagAllowsNpc,
  tagAllowsThread,
} from "@/lib/review";
import type { LogEntry } from "@/lib/session";
import { parseLogEntries } from "@/lib/session";
import { useLastStartedSession } from "@/lib/use-session";

export const INBOX_PATH = "inbox";

export interface ReviewEntry {
  /** Stable identity: the line index in its session (log is append-only, the
   *  inbox rewrite happens in place). */
  key: string;
  source: "log" | "inbox";
  /**
   * Which list the entry belongs to (issue #85): the tagged harvest, or the
   * „Notizen" section of untagged inbox lines thrown in on the go, or the
   * „Spielercharaktere" of `#pc` lines (issue #86). The counting is the same
   * for all of them — one source for page and topbar.
   */
  section: "harvest" | "notes" | "pc";
  /**
   * Prototype card label — "Inbox", or "Log" plus the SCENE the line was
   * written under ("Log · Ankunft am Leuchtturm", issue #34). The scene id
   * from the log line is resolved against the tree; an id the tree does not
   * know stays as it is (degrade).
   */
  sourceLabel: string;
  /** Mono meta column: `HH:MM` for log lines, `yyyy-mm-dd` for inbox lines. */
  meta?: string;
  /** Hashtag without the `#`. */
  tag: string;
  /** Display text — hashtags stripped. */
  text: string;
  /** The line as it stands in the log: hashed for `reviewed` (log) or
   *  matched byte for byte by `inbox-done` (inbox). */
  rawLine: string;
  /** Short hash of rawLine — log entries only. */
  hash?: string;
  /** The character tag of a `#pc` entry — undefined means „Allgemein". */
  pcGroup?: string;
  done: boolean;
  canThread: boolean;
  canNpc: boolean;
}

export interface ReviewModel {
  entries: ReviewEntry[];
  total: number;
  seenCount: number;
  pendingCount: number;
  /** Topbar progress per the prototype, in the UI language (#69). */
  progressLabel: string;
  /** Still loading session/inbox/hashes — nothing decided yet. */
  isPending: boolean;
  /** No session at all (the review has nothing to harvest). */
  noSession: boolean;
  /** The session could not be loaded at all (server down …). */
  isError: boolean;
  /** WebCrypto unavailable (insecure origin) — log done-states unknown. */
  hashUnavailable: boolean;
  sessionPath: string;
}

interface UseReviewOptions {
  enabled?: boolean;
}

/** The „Spielercharaktere" entries of a model, grouped by character tag. */
export function pcGroups(entries: readonly ReviewEntry[]) {
  return groupByPcTag(
    entries.filter((entry) => entry.section === "pc"),
    (entry) => entry.pcGroup,
  );
}

/** A log line the review shows — with the tag that put it there. */
interface HarvestedLogLine {
  entry: LogEntry;
  index: number;
  tag: string;
  /** A `#pc` line (issue #86) — its own section, no adoption. */
  pc: boolean;
  pcGroup?: string;
}

export function useReviewEntries(
  campaign: string,
  { enabled = true }: UseReviewOptions = {},
): ReviewModel {
  const t = useT();
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
  // WHICH session is harvested is the server's answer: the last STARTED one,
  // ended or not (finding 1). Deriving today's session id here broke every
  // session that ran past midnight — `end` writes into the session that
  // started in, so the harvest was empty and `review/seen` patched a path
  // that does not exist.
  const session = useLastStartedSession(campaign, enabled);
  const sessionPath = session.data?.path ?? "";
  // The tree turns the log line's scene id into the scene TITLE for the
  // source chip. Same query key as every other view — shared cache, no
  // second request; a tree that is not there yet simply shows the id.
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: enabled && campaign !== "",
  });
  // An empty inbox answers 200 with an empty document since issue #70. The
  // 404 tolerance stays for a campaign the server does not know — an error
  // here must never look like "no ideas", it just yields no entries.
  const inbox = useQuery({
    queryKey: ["entry", campaign, INBOX_PATH],
    queryFn: () => fetchEntry(campaign, INBOX_PATH),
    enabled: enabled && campaign !== "",
    retry: false,
  });

  const sessionBody = session.data?.body ?? "";
  const inboxBody = inbox.data?.body ?? "";

  // Tagged log lines (README: #thread/#npc/#loot/#decision), keeping the raw
  // line and the index in the full log for the hash and the stable key.
  const logLines = useMemo<HarvestedLogLine[]>(
    () =>
      parseLogEntries(sessionBody)
        .map((entry, index) => ({ entry, index }))
        .flatMap(({ entry, index }) => {
          const tags = extractHashtags(entry.text);
          // `#pc` wins over the harvest tags (README): the line is a reminder
          // for the table, not campaign content.
          if (hasPcTag(tags)) {
            const line: HarvestedLogLine = { entry, index, tag: PC_TAG, pc: true };
            const group = pcGroupTag(tags);
            if (group !== undefined) line.pcGroup = group;
            return [line];
          }
          const tag = firstReviewTag(entry.text);
          return tag === undefined ? [] : [{ entry, index, tag, pc: false }];
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
    () => new Set(fmStringArray(session.data?.properties.reviewed)),
    [session.data?.properties.reviewed],
  );

  const treeData = tree.data;

  const entries = useMemo<ReviewEntry[]>(() => {
    const hashOf = hashes.data;
    const logEntries: ReviewEntry[] = logLines.map(({ entry, index, tag, pc, pcGroup }) => {
      const hash = hashOf?.[entry.raw];
      const scene = sceneTitle(treeData, entry.sceneId);
      const item: ReviewEntry = {
        key: `log:${index}`,
        source: "log",
        section: pc ? "pc" : "harvest",
        // The scene is part of ONE sentence („Log · Ankunft am Leuchtturm"),
        // so the separator travels with the message instead of being glued on.
        sourceLabel:
          scene === undefined ? t("review.source.log") : t("review.source.logScene", { scene }),
        tag,
        text: stripHashtags(entry.text),
        rawLine: entry.raw,
        done: hash !== undefined && reviewed.has(hash),
        // A PC note is never adopted into chapter or NPC (issue #86).
        canThread: !pc && tagAllowsThread(tag),
        canNpc: !pc && tagAllowsNpc(tag),
      };
      if (pcGroup !== undefined) item.pcGroup = pcGroup;
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
          section: "harvest",
          sourceLabel: t("review.source.inbox"),
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

    // Untagged inbox lines (issue #85): no tag means no tag-derived
    // affordance, so BOTH harvest actions are offered — the DM decides what
    // the note is. "Erledigt" is the same `inbox-done` write as the tagged
    // card's "Verwerfen".
    const noteEntries: ReviewEntry[] = inboxNoteEntries(inboxBody, keepDoneInbox).map((line) => {
      const item: ReviewEntry = {
        key: `inbox:${line.index}`,
        source: "inbox",
        section: "notes",
        sourceLabel: t("review.source.inbox"),
        tag: "",
        text: line.text,
        rawLine: line.raw,
        done: line.done,
        canThread: true,
        canNpc: true,
      };
      if (line.date !== undefined) item.meta = line.date;
      return item;
    });

    // `#pc` inbox lines (issue #86): same list/tick-off mechanic as the
    // notes, but grouped by character in the page and offered in the live
    // aside. No adoption — see README.
    const pcEntries: ReviewEntry[] = inboxPcEntries(inboxBody, keepDoneInbox).map((line) => {
      const item: ReviewEntry = {
        key: `inbox:${line.index}`,
        source: "inbox",
        section: "pc",
        sourceLabel: t("review.source.inbox"),
        tag: PC_TAG,
        text: line.text,
        rawLine: line.raw,
        done: line.done,
        canThread: false,
        canNpc: false,
      };
      const group = pcGroupTag(line.tags);
      if (group !== undefined) item.pcGroup = group;
      if (line.date !== undefined) item.meta = line.date;
      return item;
    });

    return [...logEntries, ...inboxEntries, ...noteEntries, ...pcEntries];
  }, [logLines, inboxBody, keepDoneInbox, hashes.data, reviewed, treeData, t]);

  const seenCount = entries.filter((e) => e.done).length;
  const total = entries.length;
  const noSession = session.data === null;
  const hashesWaiting = rawLines.length > 0 && hashes.data === undefined && !hashes.isError;

  return {
    entries,
    total,
    seenCount,
    pendingCount: total - seenCount,
    progressLabel: t("review.progress", { seen: seenCount, total }),
    isPending: session.isPending || inbox.isPending || hashesWaiting,
    noSession,
    isError: session.isError,
    hashUnavailable: hashes.isError,
    sessionPath,
  };
}
