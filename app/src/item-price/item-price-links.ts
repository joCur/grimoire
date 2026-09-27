// Where an item price lives in the app (decisions/resources): on the price
// page of the campaign the DM is in, among the other items — an item price
// has no page of its own. The item a link names is the one the page shows
// marked and scrolls to.

/** The price page, optionally at one item. */
export function itemPricesHref(campaign: string, item?: string): string {
  const page = `/campaigns/${campaign}/item-prices`;
  return item === undefined ? page : `${page}?item=${encodeURIComponent(item)}`;
}
