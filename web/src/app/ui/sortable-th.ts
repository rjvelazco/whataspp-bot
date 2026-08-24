import { Component, computed, input } from '@angular/core';
import { nextSort } from './sort';
import type { TableState } from './table-state';

/**
 * A sortable column header. Used as an attribute on a real <th>, so PrimeNG's table
 * markup and the card inset rule are untouched:
 *
 *   <th appSortable key="date" numeric [state]="table">Fecha</th>
 *
 * The label is wrapped in a button, because the thing being clicked should be a control
 * — that is what puts it in the tab order and gives it a focus ring for free. The header
 * carries aria-sort, which is the part screen readers announce.
 */
@Component({
  selector: 'th[appSortable]',
  host: {
    '[attr.aria-sort]': 'ariaSort()',
    '[class.is-sorted]': 'active()',
  },
  template: `
    <button type="button" (click)="toggle()">
      <ng-content />
      <svg class="arrows" viewBox="0 0 24 24" aria-hidden="true">
        <g class="up">
          <path d="M8 20V5" />
          <path d="m4 9 4-4 4 4" />
        </g>
        <g class="dn">
          <path d="M16 4v15" />
          <path d="m12 15 4 4 4-4" />
        </g>
      </svg>
    </button>
  `,
  styles: `
    :host {
      padding: 0 !important;
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 16px var(--cell-inset, 16px);
      border: 0;
      background: none;
      cursor: pointer;
      font: inherit;
      color: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
      transition: color 0.14s ease;
    }
    button:hover {
      color: var(--color-ink);
    }
    :host(.is-sorted) button {
      color: var(--color-signal-ink);
    }
    /* Right-aligned columns keep their label against the numbers. */
    :host(.num) button {
      justify-content: flex-end;
    }
    .arrows {
      width: 12px;
      height: 12px;
      flex: 0 0 12px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      opacity: 0.5;
    }
    :host(.is-sorted) .arrows {
      opacity: 1;
    }
    /* Dim the arrow that is not the current direction. */
    :host([aria-sort='ascending']) .arrows .dn,
    :host([aria-sort='descending']) .arrows .up {
      opacity: 0.2;
    }
  `,
})
export class SortableTh<K extends string = string> {
  /** The value this column sorts by, matched against the current sort state. */
  readonly key = input.required<K>();
  /**
   * The table's shared state. One binding rather than a sort in and an event out — with
   * ten headers across two views, that was forty lines of the same pair.
   */
  readonly state = input.required<TableState<K>>();
  /** Numbers and dates open descending; text opens ascending. */
  readonly numeric = input(false, {
    transform: (v: boolean | string) => v !== false && v !== 'false',
  });

  private readonly sort = computed(() => this.state().sort());
  protected readonly active = computed(() => this.sort().key === this.key());
  protected readonly ariaSort = computed(() =>
    this.active() ? (this.sort().dir === 'asc' ? 'ascending' : 'descending') : 'none',
  );

  protected toggle(): void {
    this.state().setSort(nextSort(this.sort(), this.key(), this.numeric()));
  }
}
