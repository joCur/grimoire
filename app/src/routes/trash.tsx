// "/campaigns/:campaign/trash" — what the DM deleted, until the server
// removes it for good (decisions/trash): the chapters, scenes, npcs,
// locations and ideas in the trash, each with the days it has left and a
// restore action.
//
// The page composes five slices: each one reads its own trash list and
// restores its own rows on its own resource (`PATCH { rev, deletedMs: null }`
// with the `rev` the list answered with). What connects them lives here: a
// scene that went to the trash together with its chapter — the same chapter,
// the same moment — is no row of its own but part of its chapter's row, and
// comes back with it. A restore brings rows back into the tree, the lists and
// the search, so it refreshes everything read from the campaign.
//
// A refused restore says why in a whole sentence under its row: what is in
// the way (the blockers of `restore_blocked` and `chapter_in_trash`), a row
// changed elsewhere, or one that is no longer in the trash — the latter two
// read the lists again.

import type { QueryKey } from "@tanstack/react-query";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { TRASH_RETENTION_DAYS } from "@grimoire/shared/trash";
import { useRef, useState } from "react";
import { useParams } from "react-router";

import { ApiError, isNotFound } from "@/api";
import { restoreChapter } from "@/chapter/chapter-api";
import { chapterTrashKey, chapterTrashQuery } from "@/chapter/chapter-query";
import { MobileBackRow } from "@/components/MobileBackRow";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey, type Translate } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { restoreIdea } from "@/idea/idea-api";
import { ideaTrashKey, ideaTrashQuery } from "@/idea/idea-query";
import { daysUntilPurge } from "@/lib/trash";
import { invalidateCampaignQueries } from "@/lib/use-campaign-version";
import { restoreLocation } from "@/location/location-api";
import { locationTrashKey, locationTrashQuery } from "@/location/location-query";
import { restoreNpc } from "@/npc/npc-api";
import { npcTrashKey, npcTrashQuery } from "@/npc/npc-query";
import { restoreScene } from "@/scene/scene-api";
import { sceneTrashKey, sceneTrashQuery } from "@/scene/scene-query";

/** One row of the page, whatever its entity. */
interface TrashItem {
  /** Unique on the page: the kind and the row's id. */
  key: string;
  id: string;
  name: string;
  deletedMs: number;
  /** The key of the trash list the row stands in. */
  listKey: QueryKey;
  /** For a chapter: how many of its scenes come back with it. */
  scenes?: number;
  restore: () => Promise<unknown>;
}

interface TrashGroup {
  heading: MessageKey;
  items: TrashItem[];
}

export function TrashRoute() {
  const { campaign = "" } = useParams();
  const t = useT();
  const queryClient = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [restored, setRestored] = useState("");

  const [chapters, scenes, npcs, locations, ideas] = useQueries({
    queries: [
      chapterTrashQuery(campaign),
      sceneTrashQuery(campaign),
      npcTrashQuery(campaign),
      locationTrashQuery(campaign),
      ideaTrashQuery(campaign),
    ],
  });
  const reads = [chapters, scenes, npcs, locations, ideas];

  const restore = useMutation({
    mutationFn: (item: TrashItem) => item.restore(),
    onMutate: () => setRestored(""),
    onSuccess: (_answer, item) => {
      // The row leaves its list at once; the rest — the scenes that came
      // back with a chapter, the tree, the lists, the search — is read again.
      queryClient.setQueryData<Array<{ id: string }>>(item.listKey, (list) =>
        list?.filter((row) => row.id !== item.id),
      );
      invalidateCampaignQueries(queryClient, campaign);
      setRestored(t("trash.restored", { name: item.name }));
      // The row and its button are gone: the focus goes back to the top of
      // the page instead of falling to the document.
      heading.current?.focus();
    },
    onError: (error) => {
      // A row changed or restored elsewhere: read the lists again, so what
      // the page offers is what is in the trash now.
      if (isStale(error) || isNotFound(error)) invalidateCampaignQueries(queryClient, campaign);
    },
  });

  const groups = trashGroups(campaign, {
    chapters: chapters.data ?? [],
    scenes: scenes.data ?? [],
    npcs: npcs.data ?? [],
    locations: locations.data ?? [],
    ideas: ideas.data ?? [],
  }).filter((group) => group.items.length > 0);
  const now = new Date();
  const failure = (item: TrashItem) =>
    restore.isError && restore.variables?.key === item.key
      ? restoreFailure(restore.error, t)
      : undefined;

  return (
    <>
      <MobileBackRow campaign={campaign} />
      <div className="mx-auto max-w-[760px] px-5 pt-5 pb-16 md:px-7 md:pt-10">
        <h1
          ref={heading}
          tabIndex={-1}
          className="mb-1.5 rounded font-serif text-[24px] leading-[1.25] font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t("trash.title")}
        </h1>
        <p className="mb-6 max-w-[62ch] text-[13px] leading-[1.6] text-body-secondary">
          {t("trash.lead", { days: TRASH_RETENTION_DAYS })}
        </p>
        <p role="status" className="sr-only">
          {restored}
        </p>

        {reads.some((read) => read.isError) ? (
          <p className={NOTE}>{t("trash.loadFailed")}</p>
        ) : reads.some((read) => read.isPending) ? (
          <p className={NOTE}>{t("trash.loading")}</p>
        ) : groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-input px-6 py-8 text-center text-[14px] leading-[1.6] text-muted-foreground">
            {t("trash.empty")}
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            {groups.map((group) => (
              <section key={group.heading} aria-labelledby={`trash-${group.heading}`}>
                <h2
                  id={`trash-${group.heading}`}
                  className="mb-1 text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase"
                >
                  {t(group.heading)}
                </h2>
                <ul>
                  {group.items.map((item) => (
                    <TrashRow
                      key={item.key}
                      item={item}
                      remaining={daysUntilPurge(item.deletedMs, now)}
                      busy={restore.isPending}
                      error={failure(item)}
                      onRestore={() => restore.mutate(item)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const NOTE = "text-[14px] text-muted-foreground";

function TrashRow({
  item,
  remaining,
  busy,
  error,
  onRestore,
}: {
  item: TrashItem;
  remaining: number;
  busy: boolean;
  error: string | undefined;
  onRestore: () => void;
}) {
  const t = useT();
  return (
    <li className="flex min-h-[52px] items-center gap-3 border-b border-divider py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] text-foreground">{item.name}</p>
        <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
          {t("trash.remaining", { days: remaining })}
          {item.scenes !== undefined && item.scenes > 0 && (
            <>
              {" "}
              {t("trash.chapter.scenes", { count: item.scenes })}
            </>
          )}
        </p>
        {error !== undefined && (
          <p aria-live="polite" className="mt-1 text-[12.5px] leading-[1.5] text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        aria-label={t("trash.restore.aria", { name: item.name })}
        onClick={onRestore}
        className="h-auto min-h-9 flex-none border-input bg-transparent px-3 py-1.5 text-[12.5px] font-normal text-body-secondary hover:border-border-hover hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {t("trash.restore")}
      </Button>
    </li>
  );
}

/** A 409 of a row changed elsewhere — not one that names what is in the way. */
function isStale(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.details.code === "rev_conflict";
}

/** Why a restore wrote nothing, as the sentence under its row. */
function restoreFailure(error: unknown, t: Translate): string {
  if (isStale(error)) return t("trash.restore.stale");
  if (isNotFound(error)) return t("trash.restore.gone");
  return serverErrorMessage(error, t, "trash.restore.failed");
}

interface TrashRows {
  chapters: Array<{ id: string; title: string; deletedMs?: number; rev: number }>;
  scenes: Array<{ id: string; title: string; chapter: string; deletedMs?: number; rev: number }>;
  npcs: Array<{ id: string; name: string; deletedMs?: number; rev: number }>;
  locations: Array<{ id: string; name: string; deletedMs?: number; rev: number }>;
  ideas: Array<{ id: string; text: string; deletedMs?: number; rev: number }>;
}

/**
 * The page's groups, in the order of the campaign's own hierarchy. A scene
 * that went to the trash with its chapter — its chapter in the trash, the
 * same moment — is counted on the chapter's row instead of standing on its
 * own. A row without a trash moment is none of the trash's and is left out.
 */
function trashGroups(campaign: string, rows: TrashRows): TrashGroup[] {
  const withChapter = (scene: TrashRows["scenes"][number]) =>
    rows.chapters.some(
      (chapter) => chapter.id === scene.chapter && chapter.deletedMs === scene.deletedMs,
    );
  const item = (
    kind: string,
    row: { id: string; deletedMs?: number },
    name: string,
    listKey: QueryKey,
    restore: () => Promise<unknown>,
  ): TrashItem[] =>
    row.deletedMs === undefined
      ? []
      : [{ key: `${kind}:${row.id}`, id: row.id, name, deletedMs: row.deletedMs, listKey, restore }];
  return [
    {
      heading: "trash.group.chapters",
      items: rows.chapters.flatMap((chapter) =>
        item(
          "chapter",
          chapter,
          chapter.title === "" ? chapter.id : chapter.title,
          chapterTrashKey(campaign),
          () => restoreChapter(campaign, chapter),
        ).map((row) => ({
          ...row,
          scenes: rows.scenes.filter(
            (scene) => scene.chapter === chapter.id && scene.deletedMs === chapter.deletedMs,
          ).length,
        })),
      ),
    },
    {
      heading: "trash.group.scenes",
      items: rows.scenes
        .filter((scene) => !withChapter(scene))
        .flatMap((scene) =>
          item("scene", scene, scene.title === "" ? scene.id : scene.title, sceneTrashKey(campaign), () =>
            restoreScene(campaign, scene),
          ),
        ),
    },
    {
      heading: "trash.group.npcs",
      items: rows.npcs.flatMap((npc) =>
        item("npc", npc, npc.name === "" ? npc.id : npc.name, npcTrashKey(campaign), () =>
          restoreNpc(campaign, npc),
        ),
      ),
    },
    {
      heading: "trash.group.locations",
      items: rows.locations.flatMap((location) =>
        item(
          "location",
          location,
          location.name === "" ? location.id : location.name,
          locationTrashKey(campaign),
          () => restoreLocation(campaign, location),
        ),
      ),
    },
    {
      heading: "trash.group.ideas",
      items: rows.ideas.flatMap((idea) =>
        item("idea", idea, idea.text, ideaTrashKey(campaign), () => restoreIdea(campaign, idea)),
      ),
    },
  ];
}
