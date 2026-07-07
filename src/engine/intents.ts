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
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const GREETINGS = ["hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "hi", "hello", "holi"];
const MENU_WORDS = ["menu", "inicio", "empezar", "volver", "atras", "regresar", "menu principal"];
const HUMAN_WORDS = ["hablar con alguien", "hablar con una persona", "humano", "asesor", "una persona", "agente", "ayuda humana"];
const CONFIRM_WORDS = ["confirmar", "confirmo", "si", "sí", "ok", "dale", "listo", "de acuerdo"];
const CANCEL_WORDS = ["cancelar", "cancela", "anular"];
const SIZE_GUIDE_WORDS = ["medidas", "ver medidas", "guia de tallas", "guia tallas", "tabla de tallas"];

// Informational keywords (normalized, so accents/case already stripped). Matched by
// substring so "cual es la tasa" and "tasa" both hit. Order matters: the first list
// that matches wins (see parseIntent).
const RATE_WORDS = ["tasa", "dolar", "precio del dolar", "cambio del dia"];
const ADDRESS_WORDS = ["direccion", "ubicacion", "donde estan", "donde queda", "como llego", "como llegar"];
const SHIPPING_WORDS = ["envio", "envios", "delivery", "despacho", "hacen envios"];
const PAYMENT_WORDS = ["pago", "pagos", "metodos de pago", "formas de pago", "como pagar", "como pago"];
const OFFERS_WORDS = ["ofertas", "oferta", "promociones", "promocion", "promo", "descuentos", "rebajas"];
const HOURS_WORDS = ["horario", "horarios", "hora de atencion", "horas de atencion", "a que hora abren"];

export function parseIntent(rawText: string): Intent {
  const text = normalize(rawText);

  if (HUMAN_WORDS.some((w) => text.includes(w))) return { type: "talk_human" };
  if (GREETINGS.includes(text)) return { type: "greeting" };
  if (MENU_WORDS.includes(text)) return { type: "menu" };
  if (CANCEL_WORDS.includes(text)) return { type: "cancel" };
  if (SIZE_GUIDE_WORDS.some((w) => text.includes(w))) return { type: "size_guide" };

  const orderMatch = text.match(/^pedir\s+([a-z0-9]+)$/);
  if (orderMatch) return { type: "order_code", code: orderMatch[1].toUpperCase() };

  // Informational keywords. Shipping before payment so "envíos y pagos" resolves to shipping.
  if (RATE_WORDS.some((w) => text.includes(w))) return { type: "show_rate" };
  if (ADDRESS_WORDS.some((w) => text.includes(w))) return { type: "show_address" };
  if (SHIPPING_WORDS.some((w) => text.includes(w))) return { type: "show_shipping" };
  if (PAYMENT_WORDS.some((w) => text.includes(w))) return { type: "show_payment" };
  if (OFFERS_WORDS.some((w) => text.includes(w))) return { type: "show_offers" };
  if (HOURS_WORDS.some((w) => text.includes(w))) return { type: "hours" };

  if (CONFIRM_WORDS.includes(text)) return { type: "confirm" };

  if (/^\d+$/.test(text)) return { type: "choice", index: Number(text) };

  return { type: "text", value: rawText.trim() };
}
