import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
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
   * The scroll offsets we last asked for, per column.
   *
   * The wheel would otherwise fight itself: scrollTo fires `scroll`, the debounced
   * reader takes the position mid-animation, and commits a value nobody chose — that is
   * how a wheel opened on 9:00 AM settled on 9:02 PM, and how an arrow key was undone by
   * its own smooth scroll. Comparing against the requested offsets, rather than gating on
   * a shared deadline, means a flick on the minute column is never swallowed because the
   * hour column happens to be animating.
   */
  private readonly requested = new WeakMap<HTMLElement, { top: number; deadline: number }>();
  private frame?: number;

  constructor() {
    // A timer or a frame that outlives the view would write the parent's signal from a
    // destroyed component — reachable by pressing "Atrás" within the settle window.
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.settle);
      if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    });

    effect(() => {
      const next = parseTime(this.value());
      this.parts.set(next);
      if (this.committing) {
        this.committing = false;
        return;
      }
      // An outside change (opening the dialog on an existing story) has to move the
      // wheels; our own commit must not, or the wheel fights the finger mid-scroll.
      this.frame = requestAnimationFrame(() => this.position(next, 'auto'));
    });
    // requestAnimationFrame, not the current frame: on the frame the dialog step appears
    // the columns have no scroll height yet, so scrollTop silently clamps to 0.
    afterNextRender(() => {
      this.frame = requestAnimationFrame(() => this.position(this.parts(), 'auto'));
    });
  }

  protected pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  private position(parts: Parts, behavior: ScrollBehavior): void {
    clearTimeout(this.settle);
    const targets: [HTMLElement, number][] = [
      [this.hourCol().nativeElement, (parts.hour - 1) * ITEM],
      [this.minuteCol().nativeElement, parts.minute * ITEM],
      [this.meridiemCol().nativeElement, parts.meridiem * ITEM],
    ];
    // The deadline is what stops a column that never arrives from blocking commits
    // forever: the user can scroll a column away from where we sent it, and then it is
    // their position that is correct, not ours.
    const deadline = Date.now() + (behavior === 'smooth' ? 600 : 300);
    for (const [el, top] of targets) {
      this.requested.set(el, { top, deadline });
      el.scrollTo({ top, behavior });
    }
  }

  /** True while this column is still travelling to the offset we asked it for. */
  private isSettling(el: HTMLElement): boolean {
    const target = this.requested.get(el);
    if (!target) return false;
    if (Date.now() > target.deadline) return false;
    return Math.abs(el.scrollTop - target.top) > 1;
  }

  /**
   * Read the wheels once scrolling stops.
   *
   * Debounced rather than driven by `scrollend`, which Safari only shipped in 18 — a
   * value that never commits on an older iPhone is exactly the phone this control is for.
   */
  protected onScroll(): void {
    clearTimeout(this.settle);
    this.settle = setTimeout(() => this.commitFromScroll(), SETTLE_MS);
  }

  private indexOf(el: HTMLElement, max: number): number {
    return Math.max(0, Math.min(max, Math.round(el.scrollTop / ITEM)));
  }

  private commitFromScroll(): void {
    // Any column still animating towards a position we asked for would report a
    // half-way offset, so wait for the next settle instead of reading it now.
    const columns = [
      this.hourCol().nativeElement,
      this.minuteCol().nativeElement,
      this.meridiemCol().nativeElement,
    ];
    if (columns.some((el) => this.isSettling(el))) {
      this.settle = setTimeout(() => this.commitFromScroll(), SETTLE_MS);
      return;
    }
    for (const el of columns) this.requested.delete(el);

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
