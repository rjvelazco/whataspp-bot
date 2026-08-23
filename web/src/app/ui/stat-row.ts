import { Component } from '@angular/core';

/**
 * The grid a row of <app-stat-card> sits in. auto-fit rather than a hard three columns:
 * the markup this replaced was already flexible, and a view with two or four tiles
 * should not leave a hole or orphan one.
 */
@Component({
  selector: 'app-stat-row',
  template: '<ng-content />',
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
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
