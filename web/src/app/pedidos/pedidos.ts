import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ImageModule } from 'primeng/image';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { SelectButtonModule } from 'primeng/selectbutton';
import { OrdersStore } from '../orders.store';
import { customerNumber, waLink } from '../order-display';
import { StatusTag } from '../status-tag/status-tag';

type FulfillFilter = 'all' | 'toship' | 'shipped' | 'delivered';

@Component({
  selector: 'app-pedidos',
  imports: [
    DatePipe,
    CurrencyPipe,
    FormsModule,
    ImageModule,
    ButtonModule,
    AvatarModule,
    SelectButtonModule,
    StatusTag,
  ],
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

  protected readonly customerNumber = customerNumber;
  protected readonly waLink = waLink;
}
