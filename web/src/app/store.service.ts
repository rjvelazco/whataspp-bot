import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  BotPreview,
  RateRefreshOutcome,
  RateSource,
  RateSourceOption,
  Store,
  StoreKeywords,
} from './api-types';

// Re-exported, never re-declared: both of these had been retyped by hand here, which is
// the shape of every duplication CLAUDE.md already lists.
export type { BotPreview, RateRefreshOutcome, RateSource, RateSourceOption, Store, StoreKeywords };

export interface RateRefreshResult {
  outcome: RateRefreshOutcome;
  usd_rate: number | null;
  usd_rate_updated_at: string | null;
  rate_failed_at: string | null;
}

/** Editable store payload. usd_rate accepts null to clear the rate on the server. */
export type StoreUpdate = Partial<Omit<Store, 'usd_rate'>> & { usd_rate?: number | null };

@Injectable({ providedIn: 'root' })
export class StoreService {
  private readonly http = inject(HttpClient);

  get(): Observable<Store> {
    return this.http.get<Store>('/api/store');
  }

  save(store: StoreUpdate): Observable<Store> {
    return this.http.put<Store>('/api/store', store);
  }

  /**
   * The bot's real answers for an unsaved draft.
   *
   * A round trip rather than rebuilding the strings here: the panel used to keep its
   * own copies and they had drifted from what the bot actually said.
   */
  preview(draft: StoreUpdate): Observable<BotPreview> {
    return this.http.post<BotPreview>('/api/store/preview', draft);
  }

  /** The dropdown's options, with their labels and units, from the domain model. */
  rateSources(): Observable<RateSourceOption[]> {
    return this.http.get<RateSourceOption[]>('/api/store/rate-sources');
  }

  /** What a source quotes right now — a preview, nothing is saved. */
  quoteRate(source: RateSource): Observable<{ rate: number | null; updated_at: string | null }> {
    return this.http.get<{ rate: number | null; updated_at: string | null }>(
      `/api/store/rate/quote?source=${encodeURIComponent(source)}`,
    );
  }

  refreshRate(): Observable<RateRefreshResult> {
    return this.http.post<RateRefreshResult>('/api/store/rate/refresh', {});
  }
}
