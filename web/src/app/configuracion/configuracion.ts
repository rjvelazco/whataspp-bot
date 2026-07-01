import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MessageService } from 'primeng/api';
import { MenusService, type FlowAction, type FlowMenu } from '../menus.service';

const ACTIONS: { value: FlowAction; label: string }[] = [
  { value: 'go_menu', label: 'Ir a menú' },
  { value: 'start_order', label: 'Iniciar pedido' },
  { value: 'show_category', label: 'Mostrar categoría' },
  { value: 'shipping_payments', label: 'Envíos y pagos' },
  { value: 'talk_human', label: 'Hablar con humano' },
];

@Component({
  selector: 'app-configuracion',
  imports: [FormsModule, DragDropModule],
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.css',
})
export class Configuracion implements OnInit {
  private readonly api = inject(MenusService);
  private readonly messages = inject(MessageService);

  protected readonly menus = signal<FlowMenu[]>([]);
  protected readonly expanded = signal<number | null>(0);
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly actions = ACTIONS;

  ngOnInit(): void {
    this.api.get().subscribe({
      next: (menus) => {
        this.menus.set(menus);
        this.dirty.set(false);
        this.expanded.set(menus.length ? 0 : null);
      },
    });
  }

  protected touch(): void {
    this.dirty.set(true);
  }

  protected toggle(i: number): void {
    this.expanded.set(this.expanded() === i ? null : i);
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
    const menus = [...this.menus()];
    menus[mi] = { ...menus[mi], options: [...menus[mi].options, { label: '', action: 'go_menu', target: '' }] };
    this.menus.set(menus);
    this.touch();
  }

  protected removeOption(mi: number, oi: number): void {
    const menus = [...this.menus()];
    menus[mi] = { ...menus[mi], options: menus[mi].options.filter((_, k) => k !== oi) };
    this.menus.set(menus);
    this.touch();
  }

  protected dropOption(event: CdkDragDrop<unknown>, mi: number): void {
    const menus = [...this.menus()];
    const options = [...menus[mi].options];
    moveItemInArray(options, event.previousIndex, event.currentIndex);
    menus[mi] = { ...menus[mi], options };
    this.menus.set(menus);
    this.touch();
  }

  protected needsMenuTarget(a: FlowAction): boolean {
    return a === 'go_menu';
  }
  protected needsCategoryTarget(a: FlowAction): boolean {
    return a === 'show_category';
  }
  protected menuKeys(): string[] {
    return this.menus().map((m) => m.key);
  }

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
      next: () => {
        this.saving.set(false);
        this.dirty.set(false);
        this.messages.add({ severity: 'success', summary: 'Configuración guardada' });
      },
      error: () => {
        this.saving.set(false);
        this.messages.add({ severity: 'error', summary: 'No se pudo guardar' });
      },
    });
  }

  private uniqueKey(base: string): string {
    const keys = new Set(this.menus().map((m) => m.key));
    let i = 1;
    while (keys.has(`${base}_${i}`)) i++;
    return `${base}_${i}`;
  }
}
