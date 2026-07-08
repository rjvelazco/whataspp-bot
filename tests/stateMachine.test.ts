import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reduce, type EngineResult } from "../src/engine/stateMachine.js";
import type { CatalogItem, Conversation, FlowMenu, Store } from "../src/domain/types.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
const store = JSON.parse(readFileSync(join(dataDir, "novamoda.store.json"), "utf8")) as Store;
const catalog = JSON.parse(readFileSync(join(dataDir, "novamoda.catalog.json"), "utf8")) as CatalogItem[];
const menus = JSON.parse(readFileSync(join(dataDir, "novamoda.menus.json"), "utf8")) as FlowMenu[];
const NOW = new Date("2026-06-29T12:00:00Z");

function freshConv(): Conversation {
  return {
    customer_wa: "c@x",
    store_id: "novamoda",
    state: "idle",
    draft_order: {},
    menu_key: null,
    active_order_id: null,
    bot_paused_until: null,
    updated_at: "",
  };
}

/** Drive a sequence of messages, threading conversation state like the real bot. */
function run(messages: Array<string | { image: true }>, start = freshConv()): EngineResult {
  let conv = start;
  let result!: EngineResult;
  for (const m of messages) {
    const message = typeof m === "string" ? { text: m, hasImage: false } : { hasImage: true };
    result = reduce({ conversation: conv, store, catalog, menus, message, now: NOW, handoffPauseHours: 12 });
    conv = result.conversation;
  }
  return result;
}

const body = (r: EngineResult) =>
  r.replies.map((x) => (x.kind === "text" ? x.body : x.kind === "image" ? "[img]" : "[asset]")).join("\n");

describe("greeting & menu", () => {
  it("shows the configured entry menu on a greeting", () => {
    const r = run(["hola"]);
    expect(r.conversation.state).toBe("in_menu");
    expect(r.conversation.menu_key).toBe("menu_principal");
    expect(body(r)).toContain("Bienvenid@ a Nova Moda");
    expect(body(r)).toContain("Ver catálogo");
  });

  it("navigates main menu → catálogo (go_menu) → a category (show_category)", () => {
    const cat = run(["hola", "1"]); // "Ver catálogo" → go_menu menu_catalogo
    expect(cat.conversation.state).toBe("in_menu");
    expect(cat.conversation.menu_key).toBe("menu_catalogo");
    expect(body(cat)).toContain("Vestidos");

    const items = run(["hola", "1", "1"]); // then "Vestidos" → show_category
    expect(items.conversation.state).toBe("browsing");
    expect(items.replies.some((x) => x.kind === "image")).toBe(true);
  });

  it("sends a menu's attachments as asset replies", () => {
    const withAttachment: FlowMenu[] = [
      { key: "m", name: "M", trigger: "hola", message: "Hola", options: [], attachments: ["a1"] },
    ];
    const r = reduce({
      conversation: freshConv(),
      store,
      catalog,
      menus: withAttachment,
      message: { text: "hola", hasImage: false },
      now: NOW,
      handoffPauseHours: 12,
    });
    expect(r.replies.some((x) => x.kind === "asset" && x.assetId === "a1")).toBe(true);
  });

  it("show_category still resolves a legacy target (pre-migration data)", () => {
    const legacy: FlowMenu[] = [
      {
        key: "m",
        name: "M",
        trigger: "hola",
        message: "Hola",
        options: [{ label: "Vestidos", action: "show_category", target: "Vestidos" }],
      },
    ];
    const base = {
      store,
      catalog,
      menus: legacy,
      now: NOW,
      handoffPauseHours: 12,
    };
    const step1 = reduce({ ...base, conversation: freshConv(), message: { text: "hola", hasImage: false } });
    const step2 = reduce({ ...base, conversation: step1.conversation, message: { text: "1", hasImage: false } });
    expect(step2.conversation.state).toBe("browsing");
    expect(step2.replies.some((x) => x.kind === "image")).toBe(true);
  });
});

describe("availability (variant-level)", () => {
  it("reports the in-stock color for a size", () => {
    // M/negro is sold out (stock 0) but M/beige has stock 5.
    const r = run(["¿tienen el vestido bohemio en M?"]);
    expect(body(r)).toContain("disponible en talla M");
    expect(body(r)).toContain("beige");
    expect(body(r)).not.toContain("negro");
  });

  it("reports out of stock and suggests other sizes", () => {
    const r = run(["tienen el top basico en L?"]); // L/negro is stock 0
    expect(body(r)).toContain("no tenemos talla L");
    expect(body(r)).toContain("S, M");
  });
});

describe("informational keywords", () => {
  it("returns the store's USD rate (accent/case-insensitive)", () => {
    for (const q of ["tasa", "TASA", "¿cuál es el dólar?"]) {
      const r = run([q]);
      expect(body(r)).toContain("Tasa del día");
      expect(body(r)).toContain("40");
    }
  });

  it("returns the address + maps link for a location question", () => {
    const r = run(["¿dónde están?"]);
    expect(body(r)).toContain("Maracaibo");
    expect(body(r)).toContain("maps.google.com");
  });

  it("returns shipping, payment and hours from store config", () => {
    expect(body(run(["hacen envíos?"]))).toContain("Envíos:");
    expect(body(run(["métodos de pago"]))).toContain("Pago Móvil");
    expect(body(run(["horario"]))).toContain("Lun-Sab");
  });

  it("nudges to the catalog when there are no Ofertas products", () => {
    expect(body(run(["ofertas"]))).toContain("no tenemos ofertas");
  });

  it("does not hijack an in-progress order", () => {
    // Mid-order (ordering_size) a keyword-y message is order input, not the rate reply.
    const r = run(["PEDIR VESTBOHEMIO", "tasa"]);
    expect(body(r)).not.toContain("Tasa del día");
    expect(r.conversation.state).toBe("ordering_size");
  });
});

describe("order happy path", () => {
  it("collects details and emits a createOrder effect with correct subtotal", () => {
    const r = run([
      "PEDIR VESTBOHEMIO",
      "M",
      "beige",
      "2",
      "María Pérez",
      "Maracaibo, Av. 5 de Julio",
      "confirmar",
    ]);
    expect(r.conversation.state).toBe("awaiting_payment");
    const effect = r.effects.find((e) => e.type === "createOrder");
    expect(effect).toBeDefined();
    if (effect?.type === "createOrder") {
      expect(effect.order.subtotal).toBe(50); // 25.00 x2
      expect(effect.order.items[0]).toMatchObject({ code: "VESTBOHEMIO", size: "M", color: "beige", qty: 2 });
      expect(effect.order.customer_name).toBe("María Pérez");
      expect(effect.order.status).toBe("pending_payment");
    }
    expect(body(r)).toContain("Pago Móvil");
  });

  it("resets the chat on 'cancelar' while still drafting (no order yet)", () => {
    const r = run(["PEDIR VESTBOHEMIO", "M", "cancelar"]);
    expect(r.conversation.state).toBe("idle");
    expect(r.effects).toHaveLength(0); // no order created yet, nothing to cancel
  });

  it("cancels the actual order on 'cancelar' once one is in flight", () => {
    const awaiting: Conversation = {
      ...freshConv(),
      state: "awaiting_payment",
      active_order_id: "1042",
    };
    const r = run(["cancelar"], awaiting);
    expect(r.conversation.state).toBe("idle");
    expect(r.conversation.active_order_id).toBeNull();
    expect(r.effects).toEqual([{ type: "cancelOrder", orderId: "1042" }]);
  });
});

describe("payment receipt", () => {
  it("attaches the receipt and notifies the owner", () => {
    const awaiting: Conversation = { ...freshConv(), state: "awaiting_payment", active_order_id: "1001" };
    const r = run([{ image: true }], awaiting);
    expect(r.conversation.state).toBe("idle");
    expect(r.effects.map((e) => e.type)).toEqual(["saveReceipt", "notifyOwner"]);
    expect(body(r)).toContain("Recibimos tu comprobante");
  });
});

describe("human handoff", () => {
  it("pauses the bot and notifies the owner", () => {
    const r = run(["hablar con alguien"]);
    expect(r.conversation.state).toBe("paused");
    expect(r.conversation.bot_paused_until).toBe("2026-06-30T00:00:00.000Z"); // +12h
    expect(r.effects[0].type).toBe("notifyOwnerHandoff");
  });

  it("triggers handoff from main-menu option 5", () => {
    const r = run(["hola", "5"]);
    expect(r.conversation.state).toBe("paused");
    expect(r.effects[0].type).toBe("notifyOwnerHandoff");
  });

  it("stays silent while paused, resumes on 'menu'", () => {
    const paused: Conversation = { ...freshConv(), state: "paused", bot_paused_until: "2026-06-29T20:00:00.000Z" };
    expect(run(["¿sigues ahí?"], paused).replies).toHaveLength(0);
    const resumed = run(["menu"], paused);
    expect(resumed.conversation.state).toBe("in_menu");
    expect(resumed.conversation.bot_paused_until).toBeNull();
  });
});
