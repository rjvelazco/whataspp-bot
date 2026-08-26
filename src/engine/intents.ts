import type { StoreKeywords } from "../domain/types.js";

/** Turn raw customer text into a normalized intent the handlers can switch on. */

export type Intent =
  | { type: "greeting" }
  | { type: "menu" }
  | { type: "talk_human" }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "size_guide" }
  | { type: "show_rate" }
  | { type: "show_address" }
  | { type: "show_shipping" }
  | { type: "show_payment" }
  | { type: "show_offers" }
  | { type: "hours" }
  | { type: "order_code"; code: string }
  | { type: "choice"; index: number }
  | { type: "text"; value: string };

/** Lowercase, strip accents, collapse whitespace. */
export function normalize(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

const GREETINGS = [
  "hola",
  "buenas",
  "buenos dias",
  "buenas tardes",
  "buenas noches",
  "hi",
  "hello",
  "holi",
];
const MENU_WORDS = ["menu", "inicio", "empezar", "volver", "atras", "regresar", "menu principal"];
const HUMAN_WORDS = [
  "hablar con alguien",
  "hablar con una persona",
  "humano",
  "asesor",
  "una persona",
  "agente",
  "ayuda humana",
];
const CONFIRM_WORDS = ["confirmar", "confirmo", "si", "sí", "ok", "dale", "listo", "de acuerdo"];
const CANCEL_WORDS = ["cancelar", "cancela", "anular"];
const SIZE_GUIDE_WORDS = [
  "medidas",
  "ver medidas",
  "guia de tallas",
  "guia tallas",
  "tabla de tallas",
];

/**
 * The informational keywords a store starts with.
 *
 * Normalized already (no accents, lowercase), and matched by substring so "cual es la
 * tasa" and "tasa" both hit. Order matters: the first topic that matches wins, which is
 * why shipping is checked before payment — "envíos y pagos" should answer about envíos.
 *
 * A store can edit these from Tienda; this is only the seed.
 */
export const DEFAULT_KEYWORDS: StoreKeywords = {
  rate: ["tasa", "dolar", "precio del dolar", "cambio del dia"],
  address: ["direccion", "ubicacion", "donde estan", "donde queda", "como llego", "como llegar"],
  shipping: ["envio", "envios", "delivery", "despacho", "hacen envios"],
  payment: ["pago", "pagos", "metodos de pago", "formas de pago", "como pagar", "como pago"],
  offers: ["ofertas", "oferta", "promociones", "promocion", "promo", "descuentos", "rebajas"],
  hours: ["horario", "horarios", "hora de atencion", "horas de atencion", "a que hora abren"],
};

/** The topic order the matcher walks, and the intent each one produces. */
const KEYWORD_INTENTS = [
  ["rate", "show_rate"],
  ["address", "show_address"],
  ["shipping", "show_shipping"],
  ["payment", "show_payment"],
  ["offers", "show_offers"],
  ["hours", "hours"],
] as const;

/**
 * @param keywords the store's own informational keywords; the seeded defaults when a
 * store has never edited them.
 */
export function parseIntent(rawText: string, keywords: StoreKeywords = DEFAULT_KEYWORDS): Intent {
  const text = normalize(rawText);

  if (HUMAN_WORDS.some((w) => text.includes(w))) return { type: "talk_human" };
  if (GREETINGS.includes(text)) return { type: "greeting" };
  if (MENU_WORDS.includes(text)) return { type: "menu" };
  if (CANCEL_WORDS.includes(text)) return { type: "cancel" };
  if (SIZE_GUIDE_WORDS.some((w) => text.includes(w))) return { type: "size_guide" };

  const orderMatch = text.match(/^pedir\s+([a-z0-9]+)$/);
  if (orderMatch) return { type: "order_code", code: orderMatch[1].toUpperCase() };

  // Informational keywords, in topic order: shipping before payment, so "envíos y pagos"
  // resolves to shipping. An owner's own words are normalized here too, so a chip typed
  // as "Envíos" still matches.
  for (const [topic, type] of KEYWORD_INTENTS) {
    const words = keywords[topic] ?? [];
    if (words.some((w) => w && text.includes(normalize(w)))) return { type } as Intent;
  }

  if (CONFIRM_WORDS.includes(text)) return { type: "confirm" };

  if (/^\d+$/.test(text)) return { type: "choice", index: Number(text) };

  return { type: "text", value: rawText.trim() };
}
