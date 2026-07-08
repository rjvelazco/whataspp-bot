import { describe, expect, it } from "vitest";
import type { ConvState, FlowMenu } from "../src/domain/types.js";
import { parseIntent } from "../src/engine/intents.js";
import { resolveIncoming } from "../src/engine/routing.js";
import { validateFlow } from "../src/engine/validateFlow.js";

const menus: FlowMenu[] = [
  {
    key: "menu_principal",
    name: "Principal",
    trigger: "hola, menu, inicio",
    message: "Hola",
    options: [{ label: "Catálogo", action: "go_menu", target: "menu_catalogo" }],
  },
  {
    key: "menu_catalogo",
    name: "Catálogo",
    trigger: "catalogo",
    message: "🛍️",
    options: [{ label: "Vestidos", action: "show_category", value: "Vestidos" }],
  },
];

const route = (msg: string, state: ConvState) => resolveIncoming(parseIntent(msg), { state }, menus);

describe("resolveIncoming precedence", () => {
  it("routes global commands from any state (level 2)", () => {
    expect(route("hola", "idle").kind).toBe("global");
    expect(route("cancelar", "ordering_size").kind).toBe("global"); // even mid-order
    expect(route("hablar con alguien", "browsing").kind).toBe("global");
  });

  it("routes informational keywords only while navigating (level 3)", () => {
    expect(route("tasa", "idle").kind).toBe("info");
    expect(route("¿cuál es la dirección?", "in_menu").kind).toBe("info");
    // Mid-order the same keyword is NOT info — it falls through to order input.
    expect(route("tasa", "ordering_size").kind).toBe("dispatch");
  });

  it("jumps to a menu whose trigger matches, in nav states (level 4)", () => {
    const r = route("catalogo", "idle");
    expect(r.kind).toBe("trigger");
    if (r.kind === "trigger") expect(r.menu.key).toBe("menu_catalogo");
    // Not while mid-order.
    expect(route("catalogo", "ordering_color").kind).toBe("dispatch");
  });

  it("lets a global keyword win over a menu trigger of the same word", () => {
    // menu_principal has trigger "menu", but "menu" parses as the global menu intent.
    expect(route("menu", "idle").kind).toBe("global");
  });

  it("falls through to dispatch for numbered replies and free text (levels 4-5)", () => {
    expect(route("1", "in_menu").kind).toBe("dispatch"); // numbered choice
    expect(route("tienen algo bonito?", "idle").kind).toBe("dispatch"); // availability/fallback
    expect(route("M", "ordering_size").kind).toBe("dispatch"); // order data entry
  });
});

describe("validateFlow", () => {
  const errs = (m: FlowMenu[]) => validateFlow(m).filter((i) => i.severity === "error");
  const warns = (m: FlowMenu[]) => validateFlow(m).filter((i) => i.severity === "warning");

  it("passes a clean flow", () => {
    expect(errs(menus)).toHaveLength(0);
    expect(warns(menus)).toHaveLength(0);
  });

  it("errors on a dangling go_menu target; only warns on an unwired one", () => {
    const bad: FlowMenu[] = [
      {
        key: "m",
        name: "M",
        trigger: "hola",
        message: "",
        options: [
          { label: "A", action: "go_menu", target: "nope" }, // dangling → error
          { label: "B", action: "go_menu" }, // unwired → warning
        ],
      },
    ];
    expect(errs(bad).some((i) => i.message.includes("inexistente"))).toBe(true);
    expect(warns(bad).some((i) => i.message.includes("no está conectada"))).toBe(true);
  });

  it("flags duplicate and empty keys", () => {
    const dup: FlowMenu[] = [
      { key: "same", name: "A", message: "", options: [] },
      { key: "same", name: "B", message: "", options: [] },
      { key: "", name: "C", message: "", options: [] },
    ];
    const e = errs(dup);
    expect(e.some((i) => i.message.includes("duplicado"))).toBe(true);
    expect(e.some((i) => i.message.includes("sin identificador"))).toBe(true);
  });

  it("warns on a show_category with no category", () => {
    const bad: FlowMenu[] = [
      { key: "m", name: "M", trigger: "hola", message: "", options: [{ label: "X", action: "show_category" }] },
    ];
    expect(warns(bad).some((i) => i.message.includes("no indica la categoría"))).toBe(true);
  });

  it("warns about an unreachable menu", () => {
    const flow: FlowMenu[] = [
      { key: "home", name: "Home", trigger: "hola", message: "", options: [] }, // links to nothing
      { key: "island", name: "Isla", message: "", options: [] }, // unreachable
    ];
    expect(warns(flow).some((i) => i.message.includes("no es alcanzable"))).toBe(true);
  });

  it("warns about a trigger reserved by a global keyword and duplicate triggers", () => {
    const flow: FlowMenu[] = [
      { key: "a", name: "A", trigger: "hola, oferta", message: "", options: [] },
      { key: "b", name: "B", trigger: "oferta", message: "", options: [] },
    ];
    const w = warns(flow);
    expect(w.some((i) => i.message.includes("palabra reservada"))).toBe(true); // "oferta" -> show_offers
    expect(w.some((i) => i.message.includes("repetido"))).toBe(true); // "oferta" in a and b
  });
});
