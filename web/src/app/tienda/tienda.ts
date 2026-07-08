import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { StoreService, type Store } from '../store.service';

interface TiendaForm {
  store_name: string;
  owner_name: string;
  owner_whatsapp: string;
  address: string;
  maps_url: string;
  hours: string;
  delivery_info: string;
  returns_policy: string;
  usd_rate: number | null;
  payments: { pago_movil: string; zelle: string; binance: string };
}

function blank(): TiendaForm {
  return {
    store_name: '',
    owner_name: '',
    owner_whatsapp: '',
    address: '',
    maps_url: '',
    hours: '',
    delivery_info: '',
    returns_policy: '',
    usd_rate: null,
    payments: { pago_movil: '', zelle: '', binance: '' },
  };
}

@Component({
  selector: 'app-tienda',
  imports: [FormsModule],
  templateUrl: './tienda.html',
  styleUrl: './tienda.css',
})
export class Tienda implements OnInit {
  private readonly api = inject(StoreService);
  private readonly messages = inject(MessageService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly rateUpdatedAt = signal<string | null>(null);
  protected form: TiendaForm = blank();

  ngOnInit(): void {
    this.api.get().subscribe({
      next: (store) => {
        this.setForm(store);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.messages.add({ severity: 'error', summary: 'No se pudo cargar la tienda' });
      },
    });
  }

  private setForm(store: Store): void {
    this.form = {
      store_name: store.store_name ?? '',
      owner_name: store.owner_name ?? '',
      owner_whatsapp: store.owner_whatsapp ?? '',
      address: store.address ?? '',
      maps_url: store.maps_url ?? '',
      hours: store.hours ?? '',
      delivery_info: store.delivery_info ?? '',
      returns_policy: store.returns_policy ?? '',
      usd_rate: store.usd_rate ?? null,
      payments: {
        pago_movil: store.payments?.pago_movil ?? '',
        zelle: store.payments?.zelle ?? '',
        binance: store.payments?.binance ?? '',
      },
    };
    this.rateUpdatedAt.set(store.usd_rate_updated_at ?? null);
  }

  protected rateDate(): string {
    const iso = this.rateUpdatedAt();
    return iso ? iso.slice(0, 10) : 'nunca';
  }

  protected save(): void {
    this.saving.set(true);
    this.api.save(this.form).subscribe({
      next: (store) => {
        this.saving.set(false);
        this.setForm(store);
        this.messages.add({ severity: 'success', summary: 'Tienda actualizada' });
      },
      error: (e) => {
        this.saving.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'No se pudo guardar',
          detail: e?.error?.error ?? '',
        });
      },
    });
  }
}
