// Importing a 5etools file of random tables: pick it from disk, or load it
// from an address (a GitHub file page is read from its raw address). The app
// reads the file and sends its content; the server never fetches anything
// itself. Importing a source that is already there replaces its tables.
//
// The outcome stands below the form as a whole sentence: which sources came
// in with how many tables, or why nothing was written.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { serverErrorMessage } from "@/i18n/server-errors";
import { cn } from "@/lib/utils";

import { importRandomTables } from "./random-table-api";
import { RANDOM_TABLES_SCOPE } from "./random-table-query";
import { sourceFileUrl } from "./source-url";

/** Why a file never reached the server. */
class ReadFailure extends Error {
  constructor(readonly reason: "notJson" | "unreachable") {
    super(reason);
  }
}

function parseFile(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ReadFailure("notJson");
  }
}

async function readAddress(address: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(sourceFileUrl(address));
  } catch {
    throw new ReadFailure("unreachable");
  }
  if (!response.ok) throw new ReadFailure("unreachable");
  return parseFile(await response.text());
}

export function RandomTableImport() {
  const t = useT();
  const queryClient = useQueryClient();
  const addressId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState("");

  const run = useMutation({
    mutationFn: async (read: () => Promise<unknown>) => importRandomTables(await read()),
    onSuccess: async () => {
      setAddress("");
      await queryClient.invalidateQueries({ queryKey: RANDOM_TABLES_SCOPE });
    },
  });

  const outcome = (): string => {
    if (run.isPending) return t("randomTables.import.running");
    if (run.isError) {
      const error = run.error;
      if (error instanceof ReadFailure) {
        return t(
          error.reason === "notJson"
            ? "randomTables.import.notJson"
            : "randomTables.import.unreachable",
        );
      }
      return serverErrorMessage(error, t, "randomTables.import.failed");
    }
    if (run.isSuccess) {
      return t("randomTables.import.done", {
        titles: run.data.map((source) => source.title).join(", "),
        count: run.data.length,
      });
    }
    return "";
  };

  return (
    <section
      aria-labelledby={`${addressId}-heading`}
      className="rounded-xl border border-input bg-card px-4 py-3.5"
    >
      <h2 id={`${addressId}-heading`} className="mb-1 text-[14px] font-semibold text-foreground">
        {t("randomTables.import.title")}
      </h2>
      <p className="mb-3 max-w-[62ch] text-[12.5px] leading-[1.6] text-body-secondary">
        {t("randomTables.import.lead")}
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (address.trim() === "" || run.isPending) return;
          run.mutate(() => readAddress(address));
        }}
      >
        <label htmlFor={addressId} className="sr-only">
          {t("randomTables.import.address")}
        </label>
        <input
          id={addressId}
          type="url"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={t("randomTables.import.address")}
          autoComplete="off"
          data-testid="random-tables-address"
          className="min-w-0 flex-[1_1_16rem] rounded-md border border-input bg-panel-deep px-3 py-2 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:text-[16px]"
        />
        <Button type="submit" variant="secondary" disabled={run.isPending || address.trim() === ""}>
          {t("randomTables.import.load")}
        </Button>
        <span className="text-[12.5px] text-muted-foreground">{t("randomTables.import.or")}</span>
        <Button
          type="button"
          variant="outline"
          disabled={run.isPending}
          onClick={() => fileInput.current?.click()}
        >
          {t("randomTables.import.pick")}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="random-tables-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file === undefined) return;
            run.mutate(async () => parseFile(await file.text()));
          }}
        />
      </form>
      <p
        aria-live="polite"
        data-testid="random-tables-import-outcome"
        className={cn(
          "mt-2 min-h-[1.5em] text-[12.5px]",
          run.isError
            ? "text-destructive"
            : run.isSuccess
              ? "text-success-text"
              : "text-muted-foreground",
        )}
      >
        {outcome()}
      </p>
    </section>
  );
}
