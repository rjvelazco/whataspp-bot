import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { ImageModule } from 'primeng/image';
import { OrdersStore } from '../orders.store';
import { customerNumber, paymentState, statusLabel, waLink } from '../order-display';
import { PayBadge } from '../pay-badge/pay-badge';
import type { Order } from '../orders.service';

/**
 * The full detail behind a row in Pagos, as a centred receipt.
 *
 * Dropping the thumbnail column from the table means the comprobante has to live
 * somewhere, and a receipt is the shape the owner already recognises: line items, a
 * total, and the image the customer sent, with the actions on it rather than in a
 * cramped table cell.
 *
 * The prototype also shows Método and Referencia. The bot never asks for either, so
 * there is nothing to render — inventing empty rows for them would imply the data exists.
 * Entrega takes their place, since that is captured.
 */
@Component({
  selector: 'app-receipt-dialog',
  imports: [DialogModule, ButtonModule, ImageModule, CurrencyPipe, DatePipe, PayBadge],
  templateUrl: './receipt-dialog.html',
  styleUrl: './receipt-dialog.css',
})
export class ReceiptDialog {
  protected readonly store = inject(OrdersStore);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly primaryAction = viewChild<ElementRef<HTMLElement>>('primaryAction');

  /** The order to show, or null when the dialog is closed. */
  readonly order = input<Order | null>(null);
  readonly closed = output<void>();

  protected readonly customerNumber = customerNumber;
  protected readonly statusLabel = statusLabel;
  protected readonly verified = computed(() => {
    const order = this.order();
    return !!order && paymentState(order) === 'verificado';
  });
  /**
   * Whether there is a state worth naming beyond the payment badge.
   *
   * Before payment clears, OrderStatus is still on its payment leg, and its label reads
   * "Por verificar" — which as a line called Envío is simply wrong, and duplicates the
   * badge at the top of the receipt. The row appears once the order has actually moved.
   */
  protected readonly hasShipmentState = computed(() => {
    const status = this.order()?.status;
    return status === 'shipped' || status === 'delivered' || status === 'cancelled';
  });

  protected readonly whatsappLink = computed(() => {
    const order = this.order();
    return order ? waLink(order.customer_wa) : '';
  });

  /**
   * Move focus into the dialog when it opens.
   *
   * PrimeNG focuses the first focusable element in the dialog's *content*, and this
   * content is a read-only receipt with none — so focus stayed on the row behind it, the
   * focus trap never engaged, and tabbing walked the page underneath the modal.
   */
  /** What had focus before the dialog opened, so it can be handed back on close. */
  private trigger: HTMLElement | null = null;

  /**
   * Return focus to whatever opened the dialog.
   *
   * Without this, closing leaves focus on <body> and a keyboard user restarts from the
   * top of the page. PrimeNG restores focus by itself when the trigger is still in the
   * DOM and focusable, but the row list re-renders on the 10s poll, so it cannot rely on
   * the element identity.
   */
  protected restoreFocus(): void {
    const trigger = this.trigger;
    this.trigger = null;
    if (trigger?.isConnected) trigger.focus();
  }

  protected focusPrimaryAction(): void {
    const active = this.host.nativeElement.ownerDocument?.activeElement;
    this.trigger = active instanceof HTMLElement ? active : null;

    // Queried from the document rather than through viewChild: the footer is an
    // ng-template that PrimeNG projects into its own embedded view, which a view query
    // on this component cannot reach. Prefer the footer's first action, and fall back to
    // the close button for an already-verified order that has none — either way focus
    // lands inside the dialog, which is what engages the focus trap.
    const doc = this.host.nativeElement.ownerDocument;
    const target =
      doc?.querySelector<HTMLElement>('.receipt-dialog .p-dialog-footer button') ??
      doc?.querySelector<HTMLElement>('.receipt-dialog .p-dialog-close-button');
    target?.focus();
  }

  protected close(): void {
    this.closed.emit();
  }

  protected verify(order: Order): void {
    this.store.verify(order);
    this.close();
  }
}
