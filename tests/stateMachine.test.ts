import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reduce, type EngineResult } from "../src/engine/stateMachine.js";
import type { CatalogItem, Conversation, Store } from "../src/domain/types.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
const store = JSON.parse(readFileSync(join(dataDir, "novamoda.store.json"), "utf8")) as Store;
const catalog = JSON.parse(readFileSync(join(dataDir, "novamoda.catalog.json"), "utf8")) as CatalogItem[];
const NOW = new Date("2026-06-29T12:00:00Z");

function freshConv(): Conversation {
  return {
    customer_wa: "c@x",
    store_id: "novamoda",
    state: "idle",
    draft_order: {},
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
    result = reduce({ conversation: conv, store, catalog, message, now: NOW, handoffPauseHours: 12 });
    conv = result.conversation;
  }
  return result;
}

const body = (r: EngineResult) => r.replies.map((x) => (x.kind === "text" ? x.body : "[img]")).join("\n");

describe("greeting & menu", () => {
  it("shows the main menu on a greeting", () => {
    const r = run(["hola"]);
    expect(r.conversation.state).toBe("idle");
    expect(body(r)).toContain("Bienvenid@ a Nova Moda");
    expect(body(r)).toContain("Ver catálogo");
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

  it("cancels the order on 'cancelar'", () => {
    const r = run(["PEDIR VESTBOHEMIO", "M", "cancelar"]);
    expect(r.conversation.state).toBe("idle");
    expect(r.effects).toHaveLength(0);
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
    expect(resumed.conversation.state).toBe("idle");
    expect(resumed.conversation.bot_paused_until).toBeNull();
  });
});
