import { Component, input } from '@angular/core';

/**
 * The header every view starts with: a small eyebrow, the page title in the display
 * face, an optional lede, and a slot for the page's actions.
 *
 * Title type lives here rather than in the global shell, so a page title is sized in
 * one place and the responsive step comes with it.
 */
@Component({
  selector: 'app-page-head',
  template: `
    <header class="head">
      <div class="grow">
        @if (eyebrow()) {
          <p class="eyebrow">{{ eyebrow() }}</p>
        }
        <h1>{{ title() }}</h1>
        @if (lede()) {
          <p class="lede">{{ lede() }}</p>
        }
      </div>
      <div class="actions"><ng-content /></div>
    </header>
  `,
  styles: `
    .head {
      display: flex;
      align-items: flex-end;
      gap: 24px;
      flex-wrap: wrap;
      margin-bottom: 32px;
    }
    .grow {
      flex: 1;
      min-width: 240px;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .eyebrow {
      font-family: var(--font-data);
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--color-ink-3);
      margin: 0 0 8px;
    }
    h1 {
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 30px;
      line-height: 1.13;
      letter-spacing: -0.02em;
      color: var(--color-ink);
      margin: 0;
    }
    .lede {
      margin: 8px 0 0;
      color: var(--color-ink-2);
      max-width: 62ch;
    }
    @media (max-width: 720px) {
      .head {
        margin-bottom: 24px;
      }
      h1 {
        font-size: 24px;
      }
    }
  `,
})
export class PageHead {
  readonly title = input.required<string>();
  readonly eyebrow = input<string>('');
  readonly lede = input<string>('');
}
