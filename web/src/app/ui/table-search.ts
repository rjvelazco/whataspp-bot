import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import type { TableState } from './table-state';

/** The search box a list view puts in its toolbar. Same shape, same placeholder rules. */
@Component({
  selector: 'app-table-search',
  imports: [FormsModule, IconFieldModule, InputIconModule, InputTextModule],
  template: `
    <p-iconfield iconPosition="left" styleClass="w-full">
      <p-inputicon styleClass="pi pi-search" />
      <input
        pInputText
        type="search"
        [ngModel]="state().search()"
        (ngModelChange)="state().setSearch($event)"
        [placeholder]="placeholder()"
        [attr.aria-label]="placeholder()"
        class="w-full"
      />
    </p-iconfield>
  `,
  styles: `
    /* Grow to the space the toolbar has, but never so wide that it dominates the row.
       A fixed width clipped the longer placeholders. */
    :host {
      display: block;
      flex: 1 1 240px;
      max-width: 400px;
    }
  `,
})
export class TableSearch {
  readonly state = input.required<TableState<string>>();
  readonly placeholder = input('Buscar');
}
