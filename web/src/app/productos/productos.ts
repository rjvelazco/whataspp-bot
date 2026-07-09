import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { SelectModule } from 'primeng/select';
import { FileUploadModule, type FileUploadHandlerEvent } from 'primeng/fileupload';
import { TooltipModule } from 'primeng/tooltip';
import { CatalogService, type CatalogItem } from '../catalog.service';
import { StoreService } from '../store.service';

function emptyDraft(): CatalogItem {
  return {
    item_id: '',
    store_id: '',
    code: '',
    name: '',
    category: '',
    price: 0,
    photo_url: '',
    active: true,
    variants: [],
  };
}

@Component({
  selector: 'app-productos',
  imports: [
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    ToggleSwitchModule,
    SelectModule,
    FileUploadModule,
    TooltipModule,
  ],
  templateUrl: './productos.html',
  styleUrl: './productos.css',
})
export class Productos implements OnInit {
  private readonly api = inject(CatalogService);
  private readonly storeApi = inject(StoreService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  /** Categories declared on the store — the primary source for the dropdown. */
  protected readonly storeCategories = signal<string[]>([]);

  protected readonly items = signal<CatalogItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly showDialog = signal(false);
  protected readonly isNew = signal(true);
  protected readonly saving = signal(false);
  protected readonly photoUploading = signal(false);
  /** Bumped after a photo upload to cache-bust the preview <img>. */
  protected readonly photoBump = signal(0);

  /** The product being created/edited. Plain object so ngModel can two-way bind it. */
  protected draft: CatalogItem = emptyDraft();

  /** Store categories first, then any extra categories seen on existing products. */
  protected readonly categories = computed(() => {
    const fromItems = this.items().map((i) => i.category).filter(Boolean);
    return [...new Set([...this.storeCategories(), ...fromItems])].sort();
  });

  ngOnInit(): void {
    this.load();
    this.storeApi.get().subscribe({
      next: (store) => this.storeCategories.set(store.categories ?? []),
    });
  }

  private load(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (items) => {
        this.items.set(items);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los productos' });
      },
    });
  }

  protected totalStock(item: CatalogItem): number {
    return item.variants.reduce((n, v) => n + (Number(v.stock) || 0), 0);
  }

  protected hasPhoto(item: CatalogItem): boolean {
    return !!item.photo_url;
  }

  protected photoSrc(item: CatalogItem): string {
    return this.api.photoUrl(item.item_id);
  }

  protected draftPhotoSrc(): string {
    return `${this.api.photoUrl(this.draft.item_id)}?v=${this.photoBump()}`;
  }

  protected newProduct(): void {
    this.draft = emptyDraft();
    this.isNew.set(true);
    this.showDialog.set(true);
  }

  protected edit(item: CatalogItem): void {
    // Deep copy so cancelling discards edits and variant rows aren't shared by reference.
    this.draft = { ...item, variants: item.variants.map((v) => ({ ...v })) };
    this.isNew.set(false);
    this.photoBump.set(0);
    this.showDialog.set(true);
  }

  protected close(): void {
    this.showDialog.set(false);
  }

  protected addVariant(): void {
    this.draft.variants = [...this.draft.variants, { size: '', color: '', stock: 0 }];
  }

  protected removeVariant(i: number): void {
    this.draft.variants = this.draft.variants.filter((_, k) => k !== i);
  }

  protected save(): void {
    const d = this.draft;
    if (!d.name.trim() || !d.code.trim() || !d.category.trim()) {
      this.messages.add({ severity: 'warn', summary: 'Nombre, código y categoría son obligatorios' });
      return;
    }
    if (!Number.isFinite(Number(d.price)) || Number(d.price) < 0) {
      this.messages.add({ severity: 'warn', summary: 'El precio debe ser un número válido' });
      return;
    }
    const creating = this.isNew();
    this.saving.set(true);
    const req = creating ? this.api.create(d) : this.api.update(d.item_id, d);
    req.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.messages.add({
          severity: 'success',
          summary: creating ? 'Producto creado' : 'Producto actualizado',
        });
        this.load();
        if (creating) {
          // Stay in the dialog in edit mode so the owner can now attach a photo.
          this.draft = { ...saved, variants: saved.variants.map((v) => ({ ...v })) };
          this.isNew.set(false);
        } else {
          this.showDialog.set(false);
        }
      },
      error: (e) => {
        this.saving.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'No se pudo guardar',
          detail: e?.error?.error ?? 'Revisa los datos e intenta de nuevo.',
        });
      },
    });
  }

  protected toggleActive(item: CatalogItem): void {
    const updated: CatalogItem = { ...item, active: !item.active };
    this.api.update(item.item_id, updated).subscribe({
      next: () => this.load(),
      error: () => this.messages.add({ severity: 'error', summary: 'No se pudo actualizar' }),
    });
  }

  protected onPhoto(event: FileUploadHandlerEvent): void {
    const file = event.files?.[0];
    if (!file || !this.draft.item_id) return;
    this.photoUploading.set(true);
    this.api.uploadPhoto(this.draft.item_id, file).subscribe({
      next: (saved) => {
        this.photoUploading.set(false);
        this.draft.photo_url = saved.photo_url;
        this.photoBump.update((n) => n + 1);
        this.messages.add({ severity: 'success', summary: 'Foto actualizada' });
        this.load();
      },
      error: (e) => {
        this.photoUploading.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'No se pudo subir la foto',
          detail: e?.error?.error ?? 'Debe ser JPG/PNG/WebP hasta 10 MB.',
        });
      },
    });
  }

  protected confirmDelete(item: CatalogItem): void {
    this.confirm.confirm({
      header: 'Eliminar producto',
      message: `¿Ocultar "${item.name}" del bot? Podrás reactivarlo luego.`,
      icon: 'pi pi-trash',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () =>
        this.api.remove(item.item_id).subscribe({
          next: () => {
            this.messages.add({ severity: 'success', summary: 'Producto eliminado' });
            this.load();
          },
          error: () => this.messages.add({ severity: 'error', summary: 'No se pudo eliminar' }),
        }),
    });
  }
}
