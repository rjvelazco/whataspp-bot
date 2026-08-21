import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ChipModule } from 'primeng/chip';
import { SelectModule } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';
import { MenusService, type FlowAction, type FlowIssue, type FlowMenu, type FlowOption } from '../menus.service';
import { AssetsService, type Asset, type AssetCategory } from '../assets.service';
import { apiIssues } from '../api-error';

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  catalog: 'Catálogo',
  promo: 'Promo',
  story: 'Historia',
};

/**
 * Every action, with its label and whether the owner can pick it from the
 * dropdown. `go_menu` is set by the Conectar picker, and `shipping_payments` is
 * legacy — both need a label but neither is offered. Keyed by FlowAction so a new
 * action is a compile error here until it's labelled.
 */
const ACTIONS: Record<FlowAction, { label: string; selectable: boolean }> = {
  go_menu: { label: 'Ir a menú', selectable: false },
  start_order: { label: 'Iniciar pedido', selectable: true },
  show_category: { label: 'Mostrar productos', selectable: true },
  show_offers: { label: 'Mostrar ofertas', selectable: true },
  show_payment: { label: 'Datos de pago', selectable: true },
  show_shipping: { label: 'Datos de envío', selectable: true },
  show_address: { label: 'Dirección', selectable: true },
  show_rate: { label: 'Tasa del día', selectable: true },
  size_guide: { label: 'Guía de tallas', selectable: true },
  shipping_payments: { label: 'Envíos y pagos', selectable: false },
  talk_human: { label: 'Hablar con humano', selectable: true },
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

const VARIABLES = ['{store_name}', '{owner_name}'];
const ENTRY_TRIGGERS = ['hola', 'menu', 'inicio'];

function deepCopy(menu: FlowMenu): FlowMenu {
  return {
    ...menu,
    options: menu.options.map((o) => ({ ...o })),
    attachments: [...(menu.attachments ?? [])],
  };
}

@Component({
  selector: 'app-configuracion',
  imports: [
    FormsModule,
    DragDropModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    ChipModule,
    SelectModule,
    MessageModule,
    PopoverModule,
    TooltipModule,
  ],
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.css',
})
export class Configuracion implements OnInit {
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
  protected readonly variables = VARIABLES;

  // ---- modal editor state ----
  protected readonly modalOpen = signal(false);
  protected readonly isNew = signal(false);
  protected editIndex: number | null = null;
  protected draft: FlowMenu = { key: '', name: '', message: '', options: [] };
  /** Errors that blocked the current modal save (shown inside the modal). */
  protected readonly modalIssues = signal<FlowIssue[]>([]);

  // ---- Conectar picker (nested over the modal) ----
  protected readonly connecting = signal<number | null>(null);
  protected readonly pickerSearch = signal('');

  ngOnInit(): void {
    this.api.get().subscribe({
      next: (menus) => this.menus.set(menus),
      error: () => this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los menús' }),
    });
    this.assetsApi.list().subscribe({
      next: (assets) => this.assets.set(assets),
      error: () => this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los recursos' }),
    });
  }

  // ---- list card helpers ----
  private entryKey(): string | undefined {
    const menus = this.menus();
    const found = menus.find((m) => this.triggerWordsOf(m).some((t) => ENTRY_TRIGGERS.includes(t)));
    return (found ?? menus[0])?.key;
  }
  protected isEntry(menu: FlowMenu): boolean {
    return !!menu.key && menu.key === this.entryKey();
  }
  protected isEntryDraft(): boolean {
    return this.triggerWords().some((t) => ENTRY_TRIGGERS.includes(t.toLowerCase()));
  }

  protected optionConnected(opt: FlowOption): boolean {
    if (opt.action === 'go_menu') return !!opt.target;
    if (opt.action === 'show_category') return !!opt.value;
    return true;
  }
  protected connectedCount(menu: FlowMenu): number {
    return menu.options.filter((o) => this.optionConnected(o)).length;
  }
  protected allWired(menu: FlowMenu): boolean {
    return menu.options.every((o) => this.optionConnected(o));
  }
  protected connectLabel(opt: FlowOption): string {
    if (opt.action === 'go_menu') return opt.target ?? '';
    return ACTIONS[opt.action].label;
  }
  protected isCategory(opt: FlowOption): boolean {
    return opt.action === 'show_category';
  }
  /** Trigger words for a menu card (display order/casing preserved). */
  protected menuTriggers(menu: FlowMenu): string[] {
    return splitTriggers(menu.trigger);
  }

  // ---- open / close modal ----
  protected openEdit(i: number): void {
    this.editIndex = i;
    this.isNew.set(false);
    this.draft = deepCopy(this.menus()[i]);
    this.modalIssues.set([]);
    this.modalOpen.set(true);
  }
  protected openNew(): void {
    this.editIndex = null;
    this.isNew.set(true);
    this.draft = { key: this.uniqueKey('menu'), name: 'Nuevo menú', message: '', trigger: '', options: [] };
    this.modalIssues.set([]);
    this.modalOpen.set(true);
  }
  protected cancelModal(): void {
    this.modalOpen.set(false);
    this.connecting.set(null);
  }

  // ---- triggers (chip input over the comma-string) ----
  private triggerWordsOf(menu: FlowMenu): string[] {
    return splitTriggers(menu.trigger, true);
  }
  protected triggerWords(): string[] {
    return splitTriggers(this.draft.trigger);
  }
  protected addTrigger(raw: string, input?: HTMLInputElement): void {
    const word = raw.trim().toLowerCase();
    if (input) input.value = '';
    if (!word) return;
    const words = this.triggerWords();
    if (words.includes(word)) return;
    this.draft.trigger = [...words, word].join(', ');
  }
  protected removeTrigger(word: string): void {
    this.draft.trigger = this.triggerWords().filter((w) => w !== word).join(', ');
  }

  // ---- message variables ----
  protected insertVariable(ta: HTMLTextAreaElement, variable: string): void {
    const msg = this.draft.message ?? '';
    const start = ta.selectionStart ?? msg.length;
    const end = ta.selectionEnd ?? start;
    this.draft.message = msg.slice(0, start) + variable + msg.slice(end);
    queueMicrotask(() => {
      ta.focus();
      const pos = start + variable.length;
      ta.setSelectionRange(pos, pos);
    });
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
  protected assetUrl(id: string): string {
    return this.assetsApi.fileUrl(id);
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
  }
  protected removeOption(oi: number): void {
    this.draft.options = this.draft.options.filter((_, k) => k !== oi);
  }
  protected dropOption(event: CdkDragDrop<unknown>): void {
    const options = [...this.draft.options];
    moveItemInArray(options, event.previousIndex, event.currentIndex);
    this.draft.options = options;
  }

  // ---- Conectar picker ----
  protected openConnect(oi: number): void {
    this.pickerSearch.set('');
    this.connecting.set(oi);
  }
  protected closeConnect(): void {
    this.connecting.set(null);
  }
  protected otherMenus(): FlowMenu[] {
    const q = this.pickerSearch().trim().toLowerCase();
    return this.menus().filter(
      (m) => m.key !== this.draft.key && (!q || m.name.toLowerCase().includes(q) || m.key.toLowerCase().includes(q)),
    );
  }
  protected filteredActions(): { value: FlowAction; label: string }[] {
    const q = this.pickerSearch().trim().toLowerCase();
    return ACTION_ITEMS.filter((a) => !q || a.label.toLowerCase().includes(q));
  }
  protected pickMenu(menuKey: string): void {
    const oi = this.connecting();
    if (oi === null) return;
    this.draft.options[oi] = { ...this.draft.options[oi], action: 'go_menu', target: menuKey, value: undefined };
    this.closeConnect();
  }
  protected pickAction(action: FlowAction): void {
    const oi = this.connecting();
    if (oi === null) return;
    this.draft.options[oi] = { ...this.draft.options[oi], action, target: undefined, value: undefined };
    this.closeConnect();
  }

  // ---- persistence ----
  private persist(candidate: FlowMenu[], opts: { fromModal?: boolean } = {}): void {
    this.saving.set(true);
    this.api.save(candidate).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.menus.set(candidate);
        const warnings = (res.issues ?? []).filter((i) => i.severity === 'warning');
        this.issues.set(warnings);
        if (opts.fromModal) {
          this.modalIssues.set([]);
          this.modalOpen.set(false);
        }
        this.messages.add(
          warnings.length
            ? { severity: 'warn', summary: 'Guardado', detail: `${warnings.length} advertencia(s) — revisa el flujo.` }
            : { severity: 'success', summary: 'Guardado' },
        );
      },
      error: (e) => {
        this.saving.set(false);
        const serverIssues = apiIssues(e);
        if (opts.fromModal) {
          this.modalIssues.set(serverIssues.length ? serverIssues : [{ severity: 'error', message: 'No se pudo guardar.' }]);
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
    const key = this.draft.key.trim();
    if (!key) {
      this.modalIssues.set([{ severity: 'error', message: 'El menú necesita un identificador.' }]);
      return;
    }
    const clash = this.menus().some((m, i) => m.key === key && i !== this.editIndex);
    if (clash) {
      this.modalIssues.set([{ severity: 'error', message: `Ya existe un menú con el identificador "${key}".` }]);
      return;
    }
    // Persist what was validated, not the raw input ("menu " passed the check
    // above and was then stored with its trailing space).
    this.draft.key = key;
    this.draft.name = (this.draft.name ?? '').trim();
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
    let i = 1;
    while (keys.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }
}
