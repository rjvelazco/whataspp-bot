import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MessageService } from 'primeng/api';
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

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  catalog: 'Catálogo',
  promo: 'Promo',
  story: 'Historia',
};

const ACTION_LABELS: Record<string, string> = {
  go_menu: 'Ir a menú',
  start_order: 'Iniciar pedido',
  show_category: 'Mostrar productos',
  show_offers: 'Mostrar ofertas',
  show_payment: 'Datos de pago',
  show_shipping: 'Datos de envío',
  show_address: 'Dirección',
  show_rate: 'Tasa del día',
  size_guide: 'Guía de tallas',
  shipping_payments: 'Envíos y pagos',
  talk_human: 'Hablar con humano',
};

const ACTION_ITEMS: { value: FlowAction; label: string }[] = [
  { value: 'start_order', label: 'Iniciar pedido' },
  { value: 'show_category', label: 'Mostrar productos' },
  { value: 'show_offers', label: 'Mostrar ofertas' },
  { value: 'show_payment', label: 'Datos de pago' },
  { value: 'show_shipping', label: 'Datos de envío' },
  { value: 'show_address', label: 'Dirección' },
  { value: 'show_rate', label: 'Tasa del día' },
  { value: 'size_guide', label: 'Guía de tallas' },
  { value: 'talk_human', label: 'Hablar con humano' },
];

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
  protected readonly varMenuOpen = signal(false);

  // ---- Conectar picker (nested over the modal) ----
  protected readonly connecting = signal<number | null>(null);
  protected readonly pickerSearch = signal('');

  ngOnInit(): void {
    this.api.get().subscribe({ next: (menus) => this.menus.set(menus) });
    this.assetsApi.list().subscribe({ next: (assets) => this.assets.set(assets) });
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
    return ACTION_LABELS[opt.action] ?? opt.action;
  }
  protected isCategory(opt: FlowOption): boolean {
    return opt.action === 'show_category';
  }
  /** Trigger words for a menu card (display order/casing preserved). */
  protected menuTriggers(menu: FlowMenu): string[] {
    return (menu.trigger ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // ---- open / close modal ----
  protected openEdit(i: number): void {
    this.editIndex = i;
    this.isNew.set(false);
    this.draft = deepCopy(this.menus()[i]);
    this.modalIssues.set([]);
    this.varMenuOpen.set(false);
    this.modalOpen.set(true);
  }
  protected openNew(): void {
    this.editIndex = null;
    this.isNew.set(true);
    this.draft = { key: this.uniqueKey('menu'), name: 'Nuevo menú', message: '', trigger: '', options: [] };
    this.modalIssues.set([]);
    this.varMenuOpen.set(false);
    this.modalOpen.set(true);
  }
  protected cancelModal(): void {
    this.modalOpen.set(false);
    this.connecting.set(null);
  }

  // ---- triggers (chip input over the comma-string) ----
  private triggerWordsOf(menu: FlowMenu): string[] {
    return (menu.trigger ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  }
  protected triggerWords(): string[] {
    return (this.draft.trigger ?? '').split(',').map((t) => t.trim()).filter(Boolean);
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
  protected toggleVarMenu(): void {
    this.varMenuOpen.set(!this.varMenuOpen());
  }
  protected insertVariable(ta: HTMLTextAreaElement, variable: string): void {
    const msg = this.draft.message ?? '';
    const start = ta.selectionStart ?? msg.length;
    const end = ta.selectionEnd ?? start;
    this.draft.message = msg.slice(0, start) + variable + msg.slice(end);
    this.varMenuOpen.set(false);
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
        const serverIssues: FlowIssue[] = e?.error?.issues ?? [];
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
    const candidate = [...this.menus()];
    if (this.isNew()) candidate.push(this.draft);
    else if (this.editIndex !== null) candidate[this.editIndex] = this.draft;
    this.persist(candidate, { fromModal: true });
  }

  protected deleteMenu(i: number, event: Event): void {
    event.stopPropagation();
    this.persist(this.menus().filter((_, k) => k !== i));
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
