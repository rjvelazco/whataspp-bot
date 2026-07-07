import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MessageService } from 'primeng/api';
import { MenusService, type FlowAction, type FlowIssue, type FlowMenu, type FlowOption } from '../menus.service';
import { AssetsService, type Asset, type AssetCategory } from '../assets.service';

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  catalog: 'Catálogo',
  promo: 'Promo',
  story: 'Historia',
};

/** Human labels for every action (used to render the Conectar chip). */
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

/** Actions offered in the "Acciones" group of the Conectar picker (no legacy combined). */
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

@Component({
  selector: 'app-configuracion',
  imports: [FormsModule, DragDropModule],
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.css',
})
export class Configuracion implements OnInit {
  private readonly api = inject(MenusService);
  private readonly assetsApi = inject(AssetsService);
  private readonly messages = inject(MessageService);

  protected readonly menus = signal<FlowMenu[]>([]);
  protected readonly assets = signal<Asset[]>([]);
  protected readonly expanded = signal<number | null>(0);
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly issues = signal<FlowIssue[]>([]);
  protected readonly variables = VARIABLES;

  /** Which option's Conectar picker is open, plus its search text. */
  protected readonly connecting = signal<{ mi: number; oi: number } | null>(null);
  protected readonly pickerSearch = signal('');
  /** Which menu's { } variable menu is open. */
  protected readonly varMenu = signal<number | null>(null);

  ngOnInit(): void {
    this.api.get().subscribe({
      next: (menus) => {
        this.menus.set(menus);
        this.dirty.set(false);
        this.expanded.set(menus.length ? 0 : null);
      },
    });
    this.assetsApi.list().subscribe({ next: (assets) => this.assets.set(assets) });
  }

  protected touch(): void {
    this.dirty.set(true);
  }
  protected toggle(i: number): void {
    this.expanded.set(this.expanded() === i ? null : i);
  }

  private patchMenu(mi: number, patch: Partial<FlowMenu>): void {
    const menus = [...this.menus()];
    menus[mi] = { ...menus[mi], ...patch };
    this.menus.set(menus);
  }
  private patchOption(mi: number, oi: number, patch: Partial<FlowOption>): void {
    const menus = [...this.menus()];
    const options = [...menus[mi].options];
    options[oi] = { ...options[oi], ...patch };
    menus[mi] = { ...menus[mi], options };
    this.menus.set(menus);
  }

  // ---- main-menu indicator (mirrors engine findEntryMenu) ----
  private entryKey(): string | undefined {
    const menus = this.menus();
    const found = menus.find((m) => {
      const t = (m.trigger ?? '').split(',').map((x) => x.trim().toLowerCase());
      return t.includes('menu') || t.includes('inicio') || t.includes('hola');
    });
    return (found ?? menus[0])?.key;
  }
  protected isEntry(menu: FlowMenu): boolean {
    return !!menu.key && menu.key === this.entryKey();
  }

  // ---- connection status ----
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
  protected isGoto(opt: FlowOption): boolean {
    return opt.action === 'go_menu';
  }
  protected isCategory(opt: FlowOption): boolean {
    return opt.action === 'show_category';
  }

  // ---- triggers (chip input over the comma-string) ----
  protected triggerWords(menu: FlowMenu): string[] {
    return (menu.trigger ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  }
  protected addTrigger(mi: number, raw: string, input?: HTMLInputElement): void {
    const word = raw.trim().toLowerCase();
    if (input) input.value = '';
    if (!word) return;
    const words = this.triggerWords(this.menus()[mi]);
    if (words.includes(word)) return;
    this.patchMenu(mi, { trigger: [...words, word].join(', ') });
    this.touch();
  }
  protected removeTrigger(mi: number, word: string): void {
    const words = this.triggerWords(this.menus()[mi]).filter((w) => w !== word);
    this.patchMenu(mi, { trigger: words.join(', ') });
    this.touch();
  }

  // ---- message variables ----
  protected toggleVarMenu(mi: number): void {
    this.varMenu.set(this.varMenu() === mi ? null : mi);
  }
  protected insertVariable(mi: number, ta: HTMLTextAreaElement, variable: string): void {
    const msg = this.menus()[mi].message ?? '';
    const start = ta.selectionStart ?? msg.length;
    const end = ta.selectionEnd ?? start;
    this.patchMenu(mi, { message: msg.slice(0, start) + variable + msg.slice(end) });
    this.varMenu.set(null);
    this.touch();
    queueMicrotask(() => {
      ta.focus();
      const pos = start + variable.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  // ---- attachments (Recursos) ----
  protected attachmentsOf(menu: FlowMenu): string[] {
    return menu.attachments ?? [];
  }
  protected assetById(id: string): Asset | undefined {
    return this.assets().find((a) => a.id === id);
  }
  protected availableAssets(menu: FlowMenu): Asset[] {
    const attached = new Set(menu.attachments ?? []);
    return this.assets().filter((a) => !attached.has(a.id));
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
  protected addAttachment(mi: number, assetId: string): void {
    if (!assetId) return;
    const current = this.menus()[mi].attachments ?? [];
    if (current.includes(assetId)) return;
    this.patchMenu(mi, { attachments: [...current, assetId] });
    this.touch();
  }
  protected removeAttachment(mi: number, assetId: string): void {
    this.patchMenu(mi, { attachments: (this.menus()[mi].attachments ?? []).filter((x) => x !== assetId) });
    this.touch();
  }

  // ---- menus ----
  protected addMenu(): void {
    const menus = [...this.menus()];
    menus.push({ key: this.uniqueKey('menu'), name: 'Nuevo menú', message: '', options: [] });
    this.menus.set(menus);
    this.expanded.set(menus.length - 1);
    this.touch();
  }
  protected removeMenu(i: number): void {
    const menus = [...this.menus()];
    menus.splice(i, 1);
    this.menus.set(menus);
    this.touch();
  }
  protected dropMenu(event: CdkDragDrop<FlowMenu[]>): void {
    const menus = [...this.menus()];
    moveItemInArray(menus, event.previousIndex, event.currentIndex);
    this.menus.set(menus);
    this.expanded.set(null);
    this.touch();
  }

  // ---- options ----
  protected addOption(mi: number): void {
    this.patchMenu(mi, { options: [...this.menus()[mi].options, { label: '', action: 'go_menu', target: '' }] });
    this.touch();
  }
  protected removeOption(mi: number, oi: number): void {
    this.patchMenu(mi, { options: this.menus()[mi].options.filter((_, k) => k !== oi) });
    this.touch();
  }
  protected dropOption(event: CdkDragDrop<unknown>, mi: number): void {
    const options = [...this.menus()[mi].options];
    moveItemInArray(options, event.previousIndex, event.currentIndex);
    this.patchMenu(mi, { options });
    this.touch();
  }

  // ---- Conectar picker ----
  protected openConnect(mi: number, oi: number): void {
    this.pickerSearch.set('');
    this.connecting.set({ mi, oi });
  }
  protected closeConnect(): void {
    this.connecting.set(null);
  }
  protected otherMenus(mi: number): FlowMenu[] {
    const self = this.menus()[mi]?.key;
    const q = this.pickerSearch().trim().toLowerCase();
    return this.menus().filter(
      (m) => m.key !== self && (!q || m.name.toLowerCase().includes(q) || m.key.toLowerCase().includes(q)),
    );
  }
  protected filteredActions(): { value: FlowAction; label: string }[] {
    const q = this.pickerSearch().trim().toLowerCase();
    return ACTION_ITEMS.filter((a) => !q || a.label.toLowerCase().includes(q));
  }
  protected pickMenu(menuKey: string): void {
    const c = this.connecting();
    if (!c) return;
    this.patchOption(c.mi, c.oi, { action: 'go_menu', target: menuKey, value: undefined });
    this.touch();
    this.closeConnect();
  }
  protected pickAction(action: FlowAction): void {
    const c = this.connecting();
    if (!c) return;
    this.patchOption(c.mi, c.oi, { action, target: undefined, value: undefined });
    this.touch();
    this.closeConnect();
  }

  // ---- save / validation ----
  protected save(): void {
    const menus = this.menus();
    const keys = menus.map((m) => m.key.trim());
    if (keys.some((k) => !k)) {
      this.messages.add({ severity: 'error', summary: 'Cada menú necesita un identificador' });
      return;
    }
    if (new Set(keys).size !== keys.length) {
      this.messages.add({ severity: 'error', summary: 'Los identificadores deben ser únicos' });
      return;
    }
    this.saving.set(true);
    this.api.save(menus).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.dirty.set(false);
        this.issues.set(res.issues ?? []);
        if (res.issues?.length) {
          this.messages.add({
            severity: 'warn',
            summary: 'Guardado con advertencias',
            detail: `${res.issues.length} punto(s) a revisar más abajo.`,
          });
        } else {
          this.messages.add({ severity: 'success', summary: 'Configuración guardada' });
        }
      },
      error: (e) => {
        this.saving.set(false);
        const serverIssues: FlowIssue[] = e?.error?.issues ?? [];
        this.issues.set(serverIssues);
        this.messages.add({
          severity: 'error',
          summary: serverIssues.length ? 'No se guardó: corrige los errores' : 'No se pudo guardar',
        });
      },
    });
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
