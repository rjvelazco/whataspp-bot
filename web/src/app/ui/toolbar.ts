import { Component } from '@angular/core';

/**
 * The filter/search/actions strip at the top of a card. Its horizontal padding is the
 * card's inset, so its first control lines up with the first column of the table below.
 */
@Component({
  selector: 'app-toolbar',
  template: '<ng-content />',
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      padding: 16px var(--card-inset, 24px);
      border-bottom: 1px solid var(--color-line-soft);
    }
    /* Pushes whatever follows to the right edge of the same inset. */
    :host ::ng-deep .spacer {
      margin-left: auto;
    }
  `,
})
export class Toolbar {}
