import { DatePipe } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { StoreService, type Store, type StoreUpdate } from '../store.service';
import { apiErrorMessage } from '../api-error';

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

/** Server shape → form shape: nulls become empty strings, values imply "enabled". */
function normalizeStore(store: Store): TiendaForm {
  const payments = {
    pago_movil: store.payments?.pago_movil ?? '',
    zelle: store.payments?.zelle ?? '',
    binance: store.payments?.binance ?? '',
  };
  return {
    store_name: store.store_name ?? '',
    owner_name: store.owner_name ?? '',
    owner_whatsapp: store.owner_whatsapp ?? '',
    address: store.address ?? '',
    maps_url: store.maps_url ?? '',
    hours: store.hours ?? '',
    delivery_info: store.delivery_info ?? '',
    returns_policy: store.returns_policy ?? '',
    usd_rate: store.usd_rate ?? null,
    payments,
    // A method is "on" when it already has a value.
    enabled: {
      pago_movil: !!payments.pago_movil,
      zelle: !!payments.zelle,
      binance: !!payments.binance,
    },
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
export class Tienda implements OnInit, OnDestroy {
  private readonly api = inject(StoreService);
  private readonly messages = inject(MessageService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly rateUpdatedAt = signal<string | null>(null);
  protected readonly form = signal<TiendaForm>(blank());

  /** Serialized last-saved payload; drives the "Cambios sin guardar" indicator. */
  private readonly savedJson = signal('');

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

  /** The rendered <section> elements, for the scroll-spy and the navigator. */
  private readonly sectionEls = viewChildren<ElementRef<HTMLElement>>('section');
  private observer?: IntersectionObserver;

  constructor() {
    // The sections live inside the @else of @if (loading()), so they don't exist
    // when the component first renders. Re-running after every render is what
    // makes the scroll-spy actually attach once the store has loaded.
    afterRenderEffect(() => {
      const els = this.sectionEls();
      this.observer?.disconnect();
      if (!els.length) return;
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset['section'];
            if (e.isIntersecting && id) this.activeSection.set(id);
          }
        },
        { root: this.scrollRoot(), rootMargin: '-8% 0px -80% 0px', threshold: 0 },
      );
      for (const el of els) this.observer.observe(el.nativeElement);
    });
  }

  /**
   * Nearest scrolling ancestor, found by walking up from our own element.
   * Deliberately not a `.content` lookup: that class belongs to the dashboard
   * shell, and renaming it there would silently break the scroll-spy here.
   */
  private scrollRoot(): Element | null {
    let el = this.host.nativeElement.parentElement;
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return el;
      el = el.parentElement;
    }
    return null; // fall back to the viewport
  }

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

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  protected scrollTo(id: string): void {
    this.activeSection.set(id);
    this.sectionEls()
      .find((el) => el.nativeElement.dataset['section'] === id)
      ?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- form writes (explicit, so `form` can stay a signal) ----
  protected patch<K extends keyof TiendaForm>(key: K, value: TiendaForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }
  protected patchPayment(key: PaymentKey, value: string): void {
    this.form.update((f) => ({ ...f, payments: { ...f.payments, [key]: value } }));
  }
  protected patchEnabled(key: PaymentKey, value: boolean): void {
    this.form.update((f) => ({ ...f, enabled: { ...f.enabled, [key]: value } }));
  }

  private setForm(store: Store): void {
    this.form.set(normalizeStore(store));
    this.rateUpdatedAt.set(store.usd_rate_updated_at ?? null);
    this.savedJson.set(JSON.stringify(this.payload()));
  }

  /** The exact payload we would PUT — also the baseline for dirty tracking. */
  private readonly payload = computed<StoreUpdate>(() => {
    const f = this.form();
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
  });

  protected readonly dirty = computed(
    () => !this.loading() && JSON.stringify(this.payload()) !== this.savedJson(),
  );

  // ---- live preview helpers (mirror the bot's real responses) ----
  protected readonly ratePreview = computed(() => {
    const rate = this.form().usd_rate;
    return rate != null
      ? `Hoy la tasa está en Bs. ${rate} por $1.`
      : 'Aún no has puesto la tasa del día.';
  });
  protected readonly addressPreview = computed(() => {
    const address = this.form().address?.trim();
    return address ? `Estamos en: ${address}` : 'Aún no hay dirección.';
  });
  protected readonly shippingPreview = computed(() => {
    const info = this.form().delivery_info?.trim();
    return info ? info : 'Aún no hay información de envíos.';
  });

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
          detail: apiErrorMessage(e),
        });
      },
    });
  }
}
