import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TagModule } from 'primeng/tag';
import { ImageModule } from 'primeng/image';
import { OrdersStore } from '../orders.store';
import { customerNumber, statusLabel, statusSeverity, waLink } from '../order-display';

type FulfillFilter = 'all' | 'toship' | 'shipped' | 'delivered';

@Component({
  selector: 'app-pedidos',
  imports: [DatePipe, CurrencyPipe, TagModule, ImageModule],
  templateUrl: './pedidos.html',
  styleUrl: './pedidos.css',
})
export class Pedidos {
  protected readonly store = inject(OrdersStore);

  protected readonly fulfillFilter = signal<FulfillFilter>('all');
  protected readonly fulfillOptions: { label: string; value: FulfillFilter }[] = [
    { label: 'Todos', value: 'all' },
    { label: 'Por enviar', value: 'toship' },
    { label: 'En camino', value: 'shipped' },
    { label: 'Entregados', value: 'delivered' },
  ];

  protected readonly fulfillRows = computed(() => {
    const rows = this.store.rows();
    const f = this.fulfillFilter();
    if (f === 'toship') return rows.filter((o) => o.status === 'confirmed');
    if (f === 'shipped') return rows.filter((o) => o.status === 'shipped');
    if (f === 'delivered') return rows.filter((o) => o.status === 'delivered');
    return rows.filter(
      (o) => o.status === 'confirmed' || o.status === 'shipped' || o.status === 'delivered',
    );
  });

  protected readonly statusLabel = statusLabel;
  protected readonly statusSeverity = statusSeverity;
  protected readonly customerNumber = customerNumber;
  protected readonly waLink = waLink;
}
