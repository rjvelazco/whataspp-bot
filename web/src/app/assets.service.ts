import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { Asset, AssetCategory } from './api-types';

export type { Asset, AssetCategory };

@Injectable({ providedIn: 'root' })
export class AssetsService {
  private readonly http = inject(HttpClient);

  list(): Observable<Asset[]> {
    return this.http.get<Asset[]>('/api/assets');
  }

  upload(category: AssetCategory, file: File): Observable<Asset> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<Asset>(`/api/assets/${category}`, form);
  }

  remove(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/assets/${id}`);
  }

  fileUrl(id: string): string {
    return `/api/assets/${id}/file`;
  }
}
