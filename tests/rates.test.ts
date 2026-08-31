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

  it("never lands on a rate the owner switched to custom mid-fetch", async () => {
    let current = store({ rate_source: "usd_oficial", usd_rate: 800 });
    const service = new RateService({
      getStore: () => current,
      saveStore: (s) => {
        current = s;
      },
      // The owner switches to their own rate while the request is in the air. Ten
      // seconds of timeout is ample room for exactly that.
      fetchJson: async () => {
        current = { ...current, rate_source: "custom", usd_rate: 1234 };
        return DOLARES;
      },
    });

    expect(await service.refresh()).toBe("manual_source");
    expect(current.usd_rate).toBe(1234);
  });

  it("does not flag a hand-typed rate as stale when a fetch fails mid-switch", async () => {
    let current = store({ rate_source: "usd_oficial", usd_rate: 800 });
    const service = new RateService({
      getStore: () => current,
      saveStore: (s) => {
        current = s;
      },
      fetchJson: async () => {
        current = { ...current, rate_source: "custom", usd_rate: 1234 };
        throw new Error("ENOTFOUND");
      },
    });

    expect(await service.refresh()).toBe("failed");
    expect(current.rate_failed_at).toBeUndefined();
  });

  it("shares one request between concurrent callers", async () => {
    let calls = 0;
    let current = store({ rate_source: "usd_oficial" });
    const service = new RateService({
      getStore: () => current,
      saveStore: (s) => {
        current = s;
      },
      fetchJson: async () => {
        calls += 1;
        return DOLARES;
      },
    });

    // The button is reachable by anyone with the admin token; a held key must not fan
    // out unbounded fetches whose writes interleave with the timer.
    await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
    expect(calls).toBe(1);

    await service.refresh();
    expect(calls).toBe(2); // and the guard clears once it settles
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

describe("RateService.quote", () => {
  function harness(json: (url: string) => Promise<unknown>, at = new Date(2026, 7, 24, 9, 0)) {
    let now = at;
    const service = new RateService({
      getStore: () => store({ rate_source: "usd_oficial" }),
      saveStore: () => undefined,
      fetchJson: json,
      now: () => now,
    });
    return { service, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
  }

  it("answers what a source quotes without saving anything", async () => {
    let saved = 0;
    const service = new RateService({
      getStore: () => store({ rate_source: "usd_oficial", usd_rate: 1 }),
      saveStore: () => {
        saved += 1;
      },
      fetchJson: async () => EUROS,
    });

    expect(await service.quote("eur_oficial")).toEqual({
      rate: 911.21815526,
      updatedAt: "2026-08-21T00:00:00-04:00",
    });
    // It is a preview for the panel; the stored rate is only written on save.
    expect(saved).toBe(0);
  });

  it("never quotes a custom rate — there is no feed to ask", async () => {
    const fetchJson = vi.fn();
    const h = harness(fetchJson);
    expect(await h.service.quote("custom")).toBeNull();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("returns null instead of throwing when the lookup fails", async () => {
    const h = harness(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await h.service.quote("usd_oficial")).toBeNull();
  });

  it("reuses a recent answer, so flicking the dropdown does not hammer the API", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls += 1;
      return DOLARES;
    });

    await h.service.quote("usd_oficial");
    await h.service.quote("usd_oficial");
    expect(calls).toBe(1);

    // ...but a stale one is refetched.
    h.advance(61_000);
    await h.service.quote("usd_oficial");
    expect(calls).toBe(2);
  });

  it("caches per source, not globally", async () => {
    const urls: string[] = [];
    const h = harness(async (url) => {
      urls.push(url);
      return url.includes("euros") ? EUROS : DOLARES;
    });

    await h.service.quote("usd_oficial");
    await h.service.quote("eur_oficial");
    // usd_paralelo lives in the same response as usd_oficial, so it is already cached.
    await h.service.quote("usd_paralelo");
    expect(urls).toEqual([
      "https://ve.dolarapi.com/v1/dolares/",
      "https://ve.dolarapi.com/v1/euros/",
    ]);
  });

  it("a hand-pressed refresh ignores the cache", async () => {
    let calls = 0;
    const service = new RateService({
      getStore: () => store({ rate_source: "usd_oficial" }),
      saveStore: () => undefined,
      fetchJson: async () => {
        calls += 1;
        return DOLARES;
      },
    });

    await service.quote("usd_oficial");
    // The owner pressed the button because they want the current number, not a recent one.
    await service.refresh();
    expect(calls).toBe(2);
  });
});
