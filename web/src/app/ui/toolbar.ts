import { Component } from '@angular/core';

/**
 * The filter/search/actions strip at the top of a card. Its horizontal padding is the
 * card's inset, so its first control lines up with the first column of the table below.
 *
 * To push trailing controls to the right, give them Tailwind's `ml-auto` at the call
 * site — this component deliberately owns no helper classes of its own.
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
    /* On a phone the toolbar wraps, but the controls inside it do not: a single row
       squeezed the search box to about 190px and clipped its placeholder, while a
       segmented filter that wraps loses its pill shape. So the strip gains rows and each
       control keeps its own width. */
    @media (max-width: 720px) {
      :host {
        flex-wrap: wrap;
        row-gap: 8px;
      }
      :host ::ng-deep p-selectbutton {
        flex: 0 0 auto;
      }
      :host ::ng-deep .p-togglebutton-label {
        white-space: nowrap;
      }
    }
  `,
})
export class Toolbar {}
