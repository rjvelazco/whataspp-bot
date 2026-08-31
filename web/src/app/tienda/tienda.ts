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
  type RateSourceOption,
  type Store,
  type StoreKeywords,
  type StoreUpdate,
} from '../store.service';
import { apiErrorMessage } from '../api-error';
import { Card, KeywordChips, PageHead, Toolbar } from '../ui';
import { MapPicker } from './map-picker';

type PaymentKey = 'pago_movil' | 'zelle' | 'binance';
type KeywordTopic = keyof StoreKeywords;
type SectionId = 'general' | 'ubicacion' | 'envios' | 'tasa' | 'pagos';

/** What each topic is called when we have to name it in a message. */
const TOPIC_NAMES: Record<KeywordTopic, string> = {
  rate: 'Tasa del día',
  address: 'Dirección',
  shipping: 'Envíos',
  payment: 'Métodos de pago',
  offers: 'Ofertas y promociones',
  hours: 'Horario',
};

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
    MapPicker,
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

  /**
   * Served by the API rather than retyped here: the labels and the "Bs. por €1" unit
   * derive from the same table the bot quotes from.
   */
  protected readonly rateSources = signal<RateSourceOption[]>([]);

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
  protected readonly sectionKeywords = computed(() => {
    const keywords = this.form().keywords;
    return SECTION_KEYWORDS[this.activeSection()].map((k) => ({
      ...k,
      words: keywords[k.topic] ?? [],
    }));
  });

  /** Payment methods (order + labels); the bot treats a non-empty value as enabled. */
  protected readonly paymentMethods: { key: PaymentKey; label: string; placeholder: string }[] = [
    { key: 'pago_movil', label: 'Pago Móvil', placeholder: '0102 / V-12345678 / 0412XXXXXXX' },
    { key: 'zelle', label: 'Zelle', placeholder: 'correo@zelle.com' },
    { key: 'binance', label: 'Binance', placeholder: 'usuario_binance' },
  ];

  /** The map picker only ever writes the link; the typed address is left alone. */
  protected readonly mapOpen = signal(false);

  // --- bot preview drawer ---
  protected readonly previewOpen = signal(false);
  protected readonly preview = signal<BotPreview | null>(null);
  protected readonly previewLoading = signal(false);

  /**
   * Null until the sources arrive from the API.
   *
   * The type is annotated rather than inferred: `sources[0]` is typed as present
   * because `noUncheckedIndexedAccess` is off, so the inferred type claimed this can
   * never be null — and the template's `?.`, which is what actually keeps the first
   * render from throwing, read as redundant (NG8107).
   */
  protected readonly rateChoice = computed<RateSourceOption | null>(() => {
    const sources = this.rateSources();
    if (sources.length === 0) return null;
    return sources.find((s) => s.value === this.form().rate_source) ?? sources[0];
  });
  protected readonly rateIsManual = computed(() => this.form().rate_source === 'custom');

  ngOnInit(): void {
    this.api.rateSources().subscribe({
      next: (sources) => this.rateSources.set(sources),
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar las tasas' }),
    });
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

  /**
   * Changing the source clears the number.
   *
   * The rate belongs to the feed it came from, so leaving it on screen showed the
   * dollar rate under "Bs. por €1". The server fetches the new one on save; a custom
   * rate keeps whatever is there, because that number is the owner's.
   */
  protected patchRateSource(source: RateSource): void {
    this.form.update((f) => ({
      ...f,
      rate_source: source,
      usd_rate: source === 'custom' ? f.usd_rate : null,
    }));
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
      // Only a custom rate is ours to send. For a fetched source the number in the form
      // is whatever was on screen at page load, and PUT treats a present value as an
      // edit — so saving an address would roll back a rate the refresh had just fetched
      // and stamp it as current.
      ...(f.rate_source === 'custom' ? { usd_rate: f.usd_rate } : {}),
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
  protected readonly emptyTopics = computed(() => {
    const keywords = this.form().keywords;
    return (Object.keys(EMPTY_KEYWORDS) as KeywordTopic[]).filter(
      (topic) => (keywords[topic] ?? []).length === 0,
    );
  });

  /** Built once per preview rather than as a literal rebuilt on every CD pass. */
  protected readonly previewBlocks = computed(() => {
    const p = this.preview();
    if (!p) return [];
    return [
      { title: 'Tasa del día', body: p.rate },
      { title: 'Dirección', body: p.address },
      { title: 'Envíos', body: p.shipping },
      { title: 'Métodos de pago', body: p.payment },
      { title: 'Horario', body: p.hours },
    ];
  });

  /** Arrow keys move between tabs, as the tablist pattern requires. */
  protected focusTab(delta: number, event: Event): void {
    event.preventDefault();
    const ids = this.sections.map((s) => s.id);
    const next = ids[(ids.indexOf(this.activeSection()) + delta + ids.length) % ids.length];
    this.activeSection.set(next);
    queueMicrotask(() => document.getElementById(`tab-${next}`)?.focus());
  }

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
          // Only the rate was persisted. Re-baselining the whole payload would mark the
          // owner's unsaved address or hours as saved, and they would be lost on the
          // next navigation.
          this.savedJson.update((json) => {
            if (!json) return json;
            const base = JSON.parse(json) as StoreUpdate;
            return JSON.stringify({ ...base, usd_rate: r.usd_rate });
          });
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
    const empty = this.emptyTopics();
    if (empty.length > 0) {
      // The offending chips are almost always on a tab the owner is not looking at, so
      // naming the topic and switching to it beats a generic warning.
      const first = empty[0];
      const section = (Object.keys(SECTION_KEYWORDS) as SectionId[]).find((id) =>
        SECTION_KEYWORDS[id].some((k) => k.topic === first),
      );
      if (section) this.activeSection.set(section);
      this.messages.add({
        severity: 'warn',
        summary: 'Faltan palabras clave',
        detail: `Sin palabras, el bot no puede responder sobre: ${empty
          .map((t) => TOPIC_NAMES[t])
          .join(', ')}.`,
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
