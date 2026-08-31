import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { OrdersService, type Order } from './orders.service';
import { paymentState, type PaymentState } from './order-display';

/**
 * Shared, app-wide order state + actions. Used by the shell (for nav badges)
 * and by the Pagos / Pedidos routed views, so nothing is duplicated.
 */
@Injectable({ providedIn: 'root' })
export class OrdersStore {
  private readonly api = inject(OrdersService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  readonly rows = signal<Order[]>([]);
  readonly loading = signal(false);
  private readonly busyId = signal<string | null>(null);
  private timer?: ReturnType<typeof setInterval>;

  readonly total = computed(() => this.rows().length);

  /**
   * The payment counts, all derived from `paymentState` so the cards, the badge in each
   * row, the filter chips and the sidebar pill can never disagree.
   *
   * They used to: `pendingVerify` keyed on `status === 'payment_submitted'` while the
   * badge keyed on "unverified with a receipt". Those differ for a cancelled order that
   * still carries a receipt — legal, and it kept its receipt — so the amber card and the
   * amber badge counted different sets, which is the exact defect this was meant to fix.
   *
   * Cancelled orders are in none of the three, so together they sum to the live rows
   * rather than to `total`.
   */
  private readonly paymentStates = computed(() => this.rows().map((o) => paymentState(o)));
  private countOf(state: PaymentState): number {
    return this.paymentStates().filter((s) => s === state).length;
  }
  readonly pendingVerify = computed(() => this.countOf('por_verificar'));
  readonly noReceiptCount = computed(() => this.countOf('sin_comprobante'));
  readonly verifiedCount = computed(() => this.countOf('verificado'));
  readonly toShip = computed(() => this.rows().filter((o) => o.status === 'confirmed').length);
  readonly inTransit = computed(() => this.rows().filter((o) => o.status === 'shipped').length);
  readonly deliveredCount = computed(
    () => this.rows().filter((o) => o.status === 'delivered').length,
  );

  /** Begin polling (idempotent). Called by the shell. */
  startAutoRefresh(): void {
    this.load();
    this.timer ??= setInterval(() => this.load(), 10_000);
  }
  stopAutoRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  load(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (orders) => {
        this.rows.set(orders);
        // A customer may have re-sent a comprobante that previously 404'd, so give every
        // order another chance rather than remembering the failure forever.
        this.missingReceipts.set(new Set());
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  isBusy(orderId: string): boolean {
    return this.busyId() === orderId;
  }

  verify(order: Order): void {
    this.run(order, this.api.verify(order.order_id), `Pedido #${order.order_id} confirmado`);
  }
  remind(order: Order): void {
    this.run(
      order,
      this.api.remind(order.order_id),
      `Recordatorio enviado a #${order.order_id}`,
      false,
    );
  }
  ship(order: Order): void {
    this.run(order, this.api.ship(order.order_id), `Pedido #${order.order_id} enviado`);
  }
  deliver(order: Order): void {
    this.run(order, this.api.deliver(order.order_id), `Pedido #${order.order_id} entregado`);
  }
  cancel(order: Order): void {
    this.confirm.confirm({
      header: 'Cancelar pedido',
      message: `¿Cancelar el pedido #${order.order_id} de ${order.customer_name}? Se le avisará al cliente.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Sí, cancelar',
      rejectLabel: 'No',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () =>
        this.run(order, this.api.cancel(order.order_id), `Pedido #${order.order_id} cancelado`),
    });
  }

  receiptUrl(orderId: string): string {
    return this.api.receiptUrl(orderId);
  }

  /**
   * Orders whose comprobante the server could not serve.
   *
   * The template can only check that receipt_url is a non-empty string; whether the file
   * is actually there is known to the server. When those two disagreed the browser
   * painted its broken-image glyph instead of the designed placeholder, which is half of
   * why the thumbnails looked broken. The image reports the failure and the view falls
   * back properly.
   */
  private readonly missingReceipts = signal<ReadonlySet<string>>(new Set());

  hasReceipt(order: Order): boolean {
    return !!order.receipt_url && !this.missingReceipts().has(order.order_id);
  }

  markReceiptMissing(orderId: string): void {
    if (this.missingReceipts().has(orderId)) return;
    this.missingReceipts.update((s) => new Set(s).add(orderId));
  }

  private run(
    order: Order,
    obs: Observable<{ notified?: boolean }>,
    summary: string,
    reload = true,
  ): void {
    this.busyId.set(order.order_id);
    obs.subscribe({
      next: (res) => {
        this.busyId.set(null);
        this.messages.add({
          severity: res?.notified === false ? 'warn' : 'success',
          summary,
          detail:
            res?.notified === false
              ? 'Hecho, pero no se pudo notificar al cliente (¿bot desconectado?).'
              : 'El cliente fue notificado por WhatsApp.',
        });
        if (reload) this.load();
      },
      error: () => {
        this.busyId.set(null);
        this.messages.add({ severity: 'error', summary: 'No se pudo completar la acción' });
      },
    });
  }
}
