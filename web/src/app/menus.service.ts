import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type FlowAction =
  | 'go_menu'
  | 'start_order'
  | 'show_category'
  | 'shipping_payments'
  | 'talk_human';

export interface FlowOption {
  label: string;
  action: FlowAction;
  target?: string;
}

export interface FlowMenu {
  key: string;
  name: string;
  trigger?: string;
  message: string;
  options: FlowOption[];
}

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
