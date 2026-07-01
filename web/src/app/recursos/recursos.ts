import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AssetsService, type Asset, type AssetCategory } from '../assets.service';

@Component({
  selector: 'app-recursos',
  imports: [],
  templateUrl: './recursos.html',
  styleUrl: './recursos.css',
})
export class Recursos implements OnInit {
  private readonly api = inject(AssetsService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  protected readonly assets = signal<Asset[]>([]);
  /** Category currently uploading (for the button spinner). */
  protected readonly uploading = signal<AssetCategory | null>(null);

  protected readonly catalog = computed(() => this.assets().filter((a) => a.category === 'catalog'));
  protected readonly promos = computed(() => this.assets().filter((a) => a.category === 'promo'));

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.list().subscribe({ next: (a) => this.assets.set(a) });
  }

  protected onFile(event: Event, category: AssetCategory): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file later
    if (!file) return;

    this.uploading.set(category);
    this.api.upload(category, file).subscribe({
      next: () => {
        this.uploading.set(null);
        this.messages.add({ severity: 'success', summary: 'Archivo subido' });
        this.load();
      },
      error: (e) => {
        this.uploading.set(null);
        this.messages.add({
          severity: 'error',
          summary: 'No se pudo subir',
          detail: e?.error?.error ?? 'Revisa el tipo y tamaño del archivo.',
        });
      },
    });
  }

  protected remove(asset: Asset): void {
    this.confirm.confirm({
      header: 'Eliminar archivo',
      message: `¿Eliminar "${asset.original_name}"?`,
      icon: 'pi pi-trash',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () =>
        this.api.remove(asset.id).subscribe({
          next: () => {
            this.messages.add({ severity: 'success', summary: 'Eliminado' });
            this.load();
          },
        }),
    });
  }

  protected isImage(a: Asset): boolean {
    return a.mimetype.startsWith('image/');
  }

  protected fileUrl(id: string): string {
    return this.api.fileUrl(id);
  }

  protected size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
