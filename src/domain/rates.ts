import type { RateSource, Store } from "./types.js";

/** Which currency each source quotes. A euro rate must not be labelled "por $1". */
export const RATE_CURRENCY: Record<RateSource, "$" | "€"> = {
  usd_oficial: "$",
  usd_paralelo: "$",
  eur_oficial: "€",
  custom: "$",
};

/** The source a store quotes when it has never chosen one. */
export const DEFAULT_RATE_SOURCE: RateSource = "usd_oficial";

/** "Bs. por $1" / "Bs. por €1" — the unit follows the chosen source. */
export function rateUnit(source: RateSource = DEFAULT_RATE_SOURCE): string {
  return `Bs. por ${RATE_CURRENCY[source] ?? "$"}1`;
}

/** Whether this source is fetched, or typed by the owner and never overwritten. */
export function isFetchedSource(source: RateSource | undefined): boolean {
  return source !== undefined && source !== "custom";
}

/** What the bot calls the rate it is quoting. */
export function rateName(store: Pick<Store, "rate_source" | "rate_label">): string {
  const source = store.rate_source ?? DEFAULT_RATE_SOURCE;
  if (source === "custom") return store.rate_label?.trim() || "Tasa de la tienda";
  return {
    usd_oficial: "Dólar oficial",
    usd_paralelo: "Dólar paralelo",
    eur_oficial: "Euro oficial",
  }[source];
}
