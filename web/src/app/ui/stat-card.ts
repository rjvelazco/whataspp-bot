import { Component, input } from '@angular/core';

/** Which of the three semantic roles the tile's edge carries, if any. */
export type StatTone = 'neutral' | 'signal' | 'amber' | 'rose';

/**
 * A single metric. The tone shows as a 3px coloured left edge rather than a tinted
 * background: the number stays the loudest thing in the tile, and a row of tiles does
 * not turn into a row of coloured blocks.
 */
@Component({
  selector: 'app-stat-card',
  host: { '[class]': "'tile tone-' + tone()" },
  template: `
    <span class="label">{{ label() }}</span>
    <span class="value">{{ value() }}</span>
    @if (note()) {
      <span class="note">{{ note() }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0;
      position: relative;
      overflow: hidden;
      padding: 16px 24px;
      border: 1px solid var(--color-line);
      border-radius: var(--radius-lg);
      background: var(--color-paper);
    }
    :host::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: var(--color-line);
    }
    :host(.tone-signal)::before {
      background: var(--color-signal);
    }
    :host(.tone-amber)::before {
      background: var(--color-amber);
    }
    :host(.tone-rose)::before {
      background: var(--color-rose);
    }
    .label {
      font-size: 12px;
      color: var(--color-ink-3);
    }
    .value {
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 28px;
      line-height: 1.2;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      color: var(--color-ink);
    }
    :host(.tone-amber) .value {
      color: var(--color-amber);
    }
    :host(.tone-rose) .value {
      color: var(--color-rose);
    }
    .note {
      font-size: 12px;
      color: var(--color-ink-2);
    }
  `,
})
export class StatCard {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly note = input<string>('');
  readonly tone = input<StatTone>('neutral');
}
