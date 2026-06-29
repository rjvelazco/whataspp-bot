import type { Store } from "../domain/types.js";

/** Payment instructions from store config (spec §2.5). */
export function paymentInstructions(store: Store): string {
  const p = store.payments;
  const lines = [
    p.pago_movil && `💳 Pago Móvil: ${p.pago_movil}`,
    p.zelle && `💵 Zelle: ${p.zelle}`,
    p.binance && `🪙 Binance (USDT): ${p.binance}`,
  ].filter(Boolean);
  return (
    `Para completar tu pedido, paga por una de estas opciones:\n` +
    `${lines.join("\n")}\n\n` +
    `Cuando pagues, envía aquí la *foto del comprobante*. 📸`
  );
}
