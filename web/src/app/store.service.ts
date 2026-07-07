import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { Store } from './api-types';

export type { Store };

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
}
