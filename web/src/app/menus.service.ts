import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { FlowAction, FlowIssue, FlowMenu, FlowOption } from './api-types';

export type { FlowAction, FlowIssue, FlowMenu, FlowOption };

/** Response of PUT /api/menus: ok + persisted count + any validation issues (warnings). */
export interface SaveMenusResult {
  ok: boolean;
  count: number;
  issues: FlowIssue[];
}

@Injectable({ providedIn: 'root' })
export class MenusService {
  private readonly http = inject(HttpClient);

  get(): Observable<FlowMenu[]> {
    return this.http.get<FlowMenu[]>('/api/menus');
  }

  save(menus: FlowMenu[]): Observable<SaveMenusResult> {
    return this.http.put<SaveMenusResult>('/api/menus', { menus });
  }
}
