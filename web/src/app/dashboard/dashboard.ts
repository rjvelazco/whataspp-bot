import { DatePipe, CurrencyPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ToolbarModule } from 'primeng/toolbar';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { ImageModule } from 'primeng/image';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ConnectionService } from '../connection.service';
import { OrdersService, type Order, type OrderStatus } from '../orders.service';

type Severity = 'success' | 'secondary' | 'info' | 'warn' | 'danger' | 'contrast';

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
    ToolbarModule,
    CardModule,
    TableModule,
    TagModule,
    ButtonModule,
    ImageModule,
    ToastModule,
  ],
  providers: [MessageService],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit, OnDestroy {
  protected readonly conn = inject(ConnectionService);
  private readonly orders = inject(OrdersService);
  private readonly messages = inject(MessageService);

  protected readonly accountNumber = ConnectionService.accountNumber;
  protected readonly rows = signal<Order[]>([]);
  protected readonly loading = signal(false);
  private readonly verifying = signal<string | null>(null);
  private timer?: ReturnType<typeof setInterval>;

  protected readonly total = computed(() => this.rows().length);
  protected readonly pending = computed(
    () => this.rows().filter((o) => o.status === 'payment_submitted').length,
  );
  protected readonly done = computed(
    () => this.rows().filter((o) => o.status === 'confirmed' || o.status === 'shipped').length,
  );

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
    this.verifying.set(order.order_id);
    this.orders.verify(order.order_id).subscribe({
      next: (res) => {
        this.verifying.set(null);
        this.messages.add({
          severity: res.notified ? 'success' : 'warn',
          summary: `Pedido #${order.order_id} confirmado`,
          detail: res.notified
            ? 'El cliente fue notificado por WhatsApp.'
            : 'Confirmado, pero no se pudo notificar al cliente.',
        });
        this.load();
      },
      error: () => {
        this.verifying.set(null);
        this.messages.add({ severity: 'error', summary: 'No se pudo verificar el pago' });
      },
    });
  }

  protected isVerifying(orderId: string): boolean {
    return this.verifying() === orderId;
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
