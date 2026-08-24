import {
  Component,
  ElementRef,
  afterNextRender,
  effect,
  model,
  signal,
  viewChild,
} from '@angular/core';

/**
 * An iOS-style scroll wheel for picking a time.
 *
 * Hand-rolled on purpose: every Angular wheel picker on npm is abandoned at Angular
 * 7–15, and the maintained alternatives cost about a megabyte (Ionic), need a licence
 * (Mobiscroll), or are not a snap wheel at all (PrimeNG's datepicker renders chevron
 * spinners). The whole mechanic is `scroll-snap-type: y mandatory` plus a spacer at each
 * end; momentum scrolling then comes free on both phone platforms.
 *
 * Each column is a `spinbutton` rather than a listbox: a wheel is a value being dialled,
 * not a list being chosen from, and it gives arrow keys the obvious meaning without a
 * roving tabindex over sixty options.
 */

/** Row height in px. On the 8-point grid, and the number every scroll offset divides by. */
const ITEM = 40;

/** How long after the last scroll event the value is taken. */
const SETTLE_MS = 120;

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const MERIDIEMS = ['AM', 'PM'] as const;

interface Parts {
  hour: number;
  minute: number;
  meridiem: 0 | 1;
}

/** "13:05" -> { hour: 1, minute: 5, meridiem: PM }. Falls back to 9:00 AM. */
function parseTime(value: string): Parts {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  const h24 = m ? Number(m[1]) : 9;
  const minute = m ? Number(m[2]) : 0;
  if (h24 > 23 || minute > 59) return { hour: 9, minute: 0, meridiem: 0 };
  return { hour: h24 % 12 === 0 ? 12 : h24 % 12, minute, meridiem: h24 >= 12 ? 1 : 0 };
}

function toTime(parts: Parts): string {
  const base = parts.hour % 12;
  const h24 = parts.meridiem === 1 ? base + 12 : base;
  return `${String(h24).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

@Component({
  selector: 'app-time-wheel',
  template: `
    <div class="wheel" role="group" [attr.aria-label]="ariaLabel">
      <div class="wheel-band" aria-hidden="true"></div>

      <div
        #hourCol
        class="col"
        role="spinbutton"
        tabindex="0"
        aria-label="Hora"
        [attr.aria-valuenow]="parts().hour"
        [attr.aria-valuemin]="1"
        [attr.aria-valuemax]="12"
        (scroll)="onScroll()"
        (keydown)="onKey($event, 'hour')"
      >
        <div class="pad"></div>
        @for (h of hours; track h) {
          <div class="cell" [class.is-active]="h === parts().hour">{{ h }}</div>
        }
        <div class="pad"></div>
      </div>

      <span class="colon" aria-hidden="true">:</span>

      <div
        #minuteCol
        class="col"
        role="spinbutton"
        tabindex="0"
        aria-label="Minutos"
        [attr.aria-valuenow]="parts().minute"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="59"
        [attr.aria-valuetext]="pad(parts().minute)"
        (scroll)="onScroll()"
        (keydown)="onKey($event, 'minute')"
      >
        <div class="pad"></div>
        @for (m of minutes; track m) {
          <div class="cell" [class.is-active]="m === parts().minute">{{ pad(m) }}</div>
        }
        <div class="pad"></div>
      </div>

      <div
        #meridiemCol
        class="col col-narrow"
        role="spinbutton"
        tabindex="0"
        aria-label="Mañana o tarde"
        [attr.aria-valuenow]="parts().meridiem"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="1"
        [attr.aria-valuetext]="meridiems[parts().meridiem]"
        (scroll)="onScroll()"
        (keydown)="onKey($event, 'meridiem')"
      >
        <div class="pad"></div>
        @for (mer of meridiems; track mer; let i = $index) {
          <div class="cell" [class.is-active]="i === parts().meridiem">{{ mer }}</div>
        }
        <div class="pad"></div>
      </div>
    </div>
  `,
  styleUrl: './time-wheel.css',
})
export class TimeWheel {
  /** The time as "HH:MM", 24-hour — what the API stores. */
  readonly value = model.required<string>();
  readonly ariaLabel = 'Hora de publicación';

  protected readonly hours = HOURS;
  protected readonly minutes = MINUTES;
  protected readonly meridiems = MERIDIEMS;

  private readonly hourCol = viewChild.required<ElementRef<HTMLElement>>('hourCol');
  private readonly minuteCol = viewChild.required<ElementRef<HTMLElement>>('minuteCol');
  private readonly meridiemCol = viewChild.required<ElementRef<HTMLElement>>('meridiemCol');

  /** Mirrors `value`, so the template reads parts without re-parsing per binding. */
  protected readonly parts = signal<Parts>({ hour: 9, minute: 0, meridiem: 0 });

  /** Set while we are the ones changing the value, so the effect does not fight a scroll. */
  private committing = false;
  private settle?: ReturnType<typeof setTimeout>;
  /**
   * Scroll events caused by us are ignored until this moment.
   *
   * Without it the wheel fights itself: scrollTo fires `scroll`, the debounced reader
   * takes the position mid-animation, and commits a value nobody chose — which is how
   * a wheel opened on 9:00 AM settled on 9:02 PM, and how an arrow key was undone by
   * the smooth scroll it had just started.
   */
  private ignoreScrollUntil = 0;

  constructor() {
    effect(() => {
      const next = parseTime(this.value());
      this.parts.set(next);
      if (this.committing) {
        this.committing = false;
        return;
      }
      // An outside change (opening the dialog on an existing story) has to move the
      // wheels; our own commit must not, or the wheel fights the finger mid-scroll.
      requestAnimationFrame(() => this.position(next, 'auto'));
    });
    // requestAnimationFrame, not the current frame: on the frame the dialog step appears
    // the columns have no scroll height yet, so scrollTop silently clamps to 0.
    afterNextRender(() => requestAnimationFrame(() => this.position(this.parts(), 'auto')));
  }

  protected pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  private position(parts: Parts, behavior: ScrollBehavior): void {
    // A smooth scroll keeps firing events for a while after it is asked for.
    this.ignoreScrollUntil = Date.now() + (behavior === 'smooth' ? 600 : 300);
    clearTimeout(this.settle);
    this.hourCol().nativeElement.scrollTo({ top: (parts.hour - 1) * ITEM, behavior });
    this.minuteCol().nativeElement.scrollTo({ top: parts.minute * ITEM, behavior });
    this.meridiemCol().nativeElement.scrollTo({ top: parts.meridiem * ITEM, behavior });
  }

  /**
   * Read the wheels once scrolling stops.
   *
   * Debounced rather than driven by `scrollend`, which Safari only shipped in 18 — a
   * value that never commits on an older iPhone is exactly the phone this control is for.
   */
  protected onScroll(): void {
    if (Date.now() < this.ignoreScrollUntil) return;
    clearTimeout(this.settle);
    this.settle = setTimeout(() => this.commitFromScroll(), SETTLE_MS);
  }

  private indexOf(el: HTMLElement, max: number): number {
    return Math.max(0, Math.min(max, Math.round(el.scrollTop / ITEM)));
  }

  private commitFromScroll(): void {
    const parts: Parts = {
      hour: this.indexOf(this.hourCol().nativeElement, 11) + 1,
      minute: this.indexOf(this.minuteCol().nativeElement, 59),
      meridiem: this.indexOf(this.meridiemCol().nativeElement, 1) as 0 | 1,
    };
    this.commit(parts);
  }

  private commit(parts: Parts): void {
    // Set the parts first. An effect runs after change detection, so a second arrow key
    // pressed straight after the first would otherwise read the value it just replaced
    // and land one step short.
    this.parts.set(parts);
    const next = toTime(parts);
    if (next === this.value()) return;
    this.committing = true;
    this.value.set(next);
  }

  protected onKey(event: KeyboardEvent, column: keyof Parts): void {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();

    const current = this.parts();
    const next: Parts = { ...current };
    if (column === 'hour') next.hour = ((current.hour - 1 + step + 12) % 12) + 1;
    if (column === 'minute') next.minute = (current.minute + step + 60) % 60;
    if (column === 'meridiem') next.meridiem = (current.meridiem === 1 ? 0 : 1) as 0 | 1;

    this.commit(next);
    this.position(next, 'smooth');
  }
}
