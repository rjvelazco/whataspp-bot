import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConnectionService } from '../connection.service';
import { OrdersStore } from '../orders.store';

@Component({
  selector: 'app-dashboard',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastModule, ConfirmDialogModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit, OnDestroy {
  protected readonly conn = inject(ConnectionService);
  protected readonly store = inject(OrdersStore);
  protected readonly connected = computed(() => this.conn.status().state === 'open');

  ngOnInit(): void {
    this.store.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.store.stopAutoRefresh();
  }
}
