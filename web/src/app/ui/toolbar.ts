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
    /* On a phone the strip gains rows, and the search takes one to itself so its width
       does not depend on what else happens to be beside it.
       overflow-x stays: app-card clips (overflow: hidden), so a control wider than the
       card — a three-chip segmented filter is ~318px — becomes permanently unreachable
       without it rather than merely scrolled. Wrapping and scrolling are not
       alternatives here; the scroll is the fallback for the row that cannot wrap. */
    @media (max-width: 720px) {
      :host {
        row-gap: 8px;
        overflow-x: auto;
      }
      :host ::ng-deep app-table-search {
        flex-basis: 100%;
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
