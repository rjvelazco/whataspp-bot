import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { FileUploadModule, type FileUploadHandlerEvent } from 'primeng/fileupload';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { AssetsService, type Asset, type AssetCategory } from '../assets.service';
import { SettingsService } from '../settings.service';
import { StoriesService, type Story, type StoryPostReason } from '../stories.service';
import { apiErrorMessage, apiFailureReason } from '../api-error';
import { storyStatusLine } from '../story-display';
import { StoryComposer } from '../story-composer/story-composer';
import { Card, PageHead, Toolbar } from '../ui';

/** Toast per outcome of "publicar ahora" — one table instead of an if/else ladder. */
const POST_RESULT: Record<
  Exclude<StoryPostReason, 'ok'>,
  { severity: 'warn' | 'info'; summary: string }
> = {
  disconnected: { severity: 'warn', summary: 'WhatsApp no está conectado' },
  no_media: { severity: 'info', summary: 'La historia no tiene archivos' },
  busy: { severity: 'info', summary: 'Publicación en curso, intenta de nuevo' },
  not_found: { severity: 'info', summary: 'La historia ya no existe' },
};

/** A story as its card renders it, with the media resolved and the copy composed. */
interface StoryCard {
  story: Story;
  thumbs: { id: string; alt: string; video: boolean; thumb: string | null }[];
  /** Media beyond the four the card shows. */
  extra: number;
  caption: string;
  status: string;
}

/** How many media thumbnails fit on a card before it just counts the rest. */
const CARD_THUMBS = 4;

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
    StoryComposer,
  ],
  templateUrl: './recursos.html',
  styleUrl: './recursos.css',
})
export class Recursos implements OnInit {
  private readonly assetsApi = inject(AssetsService);
  private readonly settings = inject(SettingsService);
  private readonly storiesApi = inject(StoriesService);
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

  protected readonly catalogRows = computed<AssetRow[]>(() => {
    const failed = this.thumbFailed();
    return this.assets()
      .filter((a) => a.category === 'catalog')
      .map((a) => ({
        id: a.id,
        name: a.original_name,
        thumb:
          a.mimetype.startsWith('image/') && !failed.has(a.id)
            ? this.assetsApi.thumbUrl(a.id)
            : null,
        href: this.assetsApi.fileUrl(a.id),
        kind: kindOf(a),
        sizeLabel: formatBytes(a.size),
      }));
  });

  // --- Estados: scheduled stories ---
  protected readonly stories = signal<Story[]>([]);
  protected readonly composerOpen = signal(false);
  protected readonly editingStory = signal<Story | null>(null);
  /** The story currently publishing, so one busy button never blocks the others. */
  protected readonly postingId = signal<string | null>(null);
  /** How many contacts (with a phone number) the Status can reach. */
  protected readonly reachableContacts = signal(0);

  protected readonly storyCards = computed<StoryCard[]>(() => {
    const byId = new Map(this.assets().map((a) => [a.id, a]));
    const failed = this.thumbFailed();
    return this.stories().map((story) => {
      const media = story.media
        .map((m) => byId.get(m.asset_id))
        .filter((a): a is Asset => a !== undefined);
      return {
        story,
        thumbs: media.slice(0, CARD_THUMBS).map((a) => ({
          id: a.id,
          alt: a.original_name,
          video: a.mimetype.startsWith('video/'),
          // Same rule as the file list: a thumbnail that 404s must not paint the
          // browser's broken-image glyph. A video has no thumbnail at all — sharp
          // does not decode MP4 — so it always takes the placeholder.
          thumb:
            a.mimetype.startsWith('image/') && !failed.has(a.id)
              ? this.assetsApi.thumbUrl(a.id)
              : null,
        })),
        extra: Math.max(0, media.length - CARD_THUMBS),
        caption: story.caption || 'Sin texto',
        status: storyStatusLine(story),
      };
    });
  });

  ngOnInit(): void {
    this.load();
    this.loadStories();
    this.settings.getContacts().subscribe({
      next: (contacts) => this.reachableContacts.set(contacts.filter((c) => !!c.phone).length),
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los contactos' }),
    });
  }

  private load(): void {
    this.assetsApi.list().subscribe({
      next: (a) => {
        // A re-uploaded file can reuse an id we had written off; start each list clean.
        this.thumbFailed.set(new Set());
        this.assets.set(a);
      },
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los archivos' }),
    });
  }

  /** A story card's media thumbnail. */
  protected thumbUrl(id: string): string {
    return this.assetsApi.thumbUrl(id);
  }

  /** The thumbnail 404'd or failed to decode: fall back to the label for this asset. */
  protected onThumbError(id: string): void {
    this.thumbFailed.update((failed) => new Set(failed).add(id));
  }

  private loadStories(): void {
    this.storiesApi.list().subscribe({
      next: (list) => this.stories.set(list),
      error: (e) =>
        this.messages.add({
          severity: 'error',
          summary: 'No se pudieron cargar las historias',
          // Without a reason this reads as "your stories are broken", when the usual
          // cause is that the bot is restarting and nothing answered.
          detail: apiFailureReason(e),
        }),
    });
  }

  /** Reload both: a story card draws its thumbnails from the asset list. */
  protected onStorySaved(): void {
    this.load();
    this.loadStories();
  }

  protected newStory(): void {
    this.editingStory.set(null);
    this.composerOpen.set(true);
  }

  protected editStory(story: Story): void {
    this.editingStory.set(story);
    this.composerOpen.set(true);
  }

  protected toggleStory(story: Story, enabled: boolean): void {
    this.storiesApi
      .update(story.id, {
        caption: story.caption,
        mode: story.mode,
        weekdays: story.weekdays,
        post_date: story.post_date,
        post_time: story.post_time,
        delete_after: story.delete_after,
        enabled,
        media: story.media.map((m) => m.asset_id),
      })
      .subscribe({
        next: () => this.loadStories(),
        error: (e) => {
          this.loadStories(); // put the switch back where the server says it is
          this.messages.add({
            severity: 'error',
            summary: 'No se pudo cambiar',
            detail: apiErrorMessage(e),
          });
        },
      });
  }

  protected postStoryNow(story: Story): void {
    if (this.postingId() === story.id) return;
    // An irreversible broadcast to every customer, which also consumes today's
    // scheduled run — it deserves at least the confirmation the delete button gets.
    this.confirm.confirm({
      header: 'Publicar ahora',
      message: `Se publica de inmediato a ${this.reachableContacts()} contacto(s). Cuenta como la publicación de hoy, así que no se volverá a publicar sola.`,
      icon: 'pi pi-send',
      acceptLabel: 'Publicar',
      rejectLabel: 'Cancelar',
      accept: () => this.sendStory(story),
    });
  }

  private sendStory(story: Story): void {
    this.postingId.set(story.id);
    this.storiesApi.postNow(story.id).subscribe({
      next: (r) => {
        this.postingId.set(null);
        if (r.reason === 'ok') {
          this.messages.add({
            severity: 'success',
            summary: 'Historia publicada',
            detail: `${r.posted} archivo(s) enviado(s) a ${r.audience} contacto(s). Cuenta como la publicación de hoy.`,
          });
          this.loadStories();
          return;
        }
        this.messages.add(POST_RESULT[r.reason] ?? POST_RESULT.busy);
      },
      error: () => {
        this.postingId.set(null);
        this.messages.add({ severity: 'error', summary: 'No se pudo publicar' });
      },
    });
  }

  protected removeStory(story: Story): void {
    this.confirm.confirm({
      header: 'Eliminar historia',
      message:
        'Se elimina la programación y también los archivos que publica. Esta acción no se puede deshacer.',
      icon: 'pi pi-trash',
      acceptLabel: 'Eliminar',
      rejectLabel: 'Cancelar',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () =>
        this.storiesApi.remove(story.id).subscribe({
          next: () => {
            this.messages.add({ severity: 'success', summary: 'Historia eliminada' });
            this.onStorySaved();
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

  protected onFile(event: FileUploadHandlerEvent, category: AssetCategory): void {
    const file = event.files?.[0];
    if (!file) return;

    this.uploading.set(category);
    this.assetsApi.upload(category, file).subscribe({
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
        this.assetsApi.remove(row.id).subscribe({
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
