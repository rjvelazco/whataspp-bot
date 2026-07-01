import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { OrdersService, type Order } from './orders.service';
import { isVerified } from './order-display';

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
  readonly pendingVerify = computed(
    () => this.rows().filter((o) => o.status === 'payment_submitted').length,
  );
  readonly verifiedCount = computed(() => this.rows().filter(isVerified).length);
  readonly toShip = computed(() => this.rows().filter((o) => o.status === 'confirmed').length);
  readonly inTransit = computed(() => this.rows().filter((o) => o.status === 'shipped').length);
  readonly deliveredCount = computed(() => this.rows().filter((o) => o.status === 'delivered').length);

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
    this.run(order, this.api.remind(order.order_id), `Recordatorio enviado a #${order.order_id}`, false);
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
      accept: () => this.run(order, this.api.cancel(order.order_id), `Pedido #${order.order_id} cancelado`),
    });
  }

  receiptUrl(orderId: string): string {
    return this.api.receiptUrl(orderId);
  }

  private run(order: Order, obs: Observable<{ notified?: boolean }>, summary: string, reload = true): void {
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
