import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { ImageModule } from 'primeng/image';
import { AvatarModule } from 'primeng/avatar';
import { SelectButtonModule } from 'primeng/selectbutton';
import { OrdersStore } from '../orders.store';
import { customerNumber, isVerified, itemsSummary } from '../order-display';
import { StatusTag } from '../status-tag/status-tag';

type PagosFilter = 'all' | 'pending' | 'verified';

@Component({
  selector: 'app-pagos',
  imports: [
    DatePipe,
    CurrencyPipe,
    FormsModule,
    TableModule,
    ButtonModule,
    ImageModule,
    AvatarModule,
    SelectButtonModule,
    StatusTag,
  ],
  templateUrl: './pagos.html',
  styleUrl: './pagos.css',
})
export class Pagos {
  protected readonly store = inject(OrdersStore);

  protected readonly filter = signal<PagosFilter>('all');
  protected readonly filterOptions: { label: string; value: PagosFilter }[] = [
    { label: 'Todos', value: 'all' },
    { label: 'Por verificar', value: 'pending' },
    { label: 'Verificados', value: 'verified' },
  ];

  protected readonly filteredRows = computed(() => {
    const rows = this.store.rows();
    const f = this.filter();
    if (f === 'pending') return rows.filter((o) => o.status === 'payment_submitted');
    if (f === 'verified') return rows.filter(isVerified);
    return rows;
  });

  protected readonly items = itemsSummary;
  protected readonly customerNumber = customerNumber;
}
