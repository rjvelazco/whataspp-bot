import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { FileUploadModule, type FileUploadHandlerEvent } from 'primeng/fileupload';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { AssetsService, type Asset, type AssetCategory } from '../assets.service';
import { SettingsService, type StorySchedule, type StoryPostReason } from '../settings.service';
import { apiErrorMessage } from '../api-error';
import { Card, PageHead, Toolbar } from '../ui';

/** Toast per outcome of "publicar ahora" — one table instead of an if/else ladder. */
const POST_RESULT: Record<
  Exclude<StoryPostReason, 'ok'>,
  { severity: 'warn' | 'info'; summary: string }
> = {
  disconnected: { severity: 'warn', summary: 'WhatsApp no está conectado' },
  no_stories: { severity: 'info', summary: 'No hay historias para publicar' },
  busy: { severity: 'info', summary: 'Publicación en curso, intenta de nuevo' },
};

/**
 * The short label a file without a thumbnail shows instead.
 *
 * Keyed on the mimetype, which the server chose from its own allow-list — the filename
 * is whatever the customer's phone called it, and may carry no extension at all.
 */
const KIND_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/jpg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
};

/** One row of either list, with everything the template needs already resolved. */
interface AssetRow {
  id: string;
  name: string;
  /** The thumbnail URL, or null when there is nothing to draw and the label stands in. */
  thumb: string | null;
  href: string;
  kind: string;
  sizeLabel: string;
}

function kindOf(a: Asset): string {
  const known = KIND_LABEL[a.mimetype.split(';')[0].trim().toLowerCase()];
  if (known) return known;
  const ext = /\.([a-z0-9]+)$/i.exec(a.original_name);
  return ext ? ext[1].toUpperCase() : 'ARCHIVO';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

@Component({
  selector: 'app-recursos',
  imports: [
    FormsModule,
    ButtonModule,
    FileUploadModule,
    ToggleSwitchModule,
    InputTextModule,
    TooltipModule,
    PageHead,
    Card,
    Toolbar,
  ],
  templateUrl: './recursos.html',
  styleUrl: './recursos.css',
})
export class Recursos implements OnInit {
  private readonly api = inject(AssetsService);
  private readonly settings = inject(SettingsService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  protected readonly assets = signal<Asset[]>([]);
  /** Category currently uploading (for the button spinner). */
  protected readonly uploading = signal<AssetCategory | null>(null);

  /**
   * Assets whose thumbnail request failed.
   *
   * The mimetype is only what the uploader declared, so "is an image" and "has a
   * thumbnail the browser can draw" are not the same question. Answering the first one
   * alone left a broken-image glyph wherever they disagreed; this records the second.
   */
  private readonly thumbFailed = signal<ReadonlySet<string>>(new Set());

  protected readonly catalogRows = computed(() => this.rowsFor('catalog'));
  protected readonly storyRows = computed(() => this.rowsFor('story'));

  private rowsFor(category: AssetCategory): AssetRow[] {
    const failed = this.thumbFailed();
    return this.assets()
      .filter((a) => a.category === category)
      .map((a) => ({
        id: a.id,
        name: a.original_name,
        thumb:
          a.mimetype.startsWith('image/') && !failed.has(a.id) ? this.api.thumbUrl(a.id) : null,
        href: this.api.fileUrl(a.id),
        kind: kindOf(a),
        sizeLabel: formatBytes(a.size),
      }));
  }

  // --- Story (Estados) daily schedule ---
  protected readonly scheduleEnabled = signal(false);
  protected readonly scheduleTime = signal('09:00');
  protected readonly savingSchedule = signal(false);
  protected readonly postingNow = signal(false);
  /** How many contacts (with a phone number) the Status can reach. */
  protected readonly reachableContacts = signal(0);

  ngOnInit(): void {
    this.load();
    this.settings.getStorySchedule().subscribe({
      next: (s) => {
        this.scheduleEnabled.set(s.enabled);
        this.scheduleTime.set(s.time);
      },
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudo cargar la programación' }),
    });
    this.settings.getContacts().subscribe({
      next: (contacts) => this.reachableContacts.set(contacts.filter((c) => !!c.phone).length),
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los contactos' }),
    });
  }

  private load(): void {
    this.api.list().subscribe({
      next: (a) => {
        // A re-uploaded file can reuse an id we had written off; start each list clean.
        this.thumbFailed.set(new Set());
        this.assets.set(a);
      },
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los archivos' }),
    });
  }

  /** The thumbnail 404'd or failed to decode: fall back to the label for this asset. */
  protected onThumbError(id: string): void {
    this.thumbFailed.update((failed) => new Set(failed).add(id));
  }

  protected saveSchedule(): void {
    const schedule: StorySchedule = {
      enabled: this.scheduleEnabled(),
      time: this.scheduleTime(),
    };
    this.savingSchedule.set(true);
    this.settings.saveStorySchedule(schedule).subscribe({
      next: (s) => {
        this.savingSchedule.set(false);
        this.scheduleEnabled.set(s.enabled);
        this.scheduleTime.set(s.time);
        this.messages.add({
          severity: 'success',
          summary: 'Programación guardada',
          detail: s.enabled
            ? `Se publicará cada día a las ${s.time}.`
            : 'Publicación automática desactivada.',
        });
      },
      error: () => {
        this.savingSchedule.set(false);
        this.messages.add({ severity: 'error', summary: 'No se pudo guardar la programación' });
      },
    });
  }

  protected postStoryNow(): void {
    if (this.storyRows().length === 0) return;
    this.postingNow.set(true);
    this.settings.postStoryNow().subscribe({
      next: (r) => {
        this.postingNow.set(false);
        if (r.reason === 'ok') {
          this.messages.add({
            severity: 'success',
            summary: 'Historias publicadas',
            detail: `${r.posted} historia(s) enviada(s) a ${r.audience} contacto(s).`,
          });
          return;
        }
        this.messages.add(POST_RESULT[r.reason] ?? POST_RESULT.busy);
      },
      error: () => {
        this.postingNow.set(false);
        this.messages.add({ severity: 'error', summary: 'No se pudo publicar' });
      },
    });
  }

  protected onFile(event: FileUploadHandlerEvent, category: AssetCategory): void {
    const file = event.files?.[0];
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
          detail: apiErrorMessage(e, 'Revisa el tipo y tamaño del archivo.'),
        });
      },
    });
  }

  protected remove(row: AssetRow): void {
    this.confirm.confirm({
      header: 'Eliminar archivo',
      message: `¿Eliminar "${row.name}"?`,
      icon: 'pi pi-trash',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () =>
        this.api.remove(row.id).subscribe({
          next: () => {
            this.messages.add({ severity: 'success', summary: 'Eliminado' });
            this.load();
          },
          error: (e) =>
            this.messages.add({
              severity: 'error',
              summary: 'No se pudo eliminar',
              detail: apiErrorMessage(e),
            }),
        }),
    });
  }
}
