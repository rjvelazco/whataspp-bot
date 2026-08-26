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
      (paste)="onPaste($event)"
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
    const host = this.editor().nativeElement;
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

  private isBlock(node: Node): node is HTMLElement {
    return node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P');
  }

  /** Anything that is not a block wrapper: text, a pill, a <br>, an inline element. */
  private inline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof HTMLElement)) return '';
    const token = node.dataset['token'];
    if (token) return `{${token}}`;
    if (node.tagName === 'BR') return '\n';
    return this.blockText(node);
  }

  /**
   * A block's own text.
   *
   * The trailing `<br>` is dropped: browsers put one inside an otherwise-empty block to
   * keep the line open, and counting it as a line break added a newline that was never
   * typed. One press of Enter after "a" produces `a<div><br></div>` — which used to
   * serialize as "a\n\n" and reach the customer with a blank line in it.
   */
  private blockText(el: HTMLElement): string {
    const children = Array.from(el.childNodes);
    if (children.length > 0 && children[children.length - 1].nodeName === 'BR') children.pop();
    return children.map((child) => this.inline(child)).join('');
  }

  /**
   * The whole editor as stored text.
   *
   * Blocks are line *joins*, not prefixes. Treating each as a leading "\n" also put a
   * blank first line on Safari and Firefox, which wrap the entire content in blocks.
   */
  private read(host: HTMLElement): string {
    const lines: string[] = [];
    let leading = '';
    let seenBlock = false;

    for (const child of Array.from(host.childNodes)) {
      if (this.isBlock(child)) {
        seenBlock = true;
        lines.push(this.blockText(child));
      } else if (!seenBlock) {
        leading += this.inline(child);
      } else {
        // A stray inline node after a block belongs to that block's line.
        lines[lines.length - 1] += this.inline(child);
      }
    }

    if (!seenBlock) return leading;
    // No leading text means the content starts with a wrapper, so there is no first line
    // to keep — emitting one would prepend a blank line that nobody typed.
    return leading === '' ? lines.join('\n') : [leading, ...lines].join('\n');
  }

  /**
   * Paste as plain text.
   *
   * Rich HTML brings nodes this editor has no representation for — a pasted image
   * serialized to nothing at all, so it showed in the editor and vanished on save.
   */
  protected onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range) return;
    range.deleteContents();
    // insertNode reverses multi-node inserts, so build the fragment and insert once.
    const fragment = document.createDocumentFragment();
    text.split('\n').forEach((line, i) => {
      if (i > 0) fragment.append(document.createElement('br'));
      if (line) fragment.append(document.createTextNode(line));
    });
    const last = fragment.lastChild;
    range.insertNode(fragment);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    this.onInput();
  }

  protected onInput(): void {
    const host = this.editor().nativeElement;
    const out = this.read(host);
    if (out === this.value()) return;
    this.typing = true;
    this.value.set(out);
  }

  /** Drop a pill in at the caret, or at the end when the caret is elsewhere. */
  protected insert(token: TokenChoice): void {
    const host = this.editor().nativeElement;
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
