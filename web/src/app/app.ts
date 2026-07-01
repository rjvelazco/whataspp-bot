import { Component, OnDestroy, OnInit, signal } from '@angular/core';

/** Connection status pushed from the bot over Server-Sent Events. */
type Status =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'qr'; qrDataUrl: string }
  | { state: 'open'; accountId: string };

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  protected readonly status = signal<Status>({ state: 'idle' });
  private source?: EventSource;

  ngOnInit(): void {
    this.source = new EventSource('/api/events');
    this.source.onmessage = (event) => {
      this.status.set(JSON.parse(event.data) as Status);
    };
    // On error the browser auto-reconnects; nothing to do.
  }

  ngOnDestroy(): void {
    this.source?.close();
  }

  /** Pretty phone number from a WhatsApp jid like "58412...:12@s.whatsapp.net". */
  protected accountNumber(accountId: string): string {
    return '+' + accountId.replace(/[:@].*$/, '');
  }
}
