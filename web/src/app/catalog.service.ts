import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { CatalogItem, Variant } from './api-types';

export type { CatalogItem, Variant };

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);

  list(): Observable<CatalogItem[]> {
    return this.http.get<CatalogItem[]>('/api/catalog');
  }

  create(item: CatalogItem): Observable<CatalogItem> {
    return this.http.post<CatalogItem>('/api/catalog', item);
  }

  update(id: string, item: CatalogItem): Observable<CatalogItem> {
    return this.http.put<CatalogItem>(`/api/catalog/${id}`, item);
  }

  remove(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/catalog/${id}`);
  }

  uploadPhoto(id: string, file: File): Observable<CatalogItem> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<CatalogItem>(`/api/catalog/${id}/photo`, form);
  }

  photoUrl(id: string): string {
    return `/api/catalog/${id}/photo`;
  }
}
