import { Injectable, signal } from '@angular/core';

/** Connection status pushed from the bot over Server-Sent Events. */
export type Status =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'qr'; qrDataUrl: string }
  | { state: 'open'; accountId: string };

@Injectable({ providedIn: 'root' })
export class ConnectionService {
  /** Live WhatsApp connection status, updated from the SSE stream. */
  readonly status = signal<Status>({ state: 'idle' });
  private source?: EventSource;

  /** Open the SSE stream once; safe to call repeatedly. */
  start(): void {
    if (this.source) return;
    this.source = new EventSource('/api/events');
    this.source.onmessage = (event) => {
      this.status.set(JSON.parse(event.data) as Status);
    };
    // On error the browser auto-reconnects; nothing to do.
  }

  /** Pretty phone number from a WhatsApp jid like "58412...:12@s.whatsapp.net". */
  static accountNumber(accountId: string): string {
    return '+' + accountId.replace(/[:@].*$/, '');
  }
}
