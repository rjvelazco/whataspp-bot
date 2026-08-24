import { Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { FileUploadModule, type FileUploadHandlerEvent } from 'primeng/fileupload';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TextareaModule } from 'primeng/textarea';
import { AssetsService, type Asset } from '../assets.service';
import { StoriesService, type Story, type StoryInput, type StoryMode } from '../stories.service';
import { apiErrorMessage } from '../api-error';
import { WEEKDAYS, scheduleSummary } from '../story-display';
import { TimeWheel } from './time-wheel';

/** A Status video longer than this is refused before it is uploaded. */
const MAX_VIDEO_SECONDS = 30;

const STEPS = [
  { n: 1, label: 'Archivos' },
  { n: 2, label: 'Texto' },
  { n: 3, label: 'Cuándo' },
];

@Component({
  selector: 'app-story-composer',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    DialogModule,
    FileUploadModule,
    SelectButtonModule,
    TextareaModule,
    TimeWheel,
  ],
  templateUrl: './story-composer.html',
  styleUrl: './story-composer.css',
})
export class StoryComposer {
  private readonly assetsApi = inject(AssetsService);
  private readonly api = inject(StoriesService);
  private readonly messages = inject(MessageService);

  readonly open = model.required<boolean>();
  /** The story being edited, or null to compose a new one. */
  readonly editing = input<Story | null>(null);
  /** Emitted after a successful save, so the list can reload. */
  readonly saved = output<void>();

  protected readonly steps = STEPS;
  protected readonly weekdayOptions = WEEKDAYS;
  protected readonly modes: { label: string; value: StoryMode }[] = [
    { label: 'Todos los días', value: 'daily' },
    { label: 'Días específicos', value: 'weekly' },
    { label: 'Una sola vez', value: 'once' },
  ];

  protected readonly step = signal(1);
  protected readonly media = signal<Asset[]>([]);
  protected readonly caption = signal('');
  protected readonly mode = signal<StoryMode>('daily');
  protected readonly weekdays = signal<number[]>([]);
  protected readonly postDate = signal<Date | null>(null);
  protected readonly postTime = signal('09:00');
  protected readonly deleteAfter = signal(false);
  protected readonly uploading = signal(false);
  protected readonly saving = signal(false);

  /** Assets uploaded in this session that no story owns yet — removed if we cancel. */
  private readonly pending = signal<Set<string>>(new Set());

  protected readonly title = computed(() =>
    this.editing() ? 'Editar historia' : 'Nueva historia',
  );
  protected readonly canContinue = computed(() => this.media().length > 0);
  protected readonly summary = computed(() =>
    scheduleSummary({
      mode: this.mode(),
      weekdays: this.weekdays(),
      post_date: this.dateValue(),
      post_time: this.postTime(),
    }),
  );
  /** The schedule is incomplete until a weekly story has days and a one-off has a date. */
  protected readonly canSave = computed(() => {
    if (this.media().length === 0) return false;
    if (this.mode() === 'weekly') return this.weekdays().length > 0;
    if (this.mode() === 'once') return this.dateValue() !== null;
    return true;
  });

  constructor() {
    // Re-hydrate whenever the dialog opens, so reopening never shows the last draft.
    effect(() => {
      if (!this.open()) return;
      void this.hydrate(this.editing());
    });
  }

  private async hydrate(story: Story | null): Promise<void> {
    this.step.set(1);
    this.pending.set(new Set());
    this.caption.set(story?.caption ?? '');
    this.mode.set(story?.mode ?? 'daily');
    this.weekdays.set(story ? [...story.weekdays] : []);
    this.postTime.set(story?.post_time ?? '09:00');
    this.deleteAfter.set(story?.delete_after ?? false);
    this.postDate.set(story?.post_date ? this.parseDate(story.post_date) : null);
    this.media.set([]);

    if (!story || story.media.length === 0) return;
    // The story stores asset ids; the strip needs the rows to know a video from an image.
    this.assetsApi.list().subscribe({
      next: (all) => {
        const byId = new Map(all.map((a) => [a.id, a]));
        this.media.set(story.media.map((m) => byId.get(m.asset_id)).filter((a): a is Asset => !!a));
      },
      error: () =>
        this.messages.add({ severity: 'error', summary: 'No se pudieron cargar los archivos' }),
    });
  }

  /** "2026-08-24" as a local Date — `new Date(string)` would read it as UTC. */
  private parseDate(value: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  /** The picked date as "YYYY-MM-DD", in the shop's own timezone. */
  private dateValue(): string | null {
    const d = this.postDate();
    if (!d) return null;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  protected thumbUrl(id: string): string {
    return this.assetsApi.thumbUrl(id);
  }

  protected isVideo(a: Asset): boolean {
    return a.mimetype.startsWith('video/');
  }

  protected setMode(mode: StoryMode): void {
    this.mode.set(mode);
    // Deleting the media only makes sense once. On a repeating story it would remove the
    // files needed for the next run, so the box empties as well as disabling.
    if (mode !== 'once') this.deleteAfter.set(false);
  }

  protected toggleWeekday(value: number): void {
    this.weekdays.update((days) =>
      days.includes(value) ? days.filter((d) => d !== value) : [...days, value].sort(),
    );
  }

  protected async onFiles(event: FileUploadHandlerEvent): Promise<void> {
    const files = event.files ?? [];
    if (files.length === 0) return;
    this.uploading.set(true);
    for (const file of files) {
      const problem = await this.rejectReason(file);
      if (problem) {
        this.messages.add({ severity: 'warn', summary: 'No se agregó', detail: problem });
        continue;
      }
      await this.upload(file);
    }
    this.uploading.set(false);
  }

  /** Why this file cannot be a Status, or null. */
  private async rejectReason(file: File): Promise<string | null> {
    if (!file.type.startsWith('video/')) return null;
    if (file.type !== 'video/mp4') return `${file.name}: solo se admite video MP4.`;
    const seconds = await this.videoSeconds(file);
    // Checked here as well as on the server, so a 3-minute clip is refused before the
    // owner waits through its upload.
    if (seconds !== null && seconds > MAX_VIDEO_SECONDS) {
      return `${file.name}: el video dura ${Math.round(seconds)}s y el máximo es ${MAX_VIDEO_SECONDS}s.`;
    }
    return null;
  }

  private videoSeconds(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      const done = (value: number | null) => {
        URL.revokeObjectURL(url);
        resolve(value);
      };
      video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
      video.onerror = () => done(null);
      video.src = url;
    });
  }

  private upload(file: File): Promise<void> {
    return new Promise((resolve) => {
      this.assetsApi.upload('story', file).subscribe({
        next: (asset) => {
          this.media.update((list) => [...list, asset]);
          this.pending.update((ids) => new Set(ids).add(asset.id));
          resolve();
        },
        error: (e) => {
          this.messages.add({
            severity: 'error',
            summary: 'No se pudo subir',
            detail: apiErrorMessage(e, 'Revisa el tipo y el tamaño del archivo.'),
          });
          resolve();
        },
      });
    });
  }

  protected removeMedia(asset: Asset): void {
    this.media.update((list) => list.filter((a) => a.id !== asset.id));
    // Something uploaded in this session and then removed belongs to nothing, so it goes
    // now. Media already on a saved story is deleted by the API when the edit lands.
    if (!this.pending().has(asset.id)) return;
    this.pending.update((ids) => {
      const next = new Set(ids);
      next.delete(asset.id);
      return next;
    });
    this.assetsApi.remove(asset.id).subscribe({ error: () => undefined });
  }

  protected next(): void {
    this.step.update((s) => Math.min(3, s + 1));
  }

  protected back(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  protected save(): void {
    if (!this.canSave()) return;
    const input: StoryInput = {
      caption: this.caption().trim(),
      mode: this.mode(),
      weekdays: this.mode() === 'weekly' ? this.weekdays() : [],
      post_date: this.mode() === 'once' ? this.dateValue() : null,
      post_time: this.postTime(),
      delete_after: this.mode() === 'once' && this.deleteAfter(),
      enabled: this.editing()?.enabled ?? true,
      media: this.media().map((a) => a.id),
    };

    const existing = this.editing();
    const request = existing ? this.api.update(existing.id, input) : this.api.create(input);
    this.saving.set(true);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        // Saved, so these files have an owner and must not be cleaned up.
        this.pending.set(new Set());
        this.messages.add({
          severity: 'success',
          summary: existing ? 'Historia actualizada' : 'Historia programada',
          detail: this.summary(),
        });
        this.saved.emit();
        this.open.set(false);
      },
      error: (e) => {
        this.saving.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'No se pudo guardar',
          detail: apiErrorMessage(e),
        });
      },
    });
  }

  /** Closing without saving: the files uploaded here belong to nothing, so remove them. */
  protected cancel(): void {
    for (const id of this.pending()) {
      this.assetsApi.remove(id).subscribe({ error: () => undefined });
    }
    this.pending.set(new Set());
    this.open.set(false);
  }
}
