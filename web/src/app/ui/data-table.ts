import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  TemplateRef,
  afterRenderEffect,
  computed,
  contentChild,
  inject,
  input,
  signal,
} from '@angular/core';
import { TableModule } from 'primeng/table';
import type { TableState } from './table-state';

/**
 * The shared table. Both list views are consumers; a view supplies only its columns.
 *
 * What it owns is the configuration that has to be identical for two tables to look and
 * behave alike — the restack class, the paginator threshold, the loading state, and the
 * page fed back through [first] (the order list refetches every ten seconds, and
 * replacing the array resets p-table's own internal page).
 *
 * Consumers pass three templates:
 *
 *   <app-data-table [rows]="rows()" [state]="table" [loading]="loading()">
 *     <ng-template #header> <tr>…</tr> </ng-template>
 *     <ng-template #body let-row> <tr>…</tr> </ng-template>
 *     <ng-template #empty> Nothing here. </ng-template>
 *   </app-data-table>
 *
 * They are re-projected into PrimeNG's own pTemplate slots, because PrimeNG finds those
 * by querying its own content children and will not see a template belonging to a wrapper.
 */
@Component({
  selector: 'app-data-table',
  imports: [TableModule, NgTemplateOutlet],
  template: `
    <p-table
      [value]="mutableRows()"
      [loading]="loading()"
      [paginator]="rows().length > pageSize()"
      [rows]="pageSize()"
      [first]="clampedFirst()"
      (onPage)="state().setPage($event.first)"
      styleClass="p-datatable-sm table-restack"
    >
      <ng-template pTemplate="header">
        <ng-container [ngTemplateOutlet]="header()" />
      </ng-template>

      <ng-template pTemplate="body" let-row let-rowIndex="rowIndex">
        <ng-container
          [ngTemplateOutlet]="body()"
          [ngTemplateOutletContext]="{ $implicit: row, rowIndex: rowIndex }"
        />
      </ng-template>

      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="columnCount()" class="p-8 text-center text-muted-color">
            <ng-container [ngTemplateOutlet]="empty() ?? null" />
          </td>
        </tr>
      </ng-template>
    </p-table>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class DataTable<T> {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly rows = input.required<readonly T[]>();
  readonly state = input.required<TableState<string>>();
  readonly loading = input(false);
  readonly pageSize = input(10);

  /**
   * Required, so a typo'd ref name is a build error rather than a table that silently
   * renders nothing. `empty` stays optional — a view may not have anything to say.
   */
  protected readonly header = contentChild.required<TemplateRef<unknown>>('header');
  protected readonly body =
    contentChild.required<TemplateRef<{ $implicit: T; rowIndex: number }>>('body');
  protected readonly empty = contentChild<TemplateRef<unknown>>('empty');

  /**
   * p-table's [value] is typed mutable. The cast is safe because PrimeNG only mutates the
   * array in sortSingle/sortMultiple, which are reached solely through `sortField` or
   * `pSortableColumn` — neither of which this wrapper exposes. Sorting here happens
   * upstream and hands over a fresh array. Exposing PrimeNG's own sorting would break
   * that precondition.
   */
  protected readonly mutableRows = computed(() => this.rows() as T[]);

  /**
   * Counted from the rendered header rather than taken as an input.
   *
   * It was an input, which meant every consumer had to keep a magic number in step with
   * its own <th> list, with nothing to catch a mismatch but the eye.
   */
  private readonly renderedColumns = signal(1);
  protected readonly columnCount = computed(() => this.renderedColumns());

  /**
   * Keep the page inside the data.
   *
   * p-table slices [first, first+rows) but tests emptiness against the whole value, so an
   * out-of-range page renders neither rows nor the empty message — a blank table with a
   * live paginator. Reachable by deleting the last row of the last page.
   */
  protected readonly clampedFirst = computed(() => {
    const size = this.pageSize();
    const lastPageStart = Math.max(0, Math.floor((this.rows().length - 1) / size) * size);
    return Math.min(this.state().first(), lastPageStart);
  });

  constructor() {
    afterRenderEffect(() => {
      const count = this.host.nativeElement.querySelectorAll('thead > tr > th').length;
      if (count > 0 && count !== this.renderedColumns()) this.renderedColumns.set(count);
    });
  }
}
