import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { ImageModule } from 'primeng/image';
import { OrdersStore } from '../orders.store';
import { customerNumber, isVerified, itemsSummary, statusLabel, statusSeverity } from '../order-display';

type PagosFilter = 'all' | 'pending' | 'verified';

@Component({
  selector: 'app-pagos',
  imports: [DatePipe, CurrencyPipe, TableModule, TagModule, ButtonModule, ImageModule],
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

  protected readonly statusLabel = statusLabel;
  protected readonly statusSeverity = statusSeverity;
  protected readonly items = itemsSummary;
  protected readonly customerNumber = customerNumber;
}
