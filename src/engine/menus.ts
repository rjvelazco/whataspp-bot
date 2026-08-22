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

export function sizeGuide(store: Store): string {
  const rows = store.size_guide
    .map((s) => `${s.size} → busto ${s.busto}cm, cintura ${s.cintura}cm`)
    .join("\n");
  return `📏 Guía de tallas:\n${rows}\n\n¿Necesitas ayuda para elegir? Escribe *hablar con alguien*.`;
}

/** USD→Bs rate for the `tasa` keyword (spec: manual field, edited in admin). */
export function exchangeRate(store: Store): string {
  if (store.usd_rate === undefined || store.usd_rate === null) {
    return "Por ahora no tengo la tasa del día a mano. Escribe *hablar con alguien* y te ayudamos. 🙌";
  }
  const when = store.usd_rate_updated_at ? ` (actualizada ${store.usd_rate_updated_at.slice(0, 10)})` : "";
  return `💵 *Tasa del día:* Bs. ${store.usd_rate} por $1${when}.\n\nEscribe *menu* para volver.`;
}

export function storeAddress(store: Store): string {
  if (!store.address) return "Escríbenos *hablar con alguien* y te compartimos la ubicación. 📍";
  const maps = store.maps_url ? `\n📍 Mapa: ${store.maps_url}` : "";
  return `📍 *Dónde estamos:*\n${store.address}${maps}\n\nEscribe *menu* para volver.`;
}

export function shippingInfo(store: Store): string {
  return `🚚 *Envíos:* ${store.delivery_info}\n\nEscribe *menu* para volver.`;
}

export function paymentMethods(store: Store): string {
  const p = store.payments;
  const lines = [
    p.pago_movil && `💳 Pago Móvil: ${p.pago_movil}`,
    p.zelle && `💵 Zelle: ${p.zelle}`,
    p.binance && `🪙 Binance (USDT): ${p.binance}`,
  ].filter(Boolean);
  const body = lines.length ? lines.join("\n") : "Escríbenos para coordinar el pago.";
  return `💰 *Métodos de pago:*\n${body}\n\nEscribe *menu* para volver.`;
}

export function storeHours(store: Store): string {
  return `🕒 *Horario:* ${store.hours}\n\nEscribe *menu* para volver.`;
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
