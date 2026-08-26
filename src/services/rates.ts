import { logger } from "../logger.js";
import { DEFAULT_RATE_SOURCE, isFetchedSource } from "../domain/rates.js";
import type { RateRefreshOutcome as RefreshOutcome, RateSource, Store } from "../domain/types.js";

/**
 * Keeping the store's exchange rate current from ve.dolarapi.com.
 *
 * Chosen over scraping the BCV page: it serves clean JSON, needs no dependency (Node's
 * global fetch is enough), and it also covers the parallel rate — so three of the four
 * sources update themselves, not two.
 */

/** Which list endpoint carries each source, and which entry in it to read. */
export const RATE_ENDPOINTS: Record<
  Exclude<RateSource, "custom">,
  { url: string; fuente: string }
> = {
  usd_oficial: { url: "https://ve.dolarapi.com/v1/dolares/", fuente: "oficial" },
  usd_paralelo: { url: "https://ve.dolarapi.com/v1/dolares/", fuente: "paralelo" },
  eur_oficial: { url: "https://ve.dolarapi.com/v1/euros/", fuente: "oficial" },
};

/** How often to refresh. The rates themselves move at most once a day. */
const REFRESH_MS = 6 * 60 * 60 * 1000;

export interface FetchedRate {
  rate: number;
  /** When the source says it last changed, not when we fetched it. */
  updatedAt: string | null;
}

/**
 * Pull one source's rate out of a dolarapi list response.
 *
 * Pure, so the parsing is tested against fixtures rather than the network. `compra` and
 * `venta` come back null on this API, so `promedio` is the field that carries the value.
 */
export function pickRate(payload: unknown, fuente: string): FetchedRate | null {
  if (!Array.isArray(payload)) return null;
  const entry = payload.find(
    (e): e is Record<string, unknown> =>
      !!e && typeof e === "object" && (e as Record<string, unknown>)["fuente"] === fuente,
  );
  if (!entry) return null;

  const rate = Number(entry["promedio"]);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const updated = entry["fechaActualizacion"];
  return { rate, updatedAt: typeof updated === "string" ? updated : null };
}

export interface RateServiceDeps {
  getStore: () => Store | undefined;
  saveStore: (store: Store) => void;
  /** Injected so tests never touch the network. */
  fetchJson?: (url: string) => Promise<unknown>;
  now?: () => Date;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

// Declared in the domain model so the admin panel can share it verbatim.
export type { RateRefreshOutcome as RefreshOutcome } from "../domain/types.js";

export class RateService {
  private timer?: ReturnType<typeof setInterval>;
  private readonly fetchJson: (url: string) => Promise<unknown>;
  /** The refresh currently running, so concurrent callers share one outbound request. */
  private inFlight?: Promise<RefreshOutcome>;

  constructor(private readonly deps: RateServiceDeps) {
    this.fetchJson = deps.fetchJson ?? defaultFetchJson;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  start(): void {
    if (this.timer) return;
    // Every call site catches: refresh() guards the fetch, but a throw from getStore or
    // saveStore would reject with no handler, and Node exits on an unhandled rejection —
    // taking the WhatsApp connection with it.
    const tick = () => {
      this.refresh().catch((err) => logger.error({ err }, "rate refresh crashed"));
    };
    this.timer = setInterval(tick, REFRESH_MS);
    tick();
    logger.info("rate service started");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Fetch and store the current rate. Safe to call by hand from the admin panel.
   *
   * Concurrent callers share one request: the button is reachable by anyone with the
   * admin token, and without this a held key fans out unbounded fetches whose writes
   * interleave with the six-hourly timer.
   */
  refresh(): Promise<RefreshOutcome> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async run(): Promise<RefreshOutcome> {
    const store = this.deps.getStore();
    if (!store) return "no_store";

    const source = store.rate_source ?? DEFAULT_RATE_SOURCE;
    // A rate the owner typed is theirs. Nothing here may overwrite it.
    if (!isFetchedSource(source)) return "manual_source";

    const endpoint = RATE_ENDPOINTS[source as Exclude<RateSource, "custom">];
    try {
      const payload = await this.fetchJson(endpoint.url);
      const found = pickRate(payload, endpoint.fuente);
      if (!found) throw new Error(`no "${endpoint.fuente}" entry in the response`);

      // Keep the last good value on failure — a stale rate the panel can flag beats no
      // rate at all, and beats a zero the bot would happily quote.
      const current = this.deps.getStore();
      if (!current) return "no_store";
      // Re-checked after the await, not just before it. The fetch has a ten-second
      // timeout, which is ample for the owner to switch to "Personalizada" and type
      // their own number — and that number is theirs, so we must not land on top of it.
      if (!isFetchedSource(current.rate_source ?? DEFAULT_RATE_SOURCE)) return "manual_source";
      this.deps.saveStore({
        ...current,
        usd_rate: found.rate,
        usd_rate_updated_at: found.updatedAt ?? this.now().toISOString(),
        rate_failed_at: undefined,
      });
      logger.info({ source, rate: found.rate }, "exchange rate refreshed");
      return found.rate === store.usd_rate ? "unchanged" : "updated";
    } catch (err) {
      logger.warn({ err, source }, "could not refresh the exchange rate");
      const current = this.deps.getStore();
      // Same re-check: flagging a hand-typed rate as stale would be a lie.
      if (current && isFetchedSource(current.rate_source ?? DEFAULT_RATE_SOURCE)) {
        this.deps.saveStore({ ...current, rate_failed_at: this.now().toISOString() });
      }
      return "failed";
    }
  }
}
