import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { RateSource, Store, StoreKeywords } from './api-types';

export type { RateSource, Store, StoreKeywords };

/** What the bot would actually reply, built by the engine's own reply builders. */
export interface BotPreview {
  rate: string;
  address: string;
  shipping: string;
  payment: string;
  hours: string;
}

export interface RateRefreshResult {
  outcome: 'updated' | 'unchanged' | 'manual_source' | 'failed' | 'no_store';
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

  refreshRate(): Observable<RateRefreshResult> {
    return this.http.post<RateRefreshResult>('/api/store/rate/refresh', {});
  }
}
