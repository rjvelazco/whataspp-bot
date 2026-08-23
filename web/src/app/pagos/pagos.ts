import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { OrdersStore } from '../orders.store';
import type { Order } from '../orders.service';
import { customerNumber, isVerified, itemsSummary, paymentRank } from '../order-display';
import { StatusTag } from '../status-tag/status-tag';
import { PayBadge } from '../pay-badge/pay-badge';
import { ReceiptDialog } from './receipt-dialog';
import {
  PageHead,
  StatCard,
  StatRow,
  Card,
  Toolbar,
  SortableTh,
  sortBy,
  type SortState,
} from '../ui';

type PagosFilter = 'all' | 'pending' | 'verified';
type PagosSortKey = 'id' | 'date' | 'name' | 'total' | 'pay';

@Component({
  selector: 'app-pagos',
  imports: [
    DatePipe,
    CurrencyPipe,
    FormsModule,
    TableModule,
    ButtonModule,
    SelectButtonModule,
    StatusTag,
    PayBadge,
    ReceiptDialog,
    PageHead,
    StatCard,
    StatRow,
    Card,
    Toolbar,
    SortableTh,
  ],
  templateUrl: './pagos.html',
  styleUrl: './pagos.css',
})
export class Pagos {
  /** Rows per page in the table. */
  protected readonly PAGE_SIZE = 10;
  protected readonly store = inject(OrdersStore);

  protected readonly filter = signal<PagosFilter>('all');
  /**
   * Paginator page, held here rather than inside p-table. The order list is refetched
   * every ten seconds and rows.set() replaces the array, which resets the table's own
   * internal page — so without this the view jumps back to page 1 while you are reading
   * page 3.
   */
  protected readonly first = signal(0);

  /** The order whose receipt is open, or null. */
  protected readonly selected = signal<Order | null>(null);

  /**
   * Sort state. Fecha opens descending because the newest payment is the one you came to
   * look at; the rest is whatever was clicked last.
   */
  protected readonly sort = signal<SortState<PagosSortKey>>({ key: 'date', dir: 'desc' });

  /**
   * What each column actually sorts by. Never the rendered text: sorting the formatted
   * date puts "10 jul" before "1 jul", and sorting the Pago label orders it
   * alphabetically rather than by what needs attention.
   */
  private readonly sortValue: Record<PagosSortKey, (o: Order) => string | number> = {
    id: (o) => o.order_id,
    date: (o) => Date.parse(o.created_at),
    name: (o) => o.customer_name || '',
    total: (o) => o.subtotal,
    pay: (o) => paymentRank(o),
  };
  protected readonly filterOptions: { label: string; value: PagosFilter }[] = [
    { label: 'Todos', value: 'all' },
    { label: 'Por verificar', value: 'pending' },
    { label: 'Verificados', value: 'verified' },
  ];

  protected readonly filteredRows = computed(() => {
    const rows = this.store.rows();
    const f = this.filter();
    const filtered =
      f === 'pending'
        ? rows.filter((o) => o.status === 'payment_submitted')
        : f === 'verified'
          ? rows.filter(isVerified)
          : rows;
    const { key, dir } = this.sort();
    return sortBy(filtered, this.sortValue[key], dir);
  });

  protected readonly items = itemsSummary;

  /**
   * Open the receipt for a row.
   *
   * A click that landed on the row's own action buttons is ignored rather than being
   * stopped with a handler on the buttons' container: a bare (click) there would be an
   * interaction handler on a non-focusable element, which is exactly what the
   * accessibility rules flag.
   */
  protected open(order: Order, event?: Event): void {
    if (event && (event.target as HTMLElement | null)?.closest('.row-actions')) return;
    this.selected.set(order);
  }
  protected readonly customerNumber = customerNumber;
}
