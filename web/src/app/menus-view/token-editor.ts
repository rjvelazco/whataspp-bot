import {
  Component,
  ElementRef,
  afterNextRender,
  effect,
  input,
  model,
  viewChild,
} from '@angular/core';
import type { MessageToken } from '../api-types';

/**
 * A message editor where every variable is a pill.
 *
 * The bot's templates genuinely need substitution, but a shop owner must never be shown
 * `{store_name}`. So the stored form is unchanged — `"¡Hola! Bienvenid@ a {store_name}."`
 * — and this component is the only place that translates between it and something a
 * person can read.
 *
 * A pill is `contenteditable="false"`, so it deletes as one unit and cannot be typed
 * into and half-broken.
 */

export interface TokenChoice {
  name: MessageToken;
  label: string;
}

@Component({
  selector: 'app-token-editor',
  template: `
    <div
      #editor
      class="editor"
      role="textbox"
      aria-multiline="true"
      [attr.aria-label]="label()"
      contenteditable="true"
      (input)="onInput()"
      (blur)="onInput()"
    ></div>

    <div class="insert">
      <span class="insert-label">Insertar:</span>
      @for (t of tokens(); track t.name) {
        <button type="button" class="insert-chip" (click)="insert(t)">
          <i class="pi pi-plus" aria-hidden="true"></i>
          {{ t.label }}
        </button>
      }
    </div>
  `,
  styleUrl: './token-editor.css',
})
export class TokenEditor {
  /** The stored message, with `{tokens}` in it. */
  readonly value = model.required<string>();
  readonly tokens = input.required<TokenChoice[]>();
  readonly label = input('Mensaje');

  private readonly editor = viewChild.required<ElementRef<HTMLElement>>('editor');
  /** Set while we are the source of the change, so rendering never fights the caret. */
  private typing = false;

  constructor() {
    afterNextRender(() => this.render());
    effect(() => {
      this.value();
      if (this.typing) {
        this.typing = false;
        return;
      }
      // An outside change (opening the editor on another menu) has to repaint; our own
      // keystrokes must not, or the caret jumps to the start on every character.
      queueMicrotask(() => this.render());
    });
  }

  private labelFor(name: string): string | undefined {
    return this.tokens().find((t) => t.name === name)?.label;
  }

  private pill(name: string, label: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'pill';
    el.dataset['token'] = name;
    el.contentEditable = 'false';
    el.textContent = label;
    return el;
  }

  /** Stored text -> pills and text nodes. */
  private render(): void {
    const host = this.editor()?.nativeElement;
    if (!host) return;
    host.replaceChildren();
    for (const part of (this.value() ?? '').split(/(\{[a-z_]+\})/)) {
      if (!part) continue;
      const match = /^\{([a-z_]+)\}$/.exec(part);
      const label = match ? this.labelFor(match[1]) : undefined;
      if (match && label) {
        host.append(this.pill(match[1], label));
        continue;
      }
      // A token nobody has a name for stays as literal text rather than vanishing.
      const lines = part.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) host.append(document.createElement('br'));
        if (line) host.append(document.createTextNode(line));
      });
    }
  }

  /** Pills and text nodes -> stored text. */
  private serialize(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof HTMLElement)) return '';
    const token = node.dataset['token'];
    if (token) return `{${token}}`;
    if (node.tagName === 'BR') return '\n';

    let inner = '';
    for (const child of Array.from(node.childNodes)) inner += this.serialize(child);
    // contenteditable wraps every line after the first in its own div; that wrapper is
    // the line break, and reading it as plain text would join the lines together.
    return node.tagName === 'DIV' || node.tagName === 'P' ? `\n${inner}` : inner;
  }

  protected onInput(): void {
    const host = this.editor()?.nativeElement;
    if (!host) return;
    let out = '';
    for (const child of Array.from(host.childNodes)) out += this.serialize(child);
    if (out === this.value()) return;
    this.typing = true;
    this.value.set(out);
  }

  /** Drop a pill in at the caret, or at the end when the caret is elsewhere. */
  protected insert(token: TokenChoice): void {
    const host = this.editor()?.nativeElement;
    if (!host) return;
    const pill = this.pill(token.name, token.label);
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;

    if (range && host.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(pill);
      // Leave the caret after the pill, so typing continues where the eye is.
      range.setStartAfter(pill);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      host.append(pill);
    }
    host.focus();
    this.onInput();
  }
}
