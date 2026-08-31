import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  inject,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageService } from 'primeng/api';
import * as L from 'leaflet';
import { parseMapsUrl, toMapsUrl, type LatLng } from './maps-url';

/**
 * Pick the shop's location on a map instead of pasting a link.
 *
 * OpenStreetMap through Leaflet: no API key, no billing account, and nothing that can
 * be abused if the page is ever public. Google's JavaScript API needs a key tied to a
 * card on file even inside its free tier, which is a lot of setup to ask of a shop
 * owner for one field.
 *
 * The pin only ever sets the *link*. The address stays whatever the owner typed — they
 * know their own address better than a geocoder does, and that text is what the bot
 * sends to customers.
 */

/** Caracas, as a first view for a store that has never set a location. */
const DEFAULT_CENTRE: [number, number] = [10.4806, -66.9036];
const DEFAULT_ZOOM = 12;
const PIN_ZOOM = 17;

/** Nominatim asks for at most one request a second. */
const SEARCH_DEBOUNCE_MS = 700;

interface SearchHit {
  label: string;
  lat: number;
  lng: number;
}

@Component({
  selector: 'app-map-picker',
  imports: [DecimalPipe, FormsModule, ButtonModule, DialogModule, InputTextModule],
  templateUrl: './map-picker.html',
  styleUrl: './map-picker.css',
})
export class MapPicker implements OnDestroy {
  private readonly messages = inject(MessageService);

  readonly open = model.required<boolean>();
  /** Emitted with the new maps link when the owner confirms. */
  readonly picked = output<string>();
  /** The link currently saved, so reopening returns to the same pin. */
  readonly current = model<string>('');

  protected readonly point = signal<LatLng | null>(null);
  protected readonly searching = signal(false);
  protected readonly hits = signal<SearchHit[]>([]);
  protected query = '';

  private readonly host = viewChild<ElementRef<HTMLElement>>('map');
  private map?: L.Map;
  private marker?: L.Marker;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private resize?: ResizeObserver;

  constructor() {
    afterNextRender(() => this.build());
    // The dialog renders its content lazily, so the container only exists once open.
    effect(() => {
      if (this.open()) queueMicrotask(() => this.build());
      else this.teardown();
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
    this.teardown();
  }

  private teardown(): void {
    this.resize?.disconnect();
    this.resize = undefined;
    this.map?.remove();
    this.map = undefined;
    this.marker = undefined;
  }

  /**
   * Wait for the container to have a size, then build.
   *
   * The dialog animates open, so on the first frames the box is 0x0. Leaflet measured
   * that, laid out a one-tile grid for it, and an `invalidateSize()` afterwards left
   * the panes offset — tiles bunched in the middle with one escaping the box.
   */
  private build(): void {
    const el = this.host()?.nativeElement;
    if (!el || this.map || this.resize) return;

    this.resize = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      if (this.map) this.map.invalidateSize();
      else this.create(el);
    });
    this.resize.observe(el);
    // Already laid out (reopening a dialog the browser kept sized) — nothing to wait for.
    if (el.clientWidth > 0 && el.clientHeight > 0) this.create(el);
  }

  private create(el: HTMLElement): void {
    if (this.map) return;
    const saved = parseMapsUrl(this.current());
    this.point.set(saved);

    this.map = L.map(el, { attributionControl: true }).setView(
      saved ? [saved.lat, saved.lng] : DEFAULT_CENTRE,
      saved ? PIN_ZOOM : DEFAULT_ZOOM,
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Required by the OpenStreetMap tile usage policy.
      attribution: '© colaboradores de OpenStreetMap',
    }).addTo(this.map);

    this.map.on('click', (e: L.LeafletMouseEvent) => this.setPoint(e.latlng));
    if (saved) this.setPoint(saved, false);
  }

  /**
   * A div-based pin rather than Leaflet's default image.
   *
   * Its marker icons are resolved from a bundler-relative path that breaks under
   * Angular's build, and a CSS pin also lets the marker use the design tokens.
   */
  private pinIcon(): L.DivIcon {
    return L.divIcon({
      className: 'store-pin',
      html: '<span class="store-pin-dot"></span>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  private setPoint(latlng: LatLng | L.LatLng, recentre = true): void {
    const point: LatLng = { lat: latlng.lat, lng: latlng.lng };
    this.point.set(point);
    if (!this.map) return;

    if (this.marker) this.marker.setLatLng(point);
    else this.marker = L.marker(point, { icon: this.pinIcon(), keyboard: false }).addTo(this.map);
    if (recentre) this.map.panTo(point);
  }

  /** Look the place up by name, so nobody has to pan across a country. */
  protected onSearchInput(): void {
    clearTimeout(this.searchTimer);
    const q = this.query.trim();
    if (q.length < 3) {
      this.hits.set([]);
      return;
    }
    this.searchTimer = setTimeout(() => void this.search(q), SEARCH_DEBOUNCE_MS);
  }

  private async search(q: string): Promise<void> {
    this.searching.set(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(String(response.status));
      const raw = (await response.json()) as { display_name: string; lat: string; lon: string }[];
      this.hits.set(
        raw
          .map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }))
          .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng)),
      );
    } catch {
      this.hits.set([]);
      this.messages.add({
        severity: 'warn',
        summary: 'No se pudo buscar',
        detail: 'Puedes tocar el mapa para poner el punto a mano.',
      });
    } finally {
      this.searching.set(false);
    }
  }

  protected choose(hit: SearchHit): void {
    this.hits.set([]);
    this.query = hit.label;
    this.setPoint({ lat: hit.lat, lng: hit.lng });
    this.map?.setView([hit.lat, hit.lng], PIN_ZOOM);
  }

  protected confirm(): void {
    const point = this.point();
    if (!point) return;
    this.picked.emit(toMapsUrl(point));
    this.open.set(false);
  }

  protected cancel(): void {
    this.open.set(false);
  }
}
