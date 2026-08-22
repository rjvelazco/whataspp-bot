import { Component } from '@angular/core';

/** The grid a row of <app-stat-card> sits in. One column per tile, stacking on a phone. */
@Component({
  selector: 'app-stat-row',
  template: '<ng-content />',
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    @media (max-width: 960px) {
      :host {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class StatRow {}
