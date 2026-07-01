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

/** Message to the customer when the owner verifies their payment. */
export function customerPaymentConfirmedMessage(order: Order, store: Store): string {
  return (
    `✅ ¡Pago verificado! Tu pedido *#${order.order_id}* está confirmado.\n` +
    `${store.store_name} lo prepara para envío. ¡Gracias por tu compra! 🎉`
  );
}

/** Message to the customer when their order ships. */
export function customerShippedMessage(order: Order, store: Store): string {
  return (
    `🚚 ¡Tu pedido *#${order.order_id}* va en camino!\n` +
    `Entrega: ${order.delivery_address}\n` +
    `Gracias por comprar en ${store.store_name}. 💛`
  );
}

/** Message to the customer when their order is marked delivered. */
export function customerDeliveredMessage(order: Order, store: Store): string {
  return (
    `🎉 Tu pedido *#${order.order_id}* fue entregado.\n` +
    `¡Esperamos que lo disfrutes! Gracias por elegir ${store.store_name}. 🙌`
  );
}

/** Owner-initiated check-in when a customer hasn't paid yet. */
export function customerCheckInMessage(order: Order, store: Store): string {
  return (
    `Hola 👋 ¿Todo bien con tu pedido *#${order.order_id}* de ${store.store_name}?\n` +
    `¿Necesitas ayuda con algo o prefieres cancelarlo?`
  );
}

/** Message to the customer when an order is cancelled (by owner or by the customer). */
export function customerOrderCancelledMessage(order: Order, store: Store): string {
  return (
    `Tu pedido *#${order.order_id}* de ${store.store_name} fue cancelado.\n` +
    `Si fue un error o quieres reordenar, escríbenos *menu*. 🙏`
  );
}

/** Owner message when a customer asks to talk to a human (spec §2.8). */
export function ownerHandoffMessage(customerWa: string, store: Store): string {
  const number = customerWa.replace(/@.*$/, "");
  return `🙋 ${store.store_name}: el cliente +${number} pidió hablar con una persona. El bot se pausó para ese chat.`;
}
