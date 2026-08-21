import { Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
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

  /**
   * The active path, as a signal. Seeded from the browser URL because router.url
   * is still "/" until the initial navigation finishes on reload — reading only
   * that would clobber a deep link like /dashboard/configuracion. Kept reactive
   * afterwards so the routing effect re-runs when navigation resolves, not just
   * when the connection status changes.
   */
  private readonly path = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: window.location.pathname },
  );

  constructor() {
    this.conn.start();
    // Route by connection status WITHOUT clobbering the current route on reload:
    //  - only enter the panel from the pairing page (preserves a deep link)
    //  - only kick back to pairing on a real "needs pairing" (qr) signal, never on
    //    the transient idle/connecting state right after a reload.
    effect(() => {
      const state = this.conn.status().state;
      const path = this.path().split('?')[0].replace(/\/$/, '') || '/';
      const onPairing = path === '/';
      // Exact segment match, so "/dashboardfoo" isn't treated as the panel.
      const onDashboard = path === '/dashboard' || path.startsWith('/dashboard/');

      if (state === 'open' && onPairing) {
        this.router.navigateByUrl('/dashboard');
      } else if (state === 'qr' && onDashboard) {
        this.router.navigateByUrl('/');
      }
    });
  }
}
