import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import {
  StoreService,
  type BotPreview,
  type RateSource,
  type Store,
  type StoreKeywords,
  type StoreUpdate,
} from '../store.service';
import { apiErrorMessage } from '../api-error';
import { Card, KeywordChips, PageHead, Toolbar } from '../ui';

type PaymentKey = 'pago_movil' | 'zelle' | 'binance';
type KeywordTopic = keyof StoreKeywords;
type SectionId = 'general' | 'ubicacion' | 'envios' | 'tasa' | 'pagos';

/**
 * The four rate sources, in the order the dropdown offers them.
 *
 * Each carries its own unit and its own one-line note, because the note is the thing
 * that answers the owner's real question: do I have to update this myself? Three of the
 * four do not — FEEDBACK assumed the parallel rate was manual, but dolarapi serves it.
 */
const RATE_SOURCES: {
  value: RateSource;
  label: string;
  unit: string;
  note: string;
}[] = [
  {
    value: 'usd_oficial',
    label: 'Dólar oficial',
    unit: 'Bs. por $1',
    note: 'Se actualiza sola varias veces al día.',
  },
  {
    value: 'usd_paralelo',
    label: 'Dólar paralelo',
    unit: 'Bs. por $1',
    note: 'Se actualiza sola varias veces al día.',
  },
  {
    value: 'eur_oficial',
    label: 'Euro oficial',
    unit: 'Bs. por €1',
    note: 'Se actualiza sola varias veces al día.',
  },
  {
    value: 'custom',
    label: 'Personalizada',
    unit: 'Bs. por $1',
    note: 'La escribes tú. El bot nunca la cambia.',
  },
];

/** Which keyword topics belong to which tab, and how each is introduced. */
const SECTION_KEYWORDS: Record<SectionId, { topic: KeywordTopic; title: string }[]> = {
  general: [
    { topic: 'hours', title: 'Horario' },
    { topic: 'offers', title: 'Ofertas y promociones' },
  ],
  ubicacion: [{ topic: 'address', title: 'Dirección' }],
  envios: [{ topic: 'shipping', title: 'Envíos' }],
  tasa: [{ topic: 'rate', title: 'Tasa del día' }],
  pagos: [{ topic: 'payment', title: 'Métodos de pago' }],
};

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
  rate_source: RateSource;
  rate_label: string;
  keywords: StoreKeywords;
  payments: Record<PaymentKey, string>;
  enabled: Record<PaymentKey, boolean>;
}

const EMPTY_KEYWORDS: StoreKeywords = {
  rate: [],
  address: [],
  shipping: [],
  payment: [],
  offers: [],
  hours: [],
};

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
    rate_source: 'usd_oficial',
    rate_label: '',
    keywords: { ...EMPTY_KEYWORDS },
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
    rate_source: store.rate_source ?? 'usd_oficial',
    rate_label: store.rate_label ?? '',
    keywords: { ...EMPTY_KEYWORDS, ...(store.keywords ?? {}) },
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
    DrawerModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    ToggleSwitchModule,
    PageHead,
    Card,
    Toolbar,
    KeywordChips,
  ],
  templateUrl: './tienda.html',
  styleUrl: './tienda.css',
})
export class Tienda implements OnInit {
  private readonly api = inject(StoreService);
  private readonly messages = inject(MessageService);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly refreshingRate = signal(false);
  protected readonly rateUpdatedAt = signal<string | null>(null);
  protected readonly rateFailedAt = signal<string | null>(null);
  protected readonly form = signal<TiendaForm>(blank());

  /** Serialized last-saved payload; drives the "Cambios sin guardar" indicator. */
  private readonly savedJson = signal('');

  protected readonly rateSources = RATE_SOURCES;

  /**
   * A horizontal rail above the form, replacing the right-hand "Secciones" list — 320px
   * spent to render five links — and the scroll-spy that drove it.
   */
  protected readonly sections: { id: SectionId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ubicacion', label: 'Ubicación' },
    { id: 'envios', label: 'Envíos y cambios' },
    { id: 'tasa', label: 'Tasa del dólar' },
    { id: 'pagos', label: 'Métodos de pago' },
  ];
  protected readonly activeSection = signal<SectionId>('general');
  protected readonly sectionKeywords = computed(() => SECTION_KEYWORDS[this.activeSection()]);

  /** Payment methods (order + labels); the bot treats a non-empty value as enabled. */
  protected readonly paymentMethods: { key: PaymentKey; label: string; placeholder: string }[] = [
    { key: 'pago_movil', label: 'Pago Móvil', placeholder: '0102 / V-12345678 / 0412XXXXXXX' },
    { key: 'zelle', label: 'Zelle', placeholder: 'correo@zelle.com' },
    { key: 'binance', label: 'Binance', placeholder: 'usuario_binance' },
  ];

  // --- bot preview drawer ---
  protected readonly previewOpen = signal(false);
  protected readonly preview = signal<BotPreview | null>(null);
  protected readonly previewLoading = signal(false);

  protected readonly rateChoice = computed(
    () => RATE_SOURCES.find((s) => s.value === this.form().rate_source) ?? RATE_SOURCES[0],
  );
  protected readonly rateIsManual = computed(() => this.form().rate_source === 'custom');

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
  protected patchKeywords(topic: KeywordTopic, words: string[]): void {
    this.form.update((f) => ({ ...f, keywords: { ...f.keywords, [topic]: words } }));
  }
  protected wordsFor(topic: KeywordTopic): string[] {
    return this.form().keywords[topic] ?? [];
  }

  private setForm(store: Store): void {
    this.form.set(normalizeStore(store));
    this.rateUpdatedAt.set(store.usd_rate_updated_at ?? null);
    this.rateFailedAt.set(store.rate_failed_at ?? null);
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
      rate_source: f.rate_source,
      // Only a custom rate carries a label; the server drops it for the other sources.
      rate_label: f.rate_source === 'custom' ? f.rate_label : '',
      keywords: f.keywords,
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

  /** Any topic left with no words would silently stop the bot answering it. */
  protected readonly emptyTopics = computed(() =>
    (Object.keys(EMPTY_KEYWORDS) as KeywordTopic[]).filter(
      (topic) => this.wordsFor(topic).length === 0,
    ),
  );

  protected openPreview(): void {
    this.previewOpen.set(true);
    this.previewLoading.set(true);
    // Built by the bot's own reply builders against this draft, rather than re-typed
    // here — the panel's own copies had already drifted from what the bot said.
    this.api.preview(this.payload()).subscribe({
      next: (p) => {
        this.preview.set(p);
        this.previewLoading.set(false);
      },
      error: () => {
        this.previewLoading.set(false);
        this.messages.add({ severity: 'error', summary: 'No se pudo cargar la vista previa' });
      },
    });
  }

  protected refreshRate(): void {
    this.refreshingRate.set(true);
    this.api.refreshRate().subscribe({
      next: (r) => {
        this.refreshingRate.set(false);
        this.rateUpdatedAt.set(r.usd_rate_updated_at);
        this.rateFailedAt.set(r.rate_failed_at);
        if (r.outcome === 'failed') {
          this.messages.add({
            severity: 'warn',
            summary: 'No se pudo actualizar',
            detail: 'Se mantiene la última tasa que teníamos.',
          });
          return;
        }
        if (r.usd_rate !== null) {
          this.form.update((f) => ({ ...f, usd_rate: r.usd_rate }));
          this.savedJson.set(JSON.stringify(this.payload()));
        }
        this.messages.add({
          severity: 'success',
          summary: r.outcome === 'unchanged' ? 'La tasa ya estaba al día' : 'Tasa actualizada',
        });
      },
      error: () => {
        this.refreshingRate.set(false);
        this.messages.add({ severity: 'error', summary: 'No se pudo actualizar la tasa' });
      },
    });
  }

  protected save(): void {
    if (this.emptyTopics().length > 0) {
      this.messages.add({
        severity: 'warn',
        summary: 'Faltan palabras clave',
        detail: 'Cada tema necesita al menos una palabra para que el bot pueda responder.',
      });
      return;
    }
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
