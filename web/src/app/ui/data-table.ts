import { NgTemplateOutlet } from '@angular/common';
import { Component, TemplateRef, computed, contentChild, input } from '@angular/core';
import { TableModule } from 'primeng/table';
import type { TableState } from './table-state';

/**
 * The one table in this app.
 *
 * Every list view had the same p-table incantation — the restack class, the paginator
 * threshold, the page fed back through [first] — and getting any of it subtly different is
 * how two tables stop looking and behaving alike. This owns all of it, so a view supplies
 * only its columns.
 *
 * Consumers pass three templates:
 *
 *   <app-data-table [rows]="rows()" [state]="table">
 *     <ng-template #header> <tr>…</tr> </ng-template>
 *     <ng-template #body let-row> <tr>…</tr> </ng-template>
 *     <ng-template #empty> Nothing here. </ng-template>
 *   </app-data-table>
 *
 * They are re-projected into PrimeNG's own pTemplate slots, because PrimeNG finds those by
 * querying its own content children and will not see a template that belongs to a wrapper.
 */
@Component({
  selector: 'app-data-table',
  imports: [TableModule, NgTemplateOutlet],
  template: `
    <p-table
      [value]="mutableRows()"
      [dataKey]="dataKey()"
      [paginator]="rows().length > pageSize()"
      [rows]="pageSize()"
      [first]="state().first()"
      (onPage)="state().setPage($event.first)"
      [styleClass]="'p-datatable-sm table-restack ' + styleClass()"
    >
      <ng-template pTemplate="header">
        <ng-container [ngTemplateOutlet]="header() ?? null" />
      </ng-template>

      <ng-template pTemplate="body" let-row>
        <ng-container
          [ngTemplateOutlet]="body() ?? null"
          [ngTemplateOutletContext]="{ $implicit: row }"
        />
      </ng-template>

      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="columns()" class="p-8 text-center text-muted-color">
            <ng-container [ngTemplateOutlet]="empty() ?? null" />
          </td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class DataTable<T> {
  readonly rows = input.required<readonly T[]>();
  /** p-table's [value] is typed mutable; the copy is shallow and never written to. */
  protected readonly mutableRows = computed(() => this.rows() as T[]);
  readonly state = input.required<TableState<string>>();
  /** How many columns the empty row should span. */
  readonly columns = input.required<number>();
  readonly pageSize = input(10);
  readonly dataKey = input<string | undefined>(undefined);
  readonly styleClass = input('');

  protected readonly header = contentChild<TemplateRef<unknown>>('header');
  protected readonly body = contentChild<TemplateRef<{ $implicit: T }>>('body');
  protected readonly empty = contentChild<TemplateRef<unknown>>('empty');
}
