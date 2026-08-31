import { Component, ElementRef, input, model, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * An editable row of words.
 *
 * Shared by Tienda (what customers type to reach an answer) and Menús (what opens a
 * menu). Follows the border rule: a word that exists gets a solid chip, and the control
 * that creates one is dashed.
 */
@Component({
  selector: 'app-keyword-chips',
  imports: [FormsModule],
  template: `
    <div class="chips" role="group" [attr.aria-label]="label()">
      @for (word of words(); track $index) {
        <span class="chip">
          {{ word }}
          <button
            type="button"
            class="chip-x"
            [attr.aria-label]="'Quitar ' + word"
            (mousedown)="$event.preventDefault()"
            (click)="remove(word)"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </span>
      }

      @if (adding()) {
        <input
          #entry
          class="chip-input"
          type="text"
          [attr.aria-label]="addLabel()"
          [(ngModel)]="draft"
          (keydown.enter)="commit(true)"
          (keydown.escape)="cancel()"
          (blur)="commit()"
        />
      } @else {
        <button type="button" class="chip-add" (click)="start()">
          <i class="pi pi-plus" aria-hidden="true"></i>
          {{ addLabel() }}
        </button>
      }
    </div>
  `,
  styleUrl: './keyword-chips.css',
})
export class KeywordChips {
  readonly words = model.required<string[]>();
  readonly label = input('Palabras');
  readonly addLabel = input('Agregar palabra');

  protected readonly adding = signal(false);
  protected draft = '';
  private readonly entry = viewChild<ElementRef<HTMLInputElement>>('entry');

  protected start(): void {
    this.adding.set(true);
    // The input does not exist until this render, so focus on the next frame.
    requestAnimationFrame(() => this.entry()?.nativeElement.focus());
  }

  protected cancel(): void {
    this.draft = '';
    this.adding.set(false);
  }

  /**
   * @param keepOpen after Enter, so several words can be added in a row without
   * re-clicking the button.
   *
   * The ✕ on a chip cancels its own mousedown, or this blur handler would tear the
   * input out from under the click and the removal would never fire.
   */
  protected commit(keepOpen = false): void {
    const word = this.draft.trim();
    this.draft = '';
    if (!keepOpen) this.adding.set(false);
    if (!word) return;
    // Compared case-insensitively: the server normalizes anyway, so "Envíos" and
    // "envios" would arrive as one word and the second chip would vanish on reload.
    const exists = this.words().some((w) => w.toLowerCase() === word.toLowerCase());
    if (exists) return;
    this.words.update((list) => [...list, word]);
    if (keepOpen) requestAnimationFrame(() => this.entry()?.nativeElement.focus());
  }

  protected remove(word: string): void {
    this.words.update((list) => list.filter((w) => w !== word));
  }
}
