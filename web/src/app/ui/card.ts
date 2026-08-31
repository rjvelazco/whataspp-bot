import { Component } from '@angular/core';

/**
 * The card surface every table and list sits on.
 *
 * It also owns the inset that the alignment rule depends on. --card-inset is declared
 * here and read by <app-toolbar> and by the table-cell override in styles.css, so a
 * toolbar control and the first cell of the table beneath it share one left edge that is
 * defined exactly once. Pagos was 12px out because those two paddings were specified
 * separately, in two places — see ../../../CLAUDE.md rule 2.
 */
@Component({
  selector: 'app-card',
  template: '<ng-content />',
  styles: `
    :host {
      --card-inset: 24px;
      display: block;
      background: var(--color-paper);
      border: 1px solid var(--color-line);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-card);
      overflow: hidden;
    }
    @media (max-width: 720px) {
      :host {
        --card-inset: 16px;
      }
    }
  `,
})
export class Card {}
