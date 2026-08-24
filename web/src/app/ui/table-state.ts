import { signal } from '@angular/core';
import type { SortState } from './sort';

/**
 * The state every list view in this app keeps: a search box, a sort, and a page.
 *
 * It exists to own one rule in one place — **changing the search or the sort returns you
 * to the first page.** Without that, re-sorting while on page 3 leaves you on page 3 of a
 * different list, which is a bug each table would otherwise have to remember not to have.
 *
 * `first` is held here rather than left to p-table because the order list refetches every
 * ten seconds and replacing the array resets the table's own internal page — so it has to
 * be fed back in.
 */
export class TableState<K extends string> {
  readonly search = signal('');
  readonly first = signal(0);
  readonly sort;

  constructor(initialSort: SortState<K>) {
    this.sort = signal<SortState<K>>(initialSort);
  }

  setSearch(value: string): void {
    this.search.set(value);
    this.first.set(0);
  }

  setSort(next: SortState<K>): void {
    this.sort.set(next);
    this.first.set(0);
  }

  setPage(first: number): void {
    this.first.set(first);
  }

  /** The active sort, for the small "Precio ↓" hint in a toolbar. */
  label(names: Record<K, string>): string {
    const { key, dir } = this.sort();
    return `${names[key]} ${dir === 'asc' ? '↑' : '↓'}`;
  }
}
