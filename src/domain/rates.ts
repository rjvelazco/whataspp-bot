import type { RateSource, RateSourceOption, Store } from "./types.js";

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

/**
 * The rate as the bot states it: value, unit, and when it last changed.
 *
 * One builder, because the same sentence is needed by the `tasa` reply and by a menu
 * message containing {tasa}. Two copies is how this repo's existing duplications began.
 */
export function rateLine(
  store: Pick<Store, "usd_rate" | "usd_rate_updated_at" | "rate_source" | "rate_label">,
): string | null {
  if (store.usd_rate === undefined || store.usd_rate === null) return null;
  const currency = RATE_CURRENCY[store.rate_source ?? DEFAULT_RATE_SOURCE] ?? "$";
  const when = store.usd_rate_updated_at
    ? ` (actualizada ${store.usd_rate_updated_at.slice(0, 10)})`
    : "";
  return `Bs. ${store.usd_rate} por ${currency}1${when}`;
}

/** The dropdown's own copy, served to the panel so the labels live in one place. */
export const RATE_SOURCE_OPTIONS: RateSourceOption[] = [
  {
    value: "usd_oficial",
    label: "Dólar oficial",
    unit: rateUnit("usd_oficial"),
    note: "Se actualiza sola varias veces al día.",
  },
  {
    value: "usd_paralelo",
    label: "Dólar paralelo",
    unit: rateUnit("usd_paralelo"),
    note: "Se actualiza sola varias veces al día.",
  },
  {
    value: "eur_oficial",
    label: "Euro oficial",
    unit: rateUnit("eur_oficial"),
    note: "Se actualiza sola varias veces al día.",
  },
  {
    value: "custom",
    label: "Personalizada",
    unit: rateUnit("custom"),
    note: "La escribes tú. El bot nunca la cambia.",
  },
];
