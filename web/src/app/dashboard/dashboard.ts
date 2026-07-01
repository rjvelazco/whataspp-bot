import { DatePipe, CurrencyPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { ImageModule } from 'primeng/image';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConnectionService } from '../connection.service';
import { OrdersService, type Order, type OrderStatus } from '../orders.service';

type Severity = 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast';

/** An order counts as "verified" once the owner has confirmed the payment. */
function isVerified(order: Order): boolean {
  return order.status === 'confirmed' || order.status === 'shipped';
}

const STATUS_META: Record<OrderStatus, { label: string; severity: Severity }> = {
  pending_payment: { label: 'Esperando pago', severity: 'secondary' },
  payment_submitted: { label: 'Por verificar', severity: 'warn' },
  confirmed: { label: 'Confirmado', severity: 'success' },
  shipped: { label: 'Enviado', severity: 'info' },
  cancelled: { label: 'Cancelado', severity: 'danger' },
};

@Component({
  selector: 'app-dashboard',
  imports: [
    DatePipe,
    CurrencyPipe,
    TableModule,
    TagModule,
    ButtonModule,
    ImageModule,
    ToastModule,
    ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit, OnDestroy {
  protected readonly conn = inject(ConnectionService);
  private readonly orders = inject(OrdersService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  protected readonly accountNumber = ConnectionService.accountNumber;
  protected readonly rows = signal<Order[]>([]);
  protected readonly loading = signal(false);
  /** Order id currently being acted on (disables its row buttons). */
  private readonly busy = signal<string | null>(null);
  private timer?: ReturnType<typeof setInterval>;

  protected readonly connected = computed(() => this.conn.status().state === 'open');

  /** Which orders to show. "verified" = payment already confirmed (or shipped). */
  protected readonly filter = signal<'all' | 'pending' | 'verified'>('all');
  protected readonly filterOptions: { label: string; value: 'all' | 'pending' | 'verified' }[] = [
    { label: 'Todos', value: 'all' },
    { label: 'Por verificar', value: 'pending' },
    { label: 'Verificados', value: 'verified' },
  ];

  protected readonly total = computed(() => this.rows().length);
  protected readonly pending = computed(
    () => this.rows().filter((o) => o.status === 'payment_submitted').length,
  );
  protected readonly done = computed(() => this.rows().filter(isVerified).length);

  /** Rows after applying the current filter. */
  protected readonly filteredRows = computed(() => {
    const f = this.filter();
    if (f === 'pending') return this.rows().filter((o) => o.status === 'payment_submitted');
    if (f === 'verified') return this.rows().filter(isVerified);
    return this.rows();
  });

  ngOnInit(): void {
    this.load();
    this.timer = setInterval(() => this.load(), 10_000); // keep the list fresh
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  protected load(): void {
    this.loading.set(true);
    this.orders.list().subscribe({
      next: (orders) => {
        this.rows.set(orders);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected verify(order: Order): void {
    this.busy.set(order.order_id);
    this.orders.verify(order.order_id).subscribe({
      next: (res) => {
        this.busy.set(null);
        this.notifyResult(res.notified, `Pedido #${order.order_id} confirmado`);
        this.load();
      },
      error: () => this.fail('No se pudo verificar el pago'),
    });
  }

  protected remind(order: Order): void {
    this.busy.set(order.order_id);
    this.orders.remind(order.order_id).subscribe({
      next: (res) => {
        this.busy.set(null);
        this.notifyResult(res.notified, `Recordatorio enviado a #${order.order_id}`);
      },
      error: () => this.fail('No se pudo enviar el recordatorio'),
    });
  }

  protected cancel(order: Order): void {
    this.confirm.confirm({
      header: 'Cancelar pedido',
      message: `¿Cancelar el pedido #${order.order_id} de ${order.customer_name}? Se le avisará al cliente.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Sí, cancelar',
      rejectLabel: 'No',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.busy.set(order.order_id);
        this.orders.cancel(order.order_id).subscribe({
          next: (res) => {
            this.busy.set(null);
            this.notifyResult(res.notified, `Pedido #${order.order_id} cancelado`);
            this.load();
          },
          error: () => this.fail('No se pudo cancelar el pedido'),
        });
      },
    });
  }

  protected isBusy(orderId: string): boolean {
    return this.busy() === orderId;
  }

  private notifyResult(notified: boolean, summary: string): void {
    this.messages.add({
      severity: notified ? 'success' : 'warn',
      summary,
      detail: notified
        ? 'El cliente fue notificado por WhatsApp.'
        : 'Hecho, pero no se pudo notificar al cliente (¿bot desconectado?).',
    });
  }

  private fail(summary: string): void {
    this.busy.set(null);
    this.messages.add({ severity: 'error', summary });
  }

  protected statusLabel(status: OrderStatus): string {
    return STATUS_META[status].label;
  }
  protected statusSeverity(status: OrderStatus): Severity {
    return STATUS_META[status].severity;
  }

  protected items(order: Order): string {
    return order.items.map((i) => `${i.code} ${i.size}/${i.color} ×${i.qty}`).join(', ');
  }

  protected customerNumber(wa: string): string {
    return '+' + wa.replace(/[:@].*$/, '');
  }

  protected receiptUrl(orderId: string): string {
    return this.orders.receiptUrl(orderId);
  }
}
