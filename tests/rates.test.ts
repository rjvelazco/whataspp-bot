import { describe, expect, it, vi } from "vitest";
import { RATE_ENDPOINTS, RateService, pickRate } from "../src/services/rates.js";
import { rateName, rateUnit } from "../src/domain/rates.js";
import type { Store } from "../src/domain/types.js";

/** The shape ve.dolarapi.com actually returns, captured while planning this. */
const DOLARES = [
  {
    moneda: "USD",
    fuente: "oficial",
    promedio: 779.9522,
    compra: null,
    venta: null,
    fechaActualizacion: "2026-08-21T00:00:00-04:00",
  },
  {
    moneda: "USD",
    fuente: "paralelo",
    promedio: 910.019831,
    compra: null,
    venta: null,
    fechaActualizacion: "2026-08-22T21:01:02.032Z",
  },
];
const EUROS = [
  {
    moneda: "EUR",
    fuente: "oficial",
    promedio: 911.21815526,
    fechaActualizacion: "2026-08-21T00:00:00-04:00",
  },
  {
    moneda: "EUR",
    fuente: "paralelo",
    promedio: 1065.975201,
    fechaActualizacion: "2026-08-22T21:01:02.032Z",
  },
];

const store = (over: Partial<Store> = {}): Store => ({
  store_id: "novamoda",
  store_name: "Nova Moda",
  owner_name: "Ana",
  owner_whatsapp: "58414",
  hours: "",
  delivery_info: "",
  returns_policy: "",
  payments: {},
  size_guide: [],
  categories: [],
  ...over,
});

describe("pickRate", () => {
  it("reads promedio, because compra and venta come back null", () => {
    expect(pickRate(DOLARES, "oficial")).toEqual({
      rate: 779.9522,
      updatedAt: "2026-08-21T00:00:00-04:00",
    });
    expect(pickRate(DOLARES, "paralelo")?.rate).toBe(910.019831);
    expect(pickRate(EUROS, "oficial")?.rate).toBe(911.21815526);
  });

  it("returns null rather than a wrong number", () => {
    expect(pickRate(DOLARES, "no-existe")).toBeNull();
    expect(pickRate({ dolar: 800 }, "oficial")).toBeNull();
    expect(pickRate(null, "oficial")).toBeNull();
    expect(pickRate([{ fuente: "oficial", promedio: "n/a" }], "oficial")).toBeNull();
    // A zero would be quoted to customers as the rate of the day.
    expect(pickRate([{ fuente: "oficial", promedio: 0 }], "oficial")).toBeNull();
    expect(pickRate([{ fuente: "oficial" }], "oficial")).toBeNull();
  });
});

describe("source mapping", () => {
  it("sends each source to the right list and entry", () => {
    expect(RATE_ENDPOINTS.usd_oficial).toEqual({
      url: "https://ve.dolarapi.com/v1/dolares/",
      fuente: "oficial",
    });
    expect(RATE_ENDPOINTS.usd_paralelo.fuente).toBe("paralelo");
    expect(RATE_ENDPOINTS.eur_oficial.url).toContain("/euros/");
  });

  it("labels the unit after the currency, not always dollars", () => {
    expect(rateUnit("usd_oficial")).toBe("Bs. por $1");
    expect(rateUnit("eur_oficial")).toBe("Bs. por €1");
    expect(rateName(store({ rate_source: "usd_paralelo" }))).toBe("Dólar paralelo");
    expect(rateName(store({ rate_source: "custom", rate_label: "Tasa de la tienda" }))).toBe(
      "Tasa de la tienda",
    );
    expect(rateName(store({ rate_source: "custom" }))).toBe("Tasa de la tienda");
  });
});

describe("RateService.refresh", () => {
  function harness(initial: Store, json: (url: string) => Promise<unknown>) {
    let current = initial;
    const service = new RateService({
      getStore: () => current,
      saveStore: (s) => {
        current = s;
      },
      fetchJson: json,
      now: () => new Date(2026, 7, 24, 9, 0),
    });
    return { service, read: () => current };
  }

  it("writes the fetched rate and the source's own timestamp", async () => {
    const h = harness(store({ rate_source: "usd_oficial" }), async () => DOLARES);
    expect(await h.service.refresh()).toBe("updated");
    expect(h.read().usd_rate).toBe(779.9522);
    expect(h.read().usd_rate_updated_at).toBe("2026-08-21T00:00:00-04:00");
  });

  it("follows the chosen source", async () => {
    const urls: string[] = [];
    const h = harness(store({ rate_source: "eur_oficial" }), async (url) => {
      urls.push(url);
      return EUROS;
    });
    await h.service.refresh();
    expect(urls).toEqual(["https://ve.dolarapi.com/v1/euros/"]);
    expect(h.read().usd_rate).toBe(911.21815526);
  });

  it("never touches a rate the owner typed", async () => {
    const fetchJson = vi.fn();
    const h = harness(store({ rate_source: "custom", usd_rate: 1000 }), fetchJson);
    expect(await h.service.refresh()).toBe("manual_source");
    // Not even a request: a custom rate is the owner's number, full stop.
    expect(fetchJson).not.toHaveBeenCalled();
    expect(h.read().usd_rate).toBe(1000);
  });

  it("keeps the last good rate when the fetch fails, and records that it did", async () => {
    const h = harness(
      store({
        rate_source: "usd_oficial",
        usd_rate: 800,
        usd_rate_updated_at: "2026-08-20T00:00:00Z",
      }),
      async () => {
        throw new Error("ENOTFOUND");
      },
    );
    expect(await h.service.refresh()).toBe("failed");
    // A stale rate the panel can flag beats no rate, and beats a zero the bot would quote.
    expect(h.read().usd_rate).toBe(800);
    expect(h.read().usd_rate_updated_at).toBe("2026-08-20T00:00:00Z");
    expect(h.read().rate_failed_at).toBe(new Date(2026, 7, 24, 9, 0).toISOString());
  });

  it("treats a response missing the entry as a failure, not as a zero", async () => {
    const h = harness(store({ rate_source: "usd_paralelo", usd_rate: 900 }), async () => []);
    expect(await h.service.refresh()).toBe("failed");
    expect(h.read().usd_rate).toBe(900);
  });

  it("clears the failure marker once a refresh works again", async () => {
    const h = harness(
      store({ rate_source: "usd_oficial", rate_failed_at: "2026-08-23T00:00:00Z" }),
      async () => DOLARES,
    );
    await h.service.refresh();
    expect(h.read().rate_failed_at).toBeUndefined();
  });

  it("defaults to the official dollar when no source was ever chosen", async () => {
    const urls: string[] = [];
    const h = harness(store({}), async (url) => {
      urls.push(url);
      return DOLARES;
    });
    await h.service.refresh();
    expect(urls).toEqual(["https://ve.dolarapi.com/v1/dolares/"]);
    expect(h.read().usd_rate).toBe(779.9522);
  });
});
