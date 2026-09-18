// The rules of ONE editing session over one entry — pure, so they are
// testable without a dialog. The react/react-query envelope is
// lib/use-entry-edit.ts.
//
// The session holds the version it writes against. That version is taken when
// the edit STARTS, from the entry that was on screen then, and it moves for
// exactly two reasons, both of them a decision:
//
//   a successful write   the server answers with the row it wrote, and its
//                        version is what a second save in the same session
//                        has to carry.
//   an adopted entry     the DM chose to drop the draft and continue from
//                        what is stored.
//
// Nothing else moves it. There is deliberately no event for "the entry query
// refetched": the 5s version poll refetches while an editor is open, and
// taking the poll's version would turn someone else's write into a silent
// overwrite instead of the 409 that asks the DM what to do. A conflict does
// not move it either — the retry is either an adopt or an explicit force, and
// both say so.

import type { EntryResponse } from "@grimoire/shared/types";

import type { PatchEntryRequest, RevConflict } from "@/api";

/** The fields one save carries — at least one of them, or there is no write. */
export interface EntryWrite {
  properties?: Record<string, unknown>;
  body?: string;
}

export interface EntryEditState {
  /** The version the next save is checked against. */
  rev: number;
  /**
   * The server's state at the last refused write: present exactly while the
   * conflict is unresolved, which is what puts the conflict line on screen.
   * `entry` is undefined when the 409 carried no entry.
   */
  conflict?: RevConflict | undefined;
  /**
   * The write the conflict refused, kept so the force action can resend the
   * same fields instead of asking the surface to rebuild them.
   */
  refused?: EntryWrite | undefined;
}

export type EntryEditEvent =
  /** A write came back written — the returned entry is the new truth. */
  | { type: "saved"; entry: EntryResponse }
  /** A write was refused: nothing was written, the row had moved. */
  | { type: "refused"; write: EntryWrite; conflict: RevConflict }
  /** The DM dropped the draft: this entry is now what the session edits. */
  | { type: "adopted"; entry: EntryResponse }
  /** A write started, or the surface left the conflict behind. */
  | { type: "cleared" };

/** The state an editing session starts in. */
export function entryEditState(rev: number): EntryEditState {
  return { rev };
}

export function entryEditReducer(
  state: EntryEditState,
  event: EntryEditEvent,
): EntryEditState {
  switch (event.type) {
    case "saved":
      return { rev: event.entry.rev };
    case "refused":
      // The version stays where it was. A retry is either an adopt (which
      // moves it knowingly) or a force (which does not need it).
      return { rev: state.rev, conflict: event.conflict, refused: event.write };
    case "adopted":
      return { rev: event.entry.rev };
    case "cleared":
      return { rev: state.rev };
  }
}

/** Is there anything to send? An empty request is the server's 400. */
export function hasEntryWrite(write: EntryWrite): boolean {
  return write.properties !== undefined || write.body !== undefined;
}

/**
 * The request body for one attempt. `force` is what turns the retry after a
 * conflict into "write these fields on top of what is stored now" — the
 * version rides along unchanged, because the server ignores it then and a
 * request that omitted it would read as a different kind of write.
 */
export function entryEditRequest(
  state: EntryEditState,
  write: EntryWrite,
  force = false,
): PatchEntryRequest {
  return {
    rev: state.rev,
    ...(write.properties === undefined ? {} : { properties: write.properties }),
    ...(write.body === undefined ? {} : { body: write.body }),
    ...(force ? { force: true } : {}),
  };
}
