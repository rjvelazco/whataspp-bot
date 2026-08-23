import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, inject, signal, type OnInit } from '@angular/core';
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
import { buildSheet, columnWidths, exportFilename } from './pagos-export';
import { StoreService } from '../store.service';
import { MessageService } from 'primeng/api';
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
export class Pagos implements OnInit {
  /** Rows per page in the table. */
  protected readonly PAGE_SIZE = 10;
  protected readonly store = inject(OrdersStore);
  private readonly storeApi = inject(StoreService);
  private readonly messages = inject(MessageService);
  private readonly storeName = signal('tienda');
  protected readonly exporting = signal(false);

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
  ngOnInit(): void {
    // Only for the export filename; the view itself needs nothing from the store.
    this.storeApi.get().subscribe({
      next: (s) => this.storeName.set(s.store_name),
      error: () => {},
    });
  }

  /**
   * Export what is on screen — the current filter and sort, not the whole table. If
   * someone has filtered to "Por verificar" and sorted by amount, that is the list they
   * are asking for.
   *
   * The spreadsheet writer is imported here rather than at the top of the file so it
   * stays out of the initial bundle: it is needed only when this button is pressed.
   */
  protected async exportToExcel(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      // The /browser subpath: the package exposes no bare entry, and this is the build
      // that triggers a download rather than writing to a filesystem path.
      const { default: writeXlsxFile } = await import('write-excel-file/browser');
      // The browser build returns { toBlob, toFile }; toFile triggers the download.
      await writeXlsxFile(buildSheet(this.filteredRows()), {
        columns: columnWidths,
        sheet: 'Pagos',
      }).toFile(exportFilename(this.storeName(), new Date()));
    } catch {
      this.messages.add({
        severity: 'error',
        summary: 'No se pudo generar el archivo',
        detail: 'Vuelve a intentarlo.',
      });
    } finally {
      this.exporting.set(false);
    }
  }

  protected open(order: Order, event?: Event): void {
    if (event && (event.target as HTMLElement | null)?.closest('.row-actions')) return;
    this.selected.set(order);
  }
  protected readonly customerNumber = customerNumber;
}
