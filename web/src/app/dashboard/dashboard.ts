import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
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
  private readonly http = inject(HttpClient);
  private readonly confirm = inject(ConfirmationService);
  private readonly messages = inject(MessageService);
  protected readonly connected = computed(() => this.conn.status().state === 'open');

  ngOnInit(): void {
    this.store.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.store.stopAutoRefresh();
  }

  protected disconnect(): void {
    this.confirm.confirm({
      header: 'Desconectar WhatsApp',
      message:
        'Se desvinculará el bot de WhatsApp. Tendrás que escanear el QR de nuevo para volver a conectarlo (mismo número u otro). ¿Continuar?',
      icon: 'pi pi-power-off',
      acceptLabel: 'Sí, desconectar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.http.post('/api/disconnect', {}).subscribe();
        this.messages.add({
          severity: 'info',
          summary: 'Desconectando…',
          detail: 'Aparecerá un nuevo QR para vincular.',
        });
      },
    });
  }
}
