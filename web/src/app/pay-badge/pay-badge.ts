import { Component, computed, input } from '@angular/core';
import { TagModule } from 'primeng/tag';
import { paymentLabel, paymentState, type PaymentState } from '../order-display';
import type { Order } from '../orders.service';

/**
 * Where an order stands on payment. Three states, because "did they send proof?" was
 * previously only answerable by opening the receipt: Verificado / Por verificar /
 * Sin comprobante.
 *
 * Tone follows the design system's semantics rather than being picked per call site:
 * emerald means a human verified it, amber means it is waiting on someone, and a plain
 * tone means nothing has arrived. Colour lives here as its single source — the same
 * split StatusTag uses for delivery status.
 */
const TONE: Record<PaymentState, 'success' | 'warn' | 'secondary' | 'danger'> = {
  verificado: 'success',
  por_verificar: 'warn',
  sin_comprobante: 'secondary',
  // Rose, matching the design system's meaning for cancelled.
  cancelado: 'danger',
};

@Component({
  selector: 'app-pay-badge',
  imports: [TagModule],
  template: `<p-tag [value]="label()" [severity]="tone()" [rounded]="true" />`,
})
export class PayBadge {
  readonly order = input.required<Order>();
  /**
   * Whether a receipt can actually be shown. Defaults to the row's own field, but the
   * caller can pass the store's view — which excludes files the server could not serve —
   * so the badge cannot say "Por verificar" beside a body that says nothing arrived.
   */
  readonly hasReceipt = input<boolean | undefined>(undefined);
  private readonly state = computed(() =>
    paymentState(this.order(), this.hasReceipt() ?? !!this.order().receipt_url),
  );
  protected readonly label = computed(() => paymentLabel(this.state()));
  protected readonly tone = computed(() => TONE[this.state()]);
}
