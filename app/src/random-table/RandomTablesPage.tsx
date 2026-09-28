// "/campaigns/:campaign/random-tables" — the random tables the DM imported
// into the instance, rolled at the table.
//
// Random tables are reference data of the instance (decisions/reference-data):
// none ships with the app, the DM imports 5etools files (./RandomTableImport),
// and the same tables serve every campaign. The page lists the sources, each
// naming its title, authors and link, and opens one table at a time: its roll
// action picks a row by the table's dice ranges and shows the number and the
// row, and the whole table stands below it on request.
//
// What becomes of a result is not this slice's business: the page composing
// it passes `resultActions`, which gets the rolled line (routes/random-tables).
//
// `?table=<id>` is the table the page has open — where a ⌘K hit leads.

import type { RandomTable, RandomTableSource } from "@grimoire/shared/random-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Dices } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";

import { MobileMenuRow } from "@/components/MobileMenuRow";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { cn } from "@/lib/utils";

import { removeRandomTableSource } from "./random-table-api";
import {
  RANDOM_TABLES_SCOPE,
  randomTableQuery,
  randomTableSourcesQuery,
  randomTablesOfQuery,
} from "./random-table-query";
import { RandomTableImport } from "./RandomTableImport";
import { rangeText, resultText, rollTable, type Roll } from "./roll";

const NOTE = "text-[13.5px] text-muted-foreground";

const SOURCE_LINK =
  "rounded text-foreground underline underline-offset-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** What the composing page offers for a rolled result. */
export interface RolledResult {
  table: RandomTable;
  /** The result as one line: the table's name and the row's text. */
  line: string;
}

export function RandomTablesPage({
  resultActions,
}: {
  resultActions?: (result: RolledResult) => ReactNode;
}) {
  const { campaign = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("table") ?? undefined;
  const t = useT();
  const sources = useQuery(randomTableSourcesQuery());
  const open = useQuery({ ...randomTableQuery(openId ?? ""), enabled: openId !== undefined });

  const openTable = (id: string) => setSearchParams({ table: id });

  return (
    <>
      <MobileMenuRow campaign={campaign} />
      <div className="mx-auto max-w-[760px] px-5 pt-5 pb-16 md:px-7 md:pt-10">
        <h1 className="mb-1.5 font-serif text-[24px] leading-[1.25] font-semibold text-foreground">
          {t("randomTables.title")}
        </h1>
        <p className="mb-5 max-w-[62ch] text-[13px] leading-[1.6] text-body-secondary">
          {t("randomTables.lead")}
        </p>

        {openId !== undefined && open.isError && (
          <p className={cn(NOTE, "mb-5")}>{t("randomTables.tableGone")}</p>
        )}
        {open.data !== undefined && (
          <TableCard
            key={open.data.id}
            table={open.data}
            source={sources.data?.find((source) => source.id === open.data.source)}
            resultActions={resultActions}
          />
        )}

        <h2 className="mt-2 mb-2 text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {t("randomTables.sources")}
        </h2>
        {sources.isPending && <p className={NOTE}>{t("randomTables.loading")}</p>}
        {sources.isError && <p className={NOTE}>{t("common.serverDown")}</p>}
        {sources.isSuccess && sources.data.length === 0 && (
          <p className={NOTE} data-testid="random-tables-empty">
            {t("randomTables.empty")}
          </p>
        )}
        {sources.isSuccess && sources.data.length > 0 && (
          <ul className="mb-6 border-t border-divider">
            {sources.data.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                openId={openId}
                holdsOpen={open.data?.source === source.id}
                onOpenTable={openTable}
                onRemoved={() => {
                  if (open.data?.source === source.id) setSearchParams({});
                }}
              />
            ))}
          </ul>
        )}

        <div className="mt-6">
          <RandomTableImport />
        </div>
      </div>
    </>
  );
}

/** Title, authors and link of a source, as one line of text and a link. */
function SourceCredit({ source }: { source: RandomTableSource }) {
  const t = useT();
  const authors = source.authors.join(", ");
  return (
    <span data-testid="random-table-source-credit">
      {source.url === "" ? (
        source.title
      ) : (
        <a href={source.url} target="_blank" rel="noreferrer" className={SOURCE_LINK}>
          {source.title}
        </a>
      )}
      {authors !== "" && (
        <span className="text-muted-foreground"> · {t("randomTables.by", { authors })}</span>
      )}
    </span>
  );
}

/** One source: its credit, its tables when unfolded, and its removal. */
function SourceRow({
  source,
  openId,
  holdsOpen,
  onOpenTable,
  onRemoved,
}: {
  source: RandomTableSource;
  openId: string | undefined;
  holdsOpen: boolean;
  onOpenTable: (id: string) => void;
  onRemoved: () => void;
}) {
  const t = useT();
  const [unfolded, setUnfolded] = useState(holdsOpen);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    if (holdsOpen) setUnfolded(true);
  }, [holdsOpen]);
  const tables = useQuery({ ...randomTablesOfQuery(source.id), enabled: unfolded });

  return (
    <li
      className="border-b border-divider py-2"
      data-testid="random-table-source"
      data-id={source.id}
    >
      <Collapsible open={unfolded} onOpenChange={setUnfolded}>
        <div className="flex items-start gap-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 flex-none"
              aria-label={t(unfolded ? "randomTables.fold" : "randomTables.unfold", {
                title: source.title,
              })}
            >
              <ChevronRight
                aria-hidden
                size={16}
                className={cn(
                  "transition-transform motion-reduce:transition-none",
                  unfolded && "rotate-90",
                )}
              />
            </Button>
          </CollapsibleTrigger>
          <p className="min-w-0 flex-1 pt-1 text-[14px] leading-[1.45] text-foreground">
            <SourceCredit source={source} />
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="flex-none text-muted-foreground"
            onClick={() => setRemoving(true)}
          >
            {t("randomTables.remove")}
          </Button>
        </div>
        <CollapsibleContent>
          {tables.isPending && (
            <p className={cn(NOTE, "py-1 pl-10")}>{t("randomTables.loading")}</p>
          )}
          {tables.isError && <p className={cn(NOTE, "py-1 pl-10")}>{t("common.serverDown")}</p>}
          {tables.data !== undefined && (
            <ul className="pb-1 pl-10" data-testid="random-table-list">
              {tables.data.map((table) => (
                <li key={table.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTable(table.id)}
                    aria-current={table.id === openId ? "true" : undefined}
                    data-testid="random-table-link"
                    data-id={table.id}
                    className={cn(
                      "flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-[13.5px] text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      table.id === openId && "bg-secondary",
                    )}
                  >
                    <span className="min-w-0 flex-1">{table.name}</span>
                    <span className="flex-none font-mono text-[12px] text-muted-foreground tabular-nums">
                      {table.die === null
                        ? t("randomTables.rowCount", { count: table.rows.length })
                        : `d${table.die}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
      {removing && (
        <RemoveSourceDialog
          source={source}
          onDone={() => setRemoving(false)}
          onRemoved={onRemoved}
        />
      )}
    </li>
  );
}

/** The question before a source goes for good, and its removal. */
function RemoveSourceDialog({
  source,
  onDone,
  onRemoved,
}: {
  source: RandomTableSource;
  onDone: () => void;
  onRemoved: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => removeRandomTableSource(source),
    onSuccess: async () => {
      onRemoved();
      onDone();
      await queryClient.invalidateQueries({ queryKey: RANDOM_TABLES_SCOPE });
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: RANDOM_TABLES_SCOPE });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !remove.isPending) onDone();
      }}
    >
      <DialogContent className="max-w-[440px]">
        <DialogTitle>{t("randomTables.removeDialog.title", { title: source.title })}</DialogTitle>
        <DialogDescription>{t("randomTables.removeDialog.body")}</DialogDescription>
        {remove.isError && (
          <p className="text-[13px] text-destructive" role="alert">
            {serverErrorMessage(remove.error, t, "randomTables.removeDialog.failed")}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={remove.isPending}>
              {t("randomTables.removeDialog.keep")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t("randomTables.removeDialog.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The open table: its source, its text, the roll and its result, and its rows. */
function TableCard({
  table,
  source,
  resultActions,
}: {
  table: RandomTable;
  source: RandomTableSource | undefined;
  resultActions?: (result: RolledResult) => ReactNode;
}) {
  const t = useT();
  const [roll, setRoll] = useState<Roll | undefined>(undefined);
  // Every roll is a new result, so what was done with the last one is gone.
  const [rolls, setRolls] = useState(0);
  const [rowsShown, setRowsShown] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const row = roll === undefined ? undefined : table.rows[roll.row];
  const text = row === undefined ? "" : resultText(table, row);

  return (
    <section
      className="mb-7 rounded-xl border border-input bg-card px-4 pt-3.5 pb-3"
      data-testid="random-table-card"
      data-id={table.id}
    >
      <h2
        ref={heading}
        className="font-serif text-[19px] leading-[1.3] font-semibold text-foreground"
      >
        {table.name}
      </h2>
      {source !== undefined && (
        <p className="text-[12.5px] leading-[1.6] text-body-secondary">
          <SourceCredit source={source} />
        </p>
      )}
      {table.caption !== "" && table.caption !== table.name && (
        <p className="mt-1.5 text-[13px] leading-[1.6] text-body-secondary">{table.caption}</p>
      )}
      {table.intro !== "" && (
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-[1.6] whitespace-pre-line text-body-secondary">
          {table.intro}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            setRoll(rollTable(table));
            setRolls((n) => n + 1);
          }}
          disabled={table.rows.length === 0}
          className="min-h-11 gap-2 px-4 text-[14px] font-semibold"
          data-testid="random-table-roll"
        >
          <Dices aria-hidden size={16} />
          {table.die === null
            ? t("randomTables.rollAny")
            : t("randomTables.roll", { die: table.die })}
        </Button>
      </div>

      <div aria-live="polite" className="mt-3">
        {row !== undefined && roll !== undefined && (
          <div
            className="rounded-lg bg-panel-deep px-3.5 py-3"
            data-testid="random-table-result"
            data-row={roll.row}
          >
            <p className="flex items-baseline gap-3 text-[15px] leading-[1.5] text-foreground">
              {roll.value !== null && (
                <span
                  className="flex-none font-mono text-[20px] font-semibold text-primary tabular-nums"
                  data-testid="random-table-result-value"
                >
                  {roll.value}
                </span>
              )}
              <span className="min-w-0 flex-1">{text}</span>
            </p>
            {resultActions !== undefined && (
              <div key={rolls} className="mt-2.5">
                {resultActions({ table, line: `${table.name}: ${text}` })}
              </div>
            )}
          </div>
        )}
      </div>

      <Collapsible open={rowsShown} onOpenChange={setRowsShown} className="mt-3">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1 px-2 text-body-secondary"
          >
            <ChevronRight
              aria-hidden
              size={14}
              className={cn(
                "transition-transform motion-reduce:transition-none",
                rowsShown && "rotate-90",
              )}
            />
            {t(rowsShown ? "randomTables.hideRows" : "randomTables.showRows", {
              count: table.rows.length,
            })}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 overflow-x-auto">
            <table
              className="w-full border-collapse text-[13px] leading-[1.5]"
              data-testid="random-table-rows"
            >
              <thead>
                <tr className="border-b border-divider text-left text-[12px] text-muted-foreground">
                  {table.die !== null && (
                    <th className="py-1 pr-3 font-medium">{`d${table.die}`}</th>
                  )}
                  {table.columns.map((column, i) => (
                    <th key={i} className="py-1 pr-3 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr
                    key={i}
                    aria-current={roll?.row === i ? "true" : undefined}
                    className={cn(
                      "border-b border-divider align-top",
                      roll?.row === i && "bg-secondary",
                    )}
                  >
                    {table.die !== null && (
                      <td className="py-1 pr-3 font-mono whitespace-nowrap text-muted-foreground tabular-nums">
                        {rangeText(r)}
                      </td>
                    )}
                    {r.cells.map((cell, c) => (
                      <td key={c} className="py-1 pr-3 text-foreground">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
