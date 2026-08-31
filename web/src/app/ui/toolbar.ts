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
  `,
})
export class Toolbar {}
