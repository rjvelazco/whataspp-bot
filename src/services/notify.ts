import type { Order, Store } from "../domain/types.js";

/** Owner message for a new paid order (spec §2.6). */
export function ownerOrderMessage(order: Order, store: Store): string {
  const lines = order.items
    .map((it) => `${it.code} — Talla ${it.size} — ${it.color} — x${it.qty}`)
    .join("\n");
  return (
    `🛍️ *NUEVO PEDIDO #${order.order_id}* (${store.store_name})\n` +
    `Cliente: ${order.customer_name}\n` +
    `${lines}\n` +
    `Total: $${order.subtotal.toFixed(2)} + envío\n` +
    `Zona: ${order.delivery_address}\n` +
    `Pago: comprobante adjunto 📎\n` +
    `Responde "OK ${order.order_id}" para confirmar.`
  );
}

/** Owner message when a customer asks to talk to a human (spec §2.8). */
export function ownerHandoffMessage(customerWa: string, store: Store): string {
  const number = customerWa.replace(/@.*$/, "");
  return `🙋 ${store.store_name}: el cliente +${number} pidió hablar con una persona. El bot se pausó para ese chat.`;
}
