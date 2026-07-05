import { Component, effect, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ConnectionService } from './connection.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly conn = inject(ConnectionService);
  private readonly router = inject(Router);

  constructor() {
    this.conn.start();
    // Route by connection status WITHOUT clobbering the current route on reload:
    //  - only enter the panel from the pairing page (preserves a deep link like /dashboard/pedidos)
    //  - only kick back to pairing on a real "needs pairing" (qr) signal, never on the
    //    transient idle/connecting state that happens right after a reload.
    effect(() => {
      const state = this.conn.status().state;
      const url = this.router.url;
      const onPairing = url === '/' || url === '';

      if (state === 'open' && onPairing) {
        this.router.navigateByUrl('/dashboard');
      } else if (state === 'qr' && url.startsWith('/dashboard')) {
        this.router.navigateByUrl('/');
      }
    });
  }
}
