import type { Store } from "../domain/types.js";

/** Map 1..10 to a keycap emoji for numbered menus (Baileys can't render buttons). */
const KEYCAPS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
export function keycap(n: number): string {
  return KEYCAPS[n] ?? `${n}.`;
}

/** Render a numbered option list with a heading and footer hint. */
export function numberedList(heading: string, options: string[]): string {
  const lines = options.map((opt, i) => `${keycap(i + 1)} ${opt}`).join("\n");
  return `${heading}\n\n${lines}\n\nResponde con el número de la opción.`;
}

export const MAIN_MENU_OPTIONS = [
  "Ver catálogo",
  "Consultar talla / disponibilidad",
  "Hacer pedido",
  "Envíos y pagos",
  "Hablar con alguien",
];

export function mainMenu(store: Store): string {
  return numberedList(
    `¡Hola! 👋 Bienvenid@ a ${store.store_name}.\n¿En qué te puedo ayudar?`,
    MAIN_MENU_OPTIONS,
  );
}

export function categoryMenu(store: Store): string {
  return numberedList("¿Qué te interesa? 🛍️", store.categories);
}

export function sizeGuide(store: Store): string {
  const rows = store.size_guide
    .map((s) => `${s.size} → busto ${s.busto}cm, cintura ${s.cintura}cm`)
    .join("\n");
  return `📏 Guía de tallas:\n${rows}\n\n¿Necesitas ayuda para elegir? Escribe *hablar con alguien*.`;
}

export function shippingAndPayments(store: Store): string {
  const pays = [
    store.payments.pago_movil && "Pago Móvil",
    store.payments.zelle && "Zelle",
    store.payments.binance && "Binance (USDT)",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    `🚚 *Envíos:* ${store.delivery_info}\n` +
    `💰 *Pagos:* ${pays}\n` +
    `↩️ *Cambios:* ${store.returns_policy}\n\n` +
    `Escribe *menu* para volver.`
  );
}
