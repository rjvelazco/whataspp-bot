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

  /**
   * Which menu is the bot's first message.
   *
   * Asked for rather than worked out here: the rule lived in the panel *and* in
   * `findEntryMenu`, and CLAUDE.md lists the pair as a shipped duplication.
   */
  entryKey(): Observable<{ key: string | null }> {
    return this.http.get<{ key: string | null }>('/api/menus/entry');
  }

  /** Every menu's text with its tokens resolved, keyed by menu key. */
  previews(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>('/api/menus/previews');
  }

  /** What an unsaved draft would send, rendered by the bot's own builder. */
  preview(menu: FlowMenu): Observable<{ text: string }> {
    return this.http.post<{ text: string }>('/api/menus/preview', menu);
  }
}
