import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
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

/** Toast per outcome of "publicar ahora" — one table instead of an if/else ladder. */
const POST_RESULT: Record<
  Exclude<StoryPostReason, 'ok'>,
  { severity: 'warn' | 'info'; summary: string }
> = {
  disconnected: { severity: 'warn', summary: 'WhatsApp no está conectado' },
  no_stories: { severity: 'info', summary: 'No hay historias para publicar' },
  busy: { severity: 'info', summary: 'Publicación en curso, intenta de nuevo' },
};

@Component({
  selector: 'app-recursos',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    ButtonModule,
    FileUploadModule,
    ToggleSwitchModule,
    InputTextModule,
    TooltipModule,
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

  protected readonly catalog = computed(() =>
    this.assets().filter((a) => a.category === 'catalog'),
  );
  protected readonly promos = computed(() => this.assets().filter((a) => a.category === 'promo'));
  protected readonly stories = computed(() => this.assets().filter((a) => a.category === 'story'));

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
      next: (a) => this.assets.set(a),
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los archivos' }),
    });
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
    if (this.stories().length === 0) return;
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
          error: (e) =>
            this.messages.add({
              severity: 'error',
              summary: 'No se pudo eliminar',
              detail: apiErrorMessage(e),
            }),
        }),
    });
  }

  protected isImage(a: Asset): boolean {
    return a.mimetype.startsWith('image/');
  }

  protected thumbUrl(id: string): string {
    return this.api.thumbUrl(id);
  }

  protected fileUrl(id: string): string {
    return this.api.fileUrl(id);
  }

  protected formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
