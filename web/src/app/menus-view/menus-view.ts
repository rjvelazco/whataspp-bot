import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { ChipModule } from 'primeng/chip';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import type { MessageToken } from '../api-types';
import { Card, KeywordChips, PageHead, Toolbar } from '../ui';
import { TokenEditor, type TokenChoice } from './token-editor';
import {
  MenusService,
  type FlowAction,
  type FlowIssue,
  type FlowMenu,
  type FlowOption,
} from '../menus.service';
import { AssetsService, type Asset, type AssetCategory } from '../assets.service';
import { apiIssues } from '../api-error';

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  catalog: 'Catálogo',
  story: 'Historia',
};

/**
 * Every action, with its label and whether the owner can pick it from the
 * dropdown. `go_menu` is set by the Conectar picker, and `shipping_payments` is
 * legacy — both need a label but neither is offered. Keyed by FlowAction so a new
 * action is a compile error here until it's labelled.
 */
const ACTIONS: Record<FlowAction, { label: string; selectable: boolean }> = {
  go_menu: { label: 'Abre otro menú', selectable: false },
  start_order: { label: 'Empieza un pedido', selectable: true },
  show_category: { label: 'Muestra los productos de una categoría', selectable: true },
  show_offers: { label: 'Muestra las ofertas', selectable: true },
  show_payment: { label: 'Responde con los métodos de pago', selectable: true },
  show_shipping: { label: 'Responde cómo son los envíos', selectable: true },
  show_address: { label: 'Responde con la dirección', selectable: true },
  show_rate: { label: 'Responde con la tasa del día', selectable: true },
  size_guide: { label: 'Responde con la guía de tallas', selectable: true },
  shipping_payments: { label: 'Responde envíos y pagos juntos', selectable: false },
  talk_human: { label: 'Te pasa la conversación', selectable: true },
};

const ACTION_ITEMS: { value: FlowAction; label: string }[] = (
  Object.entries(ACTIONS) as [FlowAction, { label: string; selectable: boolean }][]
)
  .filter(([, meta]) => meta.selectable)
  .map(([value, meta]) => ({ value, label: meta.label }));

/** Split a comma-separated trigger string; `lower` for comparisons, raw for display. */
function splitTriggers(raw: string | undefined, lower = false): string[] {
  return (raw ?? '')
    .split(',')
    .map((t) => (lower ? t.trim().toLowerCase() : t.trim()))
    .filter(Boolean);
}

/**
 * The human name of every message variable.
 *
 * Keyed by MessageToken, which comes from the bot's own domain model — so adding a
 * token there is a compile error here until it has a name a shop owner can read. That
 * is the mechanism behind "never show a database identifier".
 */
const TOKEN_LABELS: Record<MessageToken, string> = {
  store_name: 'Nombre de la tienda',
  owner_name: 'Tu nombre',
  horario: 'Horario',
  direccion: 'Dirección',
  tasa: 'Tasa del día',
};

const TOKEN_CHOICES: TokenChoice[] = (Object.keys(TOKEN_LABELS) as MessageToken[]).map((name) => ({
  name,
  label: TOKEN_LABELS[name],
}));

/** `Menú de envíos` -> `menu_de_envios`. Owners never see or type a key. */
function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'menu'
  );
}

function deepCopy(menu: FlowMenu): FlowMenu {
  return {
    ...menu,
    options: menu.options.map((o) => ({ ...o })),
    attachments: [...(menu.attachments ?? [])],
  };
}

@Component({
  selector: 'app-menus',
  imports: [
    FormsModule,
    DragDropModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    ChipModule,
    SelectModule,
    TooltipModule,
    KeywordChips,
    TokenEditor,
    PageHead,
    Card,
    Toolbar,
  ],
  templateUrl: './menus-view.html',
  styleUrl: './menus-view.css',
})
export class MenusView implements OnInit {
  private readonly api = inject(MenusService);
  private readonly assetsApi = inject(AssetsService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  /** The persisted flow (server truth). All mutations round-trip through PUT. */
  protected readonly menus = signal<FlowMenu[]>([]);
  protected readonly assets = signal<Asset[]>([]);
  protected readonly saving = signal(false);
  /** Flow-wide warnings from the last save (shown as a dismissible page panel). */
  protected readonly issues = signal<FlowIssue[]>([]);
  protected readonly tokenChoices = TOKEN_CHOICES;
  /** The bot's first message, as the engine itself decides it. */
  protected readonly entryKey = signal<string | null>(null);
  /** Every menu's text with tokens resolved, keyed by menu key. */
  protected readonly previews = signal<Record<string, string>>({});
  /** The draft's rendered text, refreshed as the editor is used. */
  protected readonly draftPreview = signal('');

  // ---- modal editor state ----
  protected readonly modalOpen = signal(false);
  protected readonly isNew = signal(false);
  protected editIndex: number | null = null;
  protected draft: FlowMenu = { key: '', name: '', message: '', options: [] };
  /** Errors that blocked the current modal save (shown inside the modal). */
  protected readonly modalIssues = signal<FlowIssue[]>([]);

  constructor() {
    this.previewRequests
      .pipe(
        debounceTime(250),
        switchMap((menu) => this.api.preview(menu).pipe(catchError(() => of({ text: '' })))),
        takeUntilDestroyed(),
      )
      .subscribe((r) => this.draftPreview.set(r.text));
  }

  ngOnInit(): void {
    this.api.get().subscribe({
      next: (menus) => this.menus.set(menus),
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los menús' }),
    });
    this.loadDerived();
    this.assetsApi.list().subscribe({
      next: (assets) => this.assets.set(assets),
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los recursos' }),
    });
  }

  // ---- list card helpers ----
  /**
   * The card list, resolved once per change instead of six method calls per card per
   * change-detection pass.
   */
  /** The option dropdown's choices, resolved once per change rather than per pass. */
  protected readonly optionChoicesFor = computed(() => this.optionChoices());
  /** Announced politely after a keyboard reorder, which is otherwise silent. */
  protected readonly reorderAnnouncement = signal('');

  protected readonly cards = computed(() =>
    this.menus().map((menu, index) => ({
      menu,
      index,
      name: menu.name || 'Sin nombre',
      isEntry: this.isEntry(menu),
      preview: this.previewOf(menu),
      triggers: this.menuTriggers(menu),
      optionCount: menu.options.length,
      unwired: this.unwiredLabel(menu),
    })),
  );

  protected isEntry(menu: FlowMenu): boolean {
    return !!menu.key && menu.key === this.entryKey();
  }
  protected isEntryDraft(): boolean {
    return !!this.draft.key && this.draft.key === this.entryKey();
  }
  /**
   * The card's message with its variables already resolved.
   *
   * Never falls back to the raw stored message: that is `{store_name}` on screen, the
   * one thing rule 3 forbids. A menu saved since the last previews fetch, or a failed
   * fetch, shows a neutral line instead.
   */
  private previewOf(menu: FlowMenu): string {
    const resolved = this.previews()[menu.key];
    if (resolved !== undefined) return resolved || 'Sin mensaje';
    return menu.message ? 'Mensaje sin vista previa — guarda para verlo.' : 'Sin mensaje';
  }
  /**
   * Options that go nowhere, said in words.
   *
   * Replaces a bare "5/5" counter, which counted something real — validateFlow warns on
   * the same condition — while explaining nothing.
   */
  protected unwiredLabel(menu: FlowMenu): string {
    const missing = menu.options.length - this.connectedCount(menu);
    if (missing === 0) return '';
    return missing === 1 ? '1 opción sin conectar' : `${missing} opciones sin conectar`;
  }

  protected optionConnected(opt: FlowOption): boolean {
    if (opt.action === 'go_menu') return !!opt.target;
    if (opt.action === 'show_category') return !!opt.value;
    return true;
  }
  protected connectedCount(menu: FlowMenu): number {
    return menu.options.filter((o) => this.optionConnected(o)).length;
  }
  protected isCategory(opt: FlowOption): boolean {
    return opt.action === 'show_category';
  }
  /** Trigger words for a menu card (display order/casing preserved). */
  protected menuTriggers(menu: FlowMenu): string[] {
    return splitTriggers(menu.trigger);
  }

  /** The entry key and the resolved previews both come from the engine, not from here. */
  private loadDerived(): void {
    this.api.entryKey().subscribe({
      next: (r) => this.entryKey.set(r.key),
      // Swallowing this used to leave entryKey null, which showed a delete button on
      // every card — including the one whose removal leaves the bot mute.
      error: () =>
        this.messages.add({
          severity: 'warn',
          summary: 'No se pudo comprobar el primer mensaje',
          detail: 'Recarga la página antes de eliminar un menú.',
        }),
    });
    this.api.previews().subscribe({ next: (p) => this.previews.set(p), error: () => undefined });
  }

  /**
   * Re-render the draft through the bot's own builder, for the live preview.
   *
   * Debounced and switched: it was one POST per keystroke, and a slower earlier
   * response could land after a newer one and show stale text.
   */
  private readonly previewRequests = new Subject<FlowMenu>();

  protected refreshDraftPreview(): void {
    this.previewRequests.next(deepCopy(this.draft));
  }

  // ---- open / close modal ----
  protected openEdit(i: number): void {
    this.editIndex = i;
    this.isNew.set(false);
    this.draft = deepCopy(this.menus()[i]);
    this.modalIssues.set([]);
    this.modalOpen.set(true);
    this.refreshDraftPreview();
  }
  protected openNew(): void {
    this.editIndex = null;
    this.isNew.set(true);
    this.draft = {
      key: '',
      name: 'Nuevo menú',
      message: '',
      trigger: '',
      options: [],
    };
    this.modalIssues.set([]);
    this.modalOpen.set(true);
    this.refreshDraftPreview();
  }
  protected cancelModal(): void {
    this.modalOpen.set(false);
  }

  // ---- triggers (chip input over the comma-string) ----
  private triggerWordsOf(menu: FlowMenu): string[] {
    return splitTriggers(menu.trigger, true);
  }
  protected triggerWords(): string[] {
    return splitTriggers(this.draft.trigger);
  }
  /** Written back as the comma string the flow format stores. */
  protected setTriggers(words: string[]): void {
    this.draft.trigger = words
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .join(', ');
  }

  // ---- message ----
  /** The pill editor owns the text; every change re-renders the preview. */
  protected setMessage(message: string): void {
    this.draft.message = message;
    this.refreshDraftPreview();
  }

  // ---- attachments (Recursos) ----
  protected assetById(id: string): Asset | undefined {
    return this.assets().find((a) => a.id === id);
  }
  protected availableAssets(): Asset[] {
    const attached = new Set(this.draft.attachments ?? []);
    return this.assets().filter((a) => !attached.has(a.id));
  }
  /** Bound to the "+ Adjuntar recurso" p-select; reset to null after each pick. */
  protected attachPick: string | null = null;
  protected attachOptions(): { label: string; value: string }[] {
    return this.availableAssets().map((a) => ({ label: this.assetLabel(a), value: a.id }));
  }
  protected assetLabel(a: Asset): string {
    return `[${CATEGORY_LABEL[a.category]}] ${a.original_name}`;
  }
  protected assetIsImage(a: Asset): boolean {
    return a.mimetype.startsWith('image/');
  }
  protected addAttachment(assetId: string): void {
    if (!assetId) return;
    const current = this.draft.attachments ?? [];
    if (current.includes(assetId)) return;
    this.draft.attachments = [...current, assetId];
  }
  protected removeAttachment(assetId: string): void {
    this.draft.attachments = (this.draft.attachments ?? []).filter((x) => x !== assetId);
  }

  // ---- options ----
  protected addOption(): void {
    this.draft.options = [...this.draft.options, { label: '', action: 'go_menu', target: '' }];
    this.refreshDraftPreview();
  }
  protected removeOption(oi: number): void {
    this.draft.options = this.draft.options.filter((_, k) => k !== oi);
    this.refreshDraftPreview();
  }
  /**
   * Keyboard reordering.
   *
   * Dragging is mouse-only, and reordering is not a decoration here — the number a
   * customer replies with is the position in this list.
   */
  protected moveOption(oi: number, delta: number): void {
    const to = oi + delta;
    if (to < 0 || to >= this.draft.options.length) return;
    const options = [...this.draft.options];
    moveItemInArray(options, oi, to);
    this.draft.options = options;
    this.refreshDraftPreview();
  }

  protected dropOption(event: CdkDragDrop<unknown>): void {
    const options = [...this.draft.options];
    moveItemInArray(options, event.previousIndex, event.currentIndex);
    this.draft.options = options;
    this.refreshDraftPreview();
  }

  // ---- what an option does ----
  /**
   * One dropdown per option instead of a nested "Conectar" dialog over the editor.
   *
   * Values are encoded so a single control can offer both kinds of destination:
   * `action:show_rate` runs a bot action, `menu:menu_catalogo` opens another menu.
   */
  protected optionChoices(): { label: string; items: { label: string; value: string }[] }[] {
    const others = this.menus()
      .filter((m) => m.key !== this.draft.key)
      .map((m) => ({ label: m.name || 'Menú sin nombre', value: `menu:${m.key}` }));
    return [
      {
        label: 'El bot responde',
        items: ACTION_ITEMS.map((a) => ({ label: a.label, value: `action:${a.value}` })),
      },
      { label: 'Abre otro menú', items: others },
    ].filter((g) => g.items.length > 0);
  }

  protected optionValue(opt: FlowOption): string | null {
    if (opt.action === 'go_menu') return opt.target ? `menu:${opt.target}` : null;
    return `action:${opt.action}`;
  }

  protected setOptionTarget(oi: number, encoded: string): void {
    // indexOf, not split: a key containing a colon would lose everything after it, and
    // the old editor let owners type keys freely.
    const sep = encoded.indexOf(':');
    const kind = encoded.slice(0, sep);
    const value = encoded.slice(sep + 1);
    const current = this.draft.options[oi];
    this.draft.options[oi] =
      kind === 'menu'
        ? { ...current, action: 'go_menu', target: value, value: undefined }
        : { ...current, action: value as FlowAction, target: undefined, value: undefined };
    this.refreshDraftPreview();
  }

  // ---- persistence ----
  private persist(
    candidate: FlowMenu[],
    opts: { fromModal?: boolean; quiet?: boolean } = {},
  ): void {
    this.saving.set(true);
    this.api.save(candidate).subscribe({
      next: (res) => {
        this.saving.set(false);
        // Not for a reorder: the list is already optimistic, and writing this snapshot
        // back would revert a newer move that landed while the request was in flight.
        if (!opts.quiet) this.menus.set(candidate);
        this.loadDerived();
        const warnings = (res.issues ?? []).filter((i) => i.severity === 'warning');
        this.issues.set(warnings);
        if (opts.fromModal) {
          this.modalIssues.set([]);
          this.modalOpen.set(false);
        }
        if (opts.quiet && !warnings.length) return;
        this.messages.add(
          warnings.length
            ? {
                severity: 'warn',
                summary: 'Guardado',
                detail: `${warnings.length} advertencia(s) — revisa el flujo.`,
              }
            : { severity: 'success', summary: 'Guardado' },
        );
      },
      error: (e) => {
        this.saving.set(false);
        const serverIssues = apiIssues(e);
        if (opts.fromModal) {
          this.modalIssues.set(
            serverIssues.length
              ? serverIssues
              : [{ severity: 'error', message: 'No se pudo guardar.' }],
          );
        } else {
          this.messages.add({
            severity: 'error',
            summary: 'No se pudo guardar',
            detail: serverIssues[0]?.message ?? 'Revisa el flujo.',
          });
        }
      },
    });
  }

  protected saveModal(): void {
    const name = (this.draft.name ?? '').trim();
    if (!name) {
      this.modalIssues.set([{ severity: 'error', message: 'Ponle un nombre al menú.' }]);
      return;
    }
    // The key is a database identifier, so it is derived rather than typed — rule 4.
    // An existing menu keeps the key it was saved with: changing it would orphan every
    // option that points at it.
    const key = this.draft.key?.trim() || this.uniqueKey(slugify(name));
    this.draft.key = key;
    this.draft.name = name;
    const candidate = [...this.menus()];
    if (this.isNew()) candidate.push(this.draft);
    else if (this.editIndex !== null) candidate[this.editIndex] = this.draft;
    this.persist(candidate, { fromModal: true });
  }

  protected deleteMenu(i: number, event: Event): void {
    event.stopPropagation();
    const menu = this.menus()[i];
    this.confirm.confirm({
      header: 'Eliminar menú',
      message: `¿Eliminar "${menu?.name || menu?.key}"? Las opciones que lo enlazan quedarán sin conectar.`,
      icon: 'pi pi-trash',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.persist(this.menus().filter((_, k) => k !== i)),
    });
  }

  private reorderTimer?: ReturnType<typeof setTimeout>;

  /**
   * Reordering is optimistic and the save is debounced.
   *
   * A held arrow key used to fire one PUT plus two GETs plus a toast per repeat, and
   * out-of-order responses each wrote their own stale snapshot back over the list.
   */
  protected moveMenu(i: number, delta: number, event: Event): void {
    event.stopPropagation();
    const to = i + delta;
    const menus = [...this.menus()];
    if (to < 0 || to >= menus.length) return;
    moveItemInArray(menus, i, to);
    this.menus.set(menus);

    this.reorderAnnouncement.set(
      `${menus[to].name || 'Menú'}: posición ${to + 1} de ${menus.length}`,
    );
    clearTimeout(this.reorderTimer);
    this.reorderTimer = setTimeout(() => this.persist(this.menus(), { quiet: true }), 400);
    queueMicrotask(() => document.getElementById(`drag-${menus[to].key}`)?.focus());
  }

  protected dropMenu(event: CdkDragDrop<FlowMenu[]>): void {
    const menus = [...this.menus()];
    moveItemInArray(menus, event.previousIndex, event.currentIndex);
    this.menus.set(menus); // optimistic; reorder never fails validation
    this.persist(menus);
  }

  protected dismissIssues(): void {
    this.issues.set([]);
  }

  private uniqueKey(base: string): string {
    const keys = new Set(this.menus().map((m) => m.key));
    if (!keys.has(base)) return base;
    let i = 2;
    while (keys.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }
}
