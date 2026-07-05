import { Component, computed, input } from '@angular/core';
import { statusLabel } from '../order-display';
import type { OrderStatus } from '../orders.service';

/** Quiet status pill, shared by the Pagos table and the Pedidos cards so they never drift. */
const TONE: Record<OrderStatus, 'success' | 'danger' | 'warn' | 'info'> = {
  pending_payment: 'warn',
  payment_submitted: 'warn',
  confirmed: 'info',
  shipped: 'info',
  delivered: 'success',
  cancelled: 'danger',
};

@Component({
  selector: 'app-status-tag',
  template: `<span class="st-tag" [class]="'st-' + tone()">{{ label() }}</span>`,
  styleUrl: './status-tag.css',
})
export class StatusTag {
  readonly status = input.required<OrderStatus>();
  protected readonly label = computed(() => statusLabel(this.status()));
  protected readonly tone = computed(() => TONE[this.status()]);
}
