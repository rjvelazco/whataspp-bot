/** Turn raw customer text into a normalized intent the handlers can switch on. */

export type Intent =
  | { type: "greeting" }
  | { type: "menu" }
  | { type: "talk_human" }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "size_guide" }
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

export function parseIntent(rawText: string): Intent {
  const text = normalize(rawText);

  if (HUMAN_WORDS.some((w) => text.includes(w))) return { type: "talk_human" };
  if (GREETINGS.includes(text)) return { type: "greeting" };
  if (MENU_WORDS.includes(text)) return { type: "menu" };
  if (CANCEL_WORDS.includes(text)) return { type: "cancel" };
  if (SIZE_GUIDE_WORDS.some((w) => text.includes(w))) return { type: "size_guide" };

  const orderMatch = text.match(/^pedir\s+([a-z0-9]+)$/);
  if (orderMatch) return { type: "order_code", code: orderMatch[1].toUpperCase() };

  if (CONFIRM_WORDS.includes(text)) return { type: "confirm" };

  if (/^\d+$/.test(text)) return { type: "choice", index: Number(text) };

  return { type: "text", value: rawText.trim() };
}
