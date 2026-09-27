// The DM's own item lists on the price page: import a list from a JSON file,
// see which lists stand in the price list, and remove one.
//
// The file is read in the browser and sent as the import's body — nothing is
// uploaded as a file. Every write lands in the item prices and the imports,
// so both are fetched again once it is done.

import { ITEM_RARITIES } from "@grimoire/shared/item-price";
import type { ItemPriceImport } from "@grimoire/shared/item-price-import";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { deleteItemPriceImport, putItemPriceImport } from "./item-price-import-api";
import { readItemList } from "./item-price-import-read";
import { itemPriceImportsQuery, itemPricesQuery } from "./item-price-query";

/** The shape of a list, as the format help shows it. */
const FORMAT_SAMPLE = `{
  "name": "My Book",
  "items": [
    { "name": "Lantern of the Drowned Bell", "rarity": "legendary" },
    { "name": "Tincture of Tidewalking", "rarity": "rare", "consumable": true },
    { "name": "Gull-Feather Cloak", "rarity": "uncommon", "priceGp": 900 }
  ]
}`;

/** What the last action says: a sentence that went well, or one that did not. */
type Outcome = { ok: boolean; text: string };

export function ItemPriceImports() {
  const t = useT();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const query = useQuery(itemPriceImportsQuery());
  const imports = query.data ?? [];

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: itemPricesQuery().queryKey }),
      queryClient.invalidateQueries({ queryKey: itemPriceImportsQuery().queryKey }),
    ]);

  const upload = useMutation({
    mutationFn: putItemPriceImport,
    onSuccess: async (entry) => {
      await refresh();
      const key = entry.rev > 1 ? "itemPriceImports.replaced" : "itemPriceImports.imported";
      setOutcome({ ok: true, text: t(key, { name: entry.name, count: entry.itemCount }) });
    },
    onError: () => setOutcome({ ok: false, text: t("itemPriceImports.failed") }),
  });

  const remove = useMutation({
    mutationFn: (entry: ItemPriceImport) => deleteItemPriceImport(entry),
    onSuccess: async (_, entry) => {
      await refresh();
      setOutcome({ ok: true, text: t("itemPriceImports.removed", { name: entry.name }) });
    },
    onError: async () => {
      await refresh();
      setOutcome({ ok: false, text: t("itemPriceImports.removeFailed") });
    },
  });

  const pick = async (file: File | undefined) => {
    if (file === undefined) return;
    setOutcome(null);
    const read = readItemList(await file.text());
    if (read.ok) {
      upload.mutate(read.list);
      return;
    }
    const text =
      read.reason === "json"
        ? t("itemPriceImports.notJson")
        : read.reason === "name"
          ? t("itemPriceImports.badName")
          : read.item === null
            ? t("itemPriceImports.badList")
            : t("itemPriceImports.badItem", { item: read.item });
    setOutcome({ ok: false, text });
  };

  return (
    <section className="mt-10 border-t border-divider pt-6" data-testid="item-price-imports">
      <h2 className="mb-1.5 font-serif text-[18px] leading-[1.3] font-semibold text-foreground">
        {t("itemPriceImports.title")}
      </h2>
      <p className="mb-3 max-w-[62ch] text-[13px] leading-[1.6] text-body-secondary">
        {t("itemPriceImports.lead")}
      </p>
      <details className="mb-4 text-[13px] text-body-secondary">
        <summary className="cursor-pointer rounded text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {t("itemPriceImports.format")}
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md border border-input bg-panel-deep p-3 font-mono text-[12px] leading-[1.5] text-foreground">
          {FORMAT_SAMPLE}
        </pre>
        <p className="mt-2 max-w-[62ch] leading-[1.6]">
          {t("itemPriceImports.formatHelp", { rarities: ITEM_RARITIES.join(", ") })}
        </p>
      </details>

      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="item-price-import-picker"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void pick(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={upload.isPending}
        onClick={() => input.current?.click()}
        className="h-auto min-h-9 px-3 py-1.5 text-[13px]"
      >
        {upload.isPending ? t("itemPriceImports.importing") : t("itemPriceImports.import")}
      </Button>
      <p
        aria-live="polite"
        data-testid="item-price-import-outcome"
        className={cn(
          "mt-2 min-h-[1.5em] max-w-[62ch] text-[12.5px] leading-[1.5]",
          outcome?.ok === false ? "text-destructive" : "text-success-text",
        )}
      >
        {outcome?.text ?? ""}
      </p>

      {query.isSuccess && imports.length === 0 && (
        <p className="text-[13px] text-muted-foreground">{t("itemPriceImports.empty")}</p>
      )}
      {imports.length > 0 && (
        <ul className="border-t border-divider">
          {imports.map((entry) => (
            <ImportRow
              key={entry.id}
              entry={entry}
              removing={remove.isPending && remove.variables.id === entry.id}
              onRemove={() => {
                setOutcome(null);
                remove.mutate(entry);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** One list: its name, how many items it brought, the ones it left out, and its remove action. */
function ImportRow({
  entry,
  removing,
  onRemove,
}: {
  entry: ItemPriceImport;
  removing: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <li
      data-testid="item-price-import-row"
      data-id={entry.id}
      className="flex items-start gap-3 border-b border-divider px-2 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-[1.4] text-foreground">{entry.name}</p>
        <p className="text-[12px] leading-[1.5] text-muted-foreground">
          {t("itemPriceImports.count", { count: entry.itemCount })}
        </p>
        {entry.skipped.length > 0 && (
          <details className="text-[12px] leading-[1.5] text-muted-foreground">
            <summary className="cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              {t("itemPriceImports.skipped", { count: entry.skipped.length })}
            </summary>
            <p className="mt-1" lang="en">
              {entry.skipped.join(", ")}
            </p>
          </details>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        disabled={removing}
        aria-label={t("itemPriceImports.removeAria", { name: entry.name })}
        onClick={onRemove}
        className="h-auto min-h-9 flex-none px-2.5 py-1.5 text-[12.5px] text-body-secondary hover:text-foreground"
      >
        {t("itemPriceImports.remove")}
      </Button>
    </li>
  );
}
