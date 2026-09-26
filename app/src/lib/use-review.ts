// The review model (app half): the union of the harvested session's tagged log
// rows and the tagged ideas, plus the done-state that comes from the server
// ONLY — a log row carries `reviewed`, an idea carries `done`.
// Used by the review route and by the topbar (progress, chapter overview
// affordance); both share the same query cache, so nothing fetches twice.
//
// Rows in, rows out: the session embeds its log and the ideas answer
// themselves, so the only thing derived here is which SECTION a row belongs to
// and which actions its tag allows. Reviewing a log entry and ticking an idea
// off each send that row's own guard to its own resource. This is where the
// two meet — neither the session nor the idea knows the other.
//
// It is a HOOK, not a pure helper, so the two readable labels it produces —
// the source chip and the progress line — come from the catalog through
// `useT()` (same as lib/use-rev-write.ts); the lib layer stays free of copy of
// its own.

import type { Idea } from "@grimoire/shared/idea";
import type { LogEntry } from "@grimoire/shared/log-entry";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { fetchTree } from "@/api";
import { useT } from "@/i18n";
import { ideasQuery } from "@/idea/idea-query";
import { sceneTitle } from "@/lib/campaign";
import { useActedKeys } from "@/lib/review-memory";
import {
  PC_TAG,
  extractHashtags,
  firstReviewTag,
  groupByPcTag,
  hasPcTag,
  pcGroupTag,
  isReviewTag,
  stripHashtags,
  tagAllowsNpc,
  tagAllowsThread,
} from "@/lib/review";
import { useLastStartedSession } from "@/session/use-session";

export interface ReviewEntry {
  /** Stable identity: the source plus the row's own id. */
  key: string;
  source: "log" | "idea";
  /**
   * Which section the entry belongs to: the tagged harvest, or the notes
   * section of untagged ideas thrown in on the go, or the player-character
   * section of `#pc` rows. The counting is the same for all of them — one
   * source for page and topbar.
   */
  section: "harvest" | "notes" | "pc";
  /**
   * Card label — the idea label, or the log label plus the SCENE the row was
   * written under. The scene id from the row is resolved against the tree; an
   * id the tree does not know stays as it is (degrade).
   */
  sourceLabel: string;
  /** Mono meta column: `HH:MM` for log rows. */
  meta?: string;
  /** Hashtag without the `#`. */
  tag: string;
  /** Display text — hashtags stripped. */
  text: string;
  /** The row's id. */
  id: string;
  /** The log entry itself, for an entry from the log — reviewing it sends its `rev`. */
  logEntry?: LogEntry;
  /** The idea itself, for an entry from the ideas — ticking it off sends its `rev`. */
  idea?: Idea;
  /** The character tag of a `#pc` entry — undefined means the general group. */
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
  /** Topbar progress per the prototype, in the UI language. */
  progressLabel: string;
  /** Still loading the session or the ideas — nothing decided yet. */
  isPending: boolean;
  /** No session at all (the review has nothing to harvest). */
  noSession: boolean;
  /** The session could not be loaded at all (server down …). */
  isError: boolean;
  /** Id of the harvested session — the one its log entries hang under. */
  sessionId: string;
}

interface UseReviewOptions {
  enabled?: boolean;
}

/** The player-character entries of a model, grouped by character tag. */
export function pcGroups(entries: readonly ReviewEntry[]) {
  return groupByPcTag(
    entries.filter((entry) => entry.section === "pc"),
    (entry) => entry.pcGroup,
  );
}

/** A log row the review shows — with the tag that put it there. */
interface HarvestedLogRow {
  row: LogEntry;
  tag: string;
  /** A `#pc` row — its own section, no adoption. */
  pc: boolean;
  pcGroup?: string;
}

export function useReviewEntries(
  campaign: string,
  { enabled = true }: UseReviewOptions = {},
): ReviewModel {
  const t = useT();
  // Ideas acted on in THIS browser session keep their (now done) card
  // visible instead of vanishing under the cursor — and the topbar counts the
  // same cards as the page because the memory sits above both.
  const acted = useActedKeys(campaign);
  const keepDoneIdeas = useMemo(
    () =>
      new Set(
        [...acted.keys()]
          .filter((key) => key.startsWith("idea:"))
          .map((key) => key.slice("idea:".length)),
      ),
    [acted],
  );
  // WHICH session is harvested is the server's answer: the last STARTED one,
  // ended or not — the first of the list. Deriving today's session here would
  // break every session that runs past midnight: the harvest would be empty.
  const session = useLastStartedSession(campaign, enabled);
  const sessionId = session.data?.id ?? "";
  // The tree turns a log row's scene id into the scene TITLE for the
  // source chip. Same query key as every other view — shared cache, no
  // second request; a tree that is not there yet simply shows the id.
  const tree = useQuery({
    queryKey: ["tree", campaign],
    queryFn: () => fetchTree(campaign),
    enabled: enabled && campaign !== "",
  });
  // No ideas is an empty list. An error here must never look like "no
  // ideas", it just yields no entries.
  const ideas = useQuery({
    ...ideasQuery(campaign),
    enabled: enabled && campaign !== "",
    retry: false,
  });

  const logRows = session.data?.log;
  const ideaRows = ideas.data;

  // Tagged log rows (README: #thread/#npc/#loot/#decision).
  const harvestedLog = useMemo<HarvestedLogRow[]>(
    () =>
      (logRows ?? []).flatMap((row) => {
        const tags = extractHashtags(row.text);
        // `#pc` wins over the harvest tags (README): the row is a reminder
        // for the table, not campaign content.
        if (hasPcTag(tags)) {
          const entry: HarvestedLogRow = { row, tag: PC_TAG, pc: true };
          const group = pcGroupTag(tags);
          if (group !== undefined) entry.pcGroup = group;
          return [entry];
        }
        const tag = firstReviewTag(row.text);
        return tag === undefined ? [] : [{ row, tag, pc: false }];
      }),
    [logRows],
  );

  // The ideas the review shows: one ticked off in an earlier sitting stays
  // out, one ticked off in THIS sitting keeps its card.
  const openIdeas = useMemo<Idea[]>(
    () => (ideaRows ?? []).filter((row) => !row.done || keepDoneIdeas.has(row.id)),
    [ideaRows, keepDoneIdeas],
  );

  const treeData = tree.data;

  const entries = useMemo<ReviewEntry[]>(() => {
    const logEntries: ReviewEntry[] = harvestedLog.map(({ row, tag, pc, pcGroup }) => {
      const scene = sceneTitle(treeData, row.sceneId);
      const item: ReviewEntry = {
        key: `log:${row.id}`,
        source: "log",
        section: pc ? "pc" : "harvest",
        // The scene is part of ONE sentence, so the separator travels with
        // the message instead of being glued on.
        sourceLabel:
          scene === undefined ? t("review.source.log") : t("review.source.logScene", { scene }),
        tag,
        text: stripHashtags(row.text),
        id: row.id,
        logEntry: row,
        done: row.reviewed,
        // A PC note is never adopted into chapter or NPC.
        canThread: !pc && tagAllowsThread(tag),
        canNpc: !pc && tagAllowsNpc(tag),
      };
      if (pcGroup !== undefined) item.pcGroup = pcGroup;
      if (row.at !== "") item.meta = row.at;
      return item;
    });

    const ideaEntries: ReviewEntry[] = openIdeas.map((row) => {
      const tags = extractHashtags(row.text);
      const pc = hasPcTag(tags);
      // A `#pc` row is a reminder for the table, an untagged one is a note
      // the DM decides about — both keep their own section. Everything else
      // is the tagged harvest, where a harvest tag anywhere in the row wins
      // over the first tag, so `#idee #npc` still offers the npc action.
      const tag = pc ? PC_TAG : (tags.find(isReviewTag) ?? tags[0] ?? "");
      const section: ReviewEntry["section"] = pc ? "pc" : tags.length === 0 ? "notes" : "harvest";
      const item: ReviewEntry = {
        key: `idea:${row.id}`,
        source: "idea",
        section,
        sourceLabel: t("review.source.inbox"),
        tag,
        text: stripHashtags(row.text),
        id: row.id,
        idea: row,
        done: row.done,
        // No tag means no tag-derived affordance, so BOTH harvest actions are
        // offered; a PC reminder is never adopted.
        canThread: !pc && (section === "notes" || tagAllowsThread(tag)),
        canNpc: !pc && (section === "notes" || tagAllowsNpc(tag)),
      };
      if (pc) {
        const group = pcGroupTag(tags);
        if (group !== undefined) item.pcGroup = group;
      }
      return item;
    });

    return [...logEntries, ...ideaEntries];
  }, [harvestedLog, openIdeas, treeData, t]);

  const seenCount = entries.filter((e) => e.done).length;
  const total = entries.length;
  const noSession = session.data === null;

  return {
    entries,
    total,
    seenCount,
    pendingCount: total - seenCount,
    progressLabel: t("review.progress", { seen: seenCount, total }),
    isPending: session.isPending || ideas.isPending,
    noSession,
    isError: session.isError,
    sessionId,
  };
}
