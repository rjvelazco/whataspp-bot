import { DatePipe } from '@angular/common';
import { AfterViewInit, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { StoreService, type Store, type StoreUpdate } from '../store.service';

type PaymentKey = 'pago_movil' | 'zelle' | 'binance';

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
  payments: Record<PaymentKey, string>;
  enabled: Record<PaymentKey, boolean>;
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
    enabled: { pago_movil: false, zelle: false, binance: false },
  };
}

@Component({
  selector: 'app-tienda',
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    ToggleSwitchModule,
  ],
  templateUrl: './tienda.html',
  styleUrl: './tienda.css',
})
export class Tienda implements OnInit, AfterViewInit, OnDestroy {
  private readonly api = inject(StoreService);
  private readonly messages = inject(MessageService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly rateUpdatedAt = signal<string | null>(null);
  protected form: TiendaForm = blank();

  /** Serialized last-saved payload; drives the "Cambios sin guardar" indicator. */
  private savedJson = '';

  /** Right-hand section navigator. */
  protected readonly sections = [
    { id: 'general', label: 'General' },
    { id: 'ubicacion', label: 'Ubicación' },
    { id: 'envios', label: 'Envíos y cambios' },
    { id: 'tasa', label: 'Tasa del dólar' },
    { id: 'pagos', label: 'Métodos de pago' },
  ];
  protected readonly activeSection = signal('general');

  /** Payment methods (order + labels); the bot treats a non-empty value as enabled. */
  protected readonly paymentMethods: { key: PaymentKey; label: string; placeholder: string }[] = [
    { key: 'pago_movil', label: 'Pago Móvil', placeholder: '0102 / V-12345678 / 0412XXXXXXX' },
    { key: 'zelle', label: 'Zelle', placeholder: 'correo@zelle.com' },
    { key: 'binance', label: 'Binance', placeholder: 'usuario_binance' },
  ];

  /** Hardcoded bot keywords, shown as read-only "El bot responde a" hints. */
  protected readonly keywords = {
    address: ['direccion', 'ubicacion'],
    shipping: ['envio', 'envios', 'delivery'],
    rate: ['tasa', 'dolar'],
  };

  private observer?: IntersectionObserver;

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

  ngAfterViewInit(): void {
    // Scroll-spy: highlight the section nearest the top of the scroll area.
    const root = document.querySelector('.content');
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) this.activeSection.set(e.target.id.replace('sec-', ''));
        }
      },
      { root, rootMargin: '-8% 0px -80% 0px', threshold: 0 },
    );
    for (const s of this.sections) {
      const el = document.getElementById('sec-' + s.id);
      if (el) this.observer.observe(el);
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  protected scrollTo(id: string): void {
    this.activeSection.set(id);
    document.getElementById('sec-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private setForm(store: Store): void {
    const pm = {
      pago_movil: store.payments?.pago_movil ?? '',
      zelle: store.payments?.zelle ?? '',
      binance: store.payments?.binance ?? '',
    };
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
      payments: pm,
      // A method is "on" when it already has a value.
      enabled: { pago_movil: !!pm.pago_movil, zelle: !!pm.zelle, binance: !!pm.binance },
    };
    this.rateUpdatedAt.set(store.usd_rate_updated_at ?? null);
    this.savedJson = JSON.stringify(this.payload());
  }

  /** The exact payload we would PUT — also the baseline for dirty tracking. */
  private payload(): StoreUpdate {
    const f = this.form;
    return {
      store_name: f.store_name,
      owner_name: f.owner_name,
      owner_whatsapp: f.owner_whatsapp,
      hours: f.hours,
      delivery_info: f.delivery_info,
      returns_policy: f.returns_policy,
      address: f.address,
      maps_url: f.maps_url,
      usd_rate: f.usd_rate,
      payments: {
        pago_movil: f.enabled.pago_movil ? f.payments.pago_movil : '',
        zelle: f.enabled.zelle ? f.payments.zelle : '',
        binance: f.enabled.binance ? f.payments.binance : '',
      },
    };
  }

  protected dirty(): boolean {
    return !this.loading() && JSON.stringify(this.payload()) !== this.savedJson;
  }

  // ---- live preview helpers (mirror the bot's real responses) ----
  protected ratePreview(): string {
    return this.form.usd_rate != null
      ? `Hoy la tasa está en Bs. ${this.form.usd_rate} por $1.`
      : 'Aún no has puesto la tasa del día.';
  }
  protected addressPreview(): string {
    return this.form.address?.trim() ? `Estamos en: ${this.form.address}` : 'Aún no hay dirección.';
  }
  protected shippingPreview(): string {
    return this.form.delivery_info?.trim()
      ? this.form.delivery_info
      : 'Aún no hay información de envíos.';
  }

  protected save(): void {
    this.saving.set(true);
    this.api.save(this.payload()).subscribe({
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
