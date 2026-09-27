// "/campaigns/:campaign/item-prices" — what a magic item costs, from
// Saidoro's "Sane Magic Item Prices" and, for the items it has no price for,
// the SRD 5.2's value for the item's rarity.
//
// A REFERENCE the DM looks up at the table while the group haggles: a search
// field, the guide's five lists as a filter, name or price as the order, and
// one line per item with its price. Nothing here writes — item prices are
// reference data of the instance (decisions/reference-data), the same on the
// page of every campaign. Both sources are named on the page, with the SRD's
// license statement, and every item names the one its price comes from.
//
// `?item=<id>` is where a ⌘K hit leads: that item stands marked and scrolled
// into view.

import {
  ITEM_PRICE_LISTS,
  ITEM_PRICE_SOURCE,
  type ItemPrice,
  type ItemRarity,
} from "@grimoire/shared/item-price";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { useParams, useSearchParams } from "react-router";

import { MobileMenuRow } from "@/components/MobileMenuRow";
import { Button } from "@/components/ui/button";
import { useI18n, useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  visibleItemPrices,
  type ItemPriceListFilter,
  type ItemPriceSort,
} from "./item-price-list";
import { itemPricesQuery } from "./item-price-query";

const LIST_LABELS: Record<ItemPriceListFilter, MessageKey> = {
  all: "itemPrices.list.all",
  consumable: "itemPrices.list.consumable",
  combat: "itemPrices.list.combat",
  noncombat: "itemPrices.list.noncombat",
  summoning: "itemPrices.list.summoning",
  gamechanging: "itemPrices.list.gamechanging",
  rarity: "itemPrices.list.rarity",
};

const RARITY_LABELS: Record<ItemRarity, MessageKey> = {
  common: "itemPrices.rarity.common",
  uncommon: "itemPrices.rarity.uncommon",
  rare: "itemPrices.rarity.rare",
  "very-rare": "itemPrices.rarity.veryRare",
  legendary: "itemPrices.rarity.legendary",
};

const SOURCE_LINK =
  "rounded text-foreground underline underline-offset-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

const SORT_LABELS: Record<ItemPriceSort, MessageKey> = {
  name: "itemPrices.sort.name",
  price: "itemPrices.sort.price",
};

const NOTE = "text-[13.5px] text-muted-foreground";

export function ItemPricesRoute() {
  const { campaign = "" } = useParams();
  const [searchParams] = useSearchParams();
  const target = searchParams.get("item") ?? undefined;
  const t = useT();
  const { tNode } = useI18n();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [list, setList] = useState<ItemPriceListFilter>("all");
  const [sort, setSort] = useState<ItemPriceSort>("name");
  const query = useQuery(itemPricesQuery());
  const items = query.data ?? [];
  const shown = visibleItemPrices(items, search, list, sort);

  // The item a link names comes into view once the list is there — and again
  // when ⌘K picks another one while the page is open.
  const marked = useRef<HTMLLIElement>(null);
  const loaded = query.isSuccess;
  useEffect(() => {
    if (loaded && target !== undefined) marked.current?.scrollIntoView({ block: "center" });
  }, [loaded, target]);

  return (
    <>
      <MobileMenuRow campaign={campaign} />
      <div className="mx-auto max-w-[760px] px-5 pt-5 pb-16 md:px-7 md:pt-10">
        <h1 className="mb-1.5 font-serif text-[24px] leading-[1.25] font-semibold text-foreground">
          {t("itemPrices.title")}
        </h1>
        <p className="mb-1 max-w-[62ch] text-[13px] leading-[1.6] text-body-secondary">
          {t("itemPrices.lead")}
        </p>
        <p className="mb-5 text-[13px] leading-[1.6] text-body-secondary" data-testid="item-prices-source">
          {tNode("itemPrices.source", {
            author: ITEM_PRICE_SOURCE.saidoro.author,
            title: (
              <a
                key="saidoro"
                href={ITEM_PRICE_SOURCE.saidoro.url}
                target="_blank"
                rel="noreferrer"
                className={SOURCE_LINK}
              >
                {ITEM_PRICE_SOURCE.saidoro.title}
              </a>
            ),
            srd: (
              <a
                key="srd"
                href={ITEM_PRICE_SOURCE.srd.url}
                target="_blank"
                rel="noreferrer"
                className={SOURCE_LINK}
              >
                {ITEM_PRICE_SOURCE.srd.title}
              </a>
            ),
          })}
        </p>

        <div className="mb-3 flex items-center gap-2 rounded-md border border-input bg-panel-deep px-3 py-2">
          <Search aria-hidden size={15} className="flex-none text-muted-foreground" />
          <label htmlFor={searchId} className="sr-only">
            {t("itemPrices.search")}
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("itemPrices.search")}
            autoComplete="off"
            data-testid="item-prices-search"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground max-md:text-[16px]"
          />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <ToggleGroup
            label={t("itemPrices.list.aria")}
            testId="item-prices-lists"
            options={["all", ...ITEM_PRICE_LISTS, "rarity"] as const}
            value={list}
            onChange={setList}
            labelOf={(option) => t(LIST_LABELS[option])}
          />
          <ToggleGroup
            label={t("itemPrices.sort.aria")}
            testId="item-prices-sort"
            options={["name", "price"] as const}
            value={sort}
            onChange={setSort}
            labelOf={(option) => t(SORT_LABELS[option])}
          />
        </div>

        {query.isPending && <p className={NOTE}>{t("itemPrices.loading")}</p>}
        {query.isError && <p className={NOTE}>{t("common.serverDown")}</p>}
        {query.isSuccess && shown.length === 0 && <p className={NOTE}>{t("itemPrices.noMatch")}</p>}
        {shown.length > 0 && (
          <ul className="border-t border-divider" data-testid="item-prices-list">
            {shown.map((item) => (
              <ItemPriceRow
                key={item.id}
                item={item}
                marked={item.id === target}
                rowRef={item.id === target ? marked : undefined}
              />
            ))}
          </ul>
        )}
        {/* The statement the SRD's license asks for, in its own words. */}
        <p className="mt-8 max-w-[62ch] text-[11.5px] leading-[1.6] text-muted-foreground" lang="en">
          {ITEM_PRICE_SOURCE.srd.attribution}
        </p>
      </div>
    </>
  );
}

/** One item: its name and note, where its price comes from, and the price. */
function ItemPriceRow({
  item,
  marked,
  rowRef,
}: {
  item: ItemPrice;
  marked: boolean;
  rowRef?: Ref<HTMLLIElement>;
}) {
  const t = useT();
  return (
    <li
      ref={rowRef}
      data-testid="item-price-row"
      data-id={item.id}
      data-list={item.list}
      aria-current={marked ? "true" : undefined}
      className={cn(
        "flex items-baseline gap-3 border-b border-divider px-2 py-2.5",
        marked && "rounded-md bg-card ring-2 ring-ring",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-[1.4] text-foreground">
          {item.name}
          {item.note !== "" && (
            <span className="ml-1.5 text-[12.5px] text-muted-foreground">({item.note})</span>
          )}
        </p>
        <p className="text-[12px] leading-[1.5] text-muted-foreground">
          {item.list !== null
            ? t("itemPrices.rowSource", {
                list: t(LIST_LABELS[item.list]),
                author: ITEM_PRICE_SOURCE.saidoro.author,
              })
            : t("itemPrices.rowRarity", {
                rarity: t(RARITY_LABELS[item.rarity ?? "common"]),
                title: ITEM_PRICE_SOURCE.srd.title,
              })}
        </p>
      </div>
      <p
        className="flex-none text-right font-mono text-[13.5px] text-foreground tabular-nums"
        data-testid="item-price-value"
        data-gp={item.priceGp}
      >
        {t("itemPrices.price", { price: item.priceGp })}
      </p>
    </li>
  );
}

/** A row of toggle buttons of which exactly one is pressed. */
function ToggleGroup<T extends string>({
  label,
  testId,
  options,
  value,
  onChange,
  labelOf,
}: {
  label: string;
  testId: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelOf: (option: T) => string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className="flex flex-wrap items-center gap-px rounded-md border border-input p-px"
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <Button
            key={option}
            type="button"
            variant="ghost"
            aria-pressed={active}
            data-value={option}
            onClick={() => onChange(option)}
            className={cn(
              "h-auto rounded-[5px] px-2.5 py-[5px] text-[12px] font-normal",
              active
                ? "bg-secondary text-foreground hover:bg-secondary"
                : "text-body-secondary hover:bg-transparent hover:text-foreground",
            )}
          >
            {labelOf(option)}
          </Button>
        );
      })}
    </div>
  );
}
