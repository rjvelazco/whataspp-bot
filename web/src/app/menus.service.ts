import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { FlowAction, FlowMenu, FlowOption } from './api-types';

export type { FlowAction, FlowMenu, FlowOption };

@Injectable({ providedIn: 'root' })
export class MenusService {
  private readonly http = inject(HttpClient);

  get(): Observable<FlowMenu[]> {
    return this.http.get<FlowMenu[]>('/api/menus');
  }

  save(menus: FlowMenu[]): Observable<{ ok: boolean; count: number }> {
    return this.http.put<{ ok: boolean; count: number }>('/api/menus', { menus });
  }
}
