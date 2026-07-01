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
    // Route by connection status: enter the panel once linked, back to pairing if it drops.
    effect(() => {
      const linked = this.conn.status().state === 'open';
      const onDashboard = this.router.url.startsWith('/dashboard');
      if (linked && !onDashboard) this.router.navigateByUrl('/dashboard');
      else if (!linked && onDashboard) this.router.navigateByUrl('/');
    });
  }
}
