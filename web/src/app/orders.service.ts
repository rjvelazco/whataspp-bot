import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { Order, OrderItem, OrderStatus } from './api-types';

export type { Order, OrderItem, OrderStatus };

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly http = inject(HttpClient);

  list(): Observable<Order[]> {
    return this.http.get<Order[]>('/api/orders');
  }

  verify(orderId: string): Observable<{ order: Order; notified: boolean }> {
    return this.http.post<{ order: Order; notified: boolean }>(`/api/orders/${orderId}/verify`, {});
  }

  remind(orderId: string): Observable<{ notified: boolean }> {
    return this.http.post<{ notified: boolean }>(`/api/orders/${orderId}/remind`, {});
  }

  cancel(orderId: string): Observable<{ order: Order; notified: boolean }> {
    return this.http.post<{ order: Order; notified: boolean }>(`/api/orders/${orderId}/cancel`, {});
  }

  ship(orderId: string): Observable<{ order: Order; notified: boolean }> {
    return this.http.post<{ order: Order; notified: boolean }>(`/api/orders/${orderId}/ship`, {});
  }

  deliver(orderId: string): Observable<{ order: Order; notified: boolean }> {
    return this.http.post<{ order: Order; notified: boolean }>(`/api/orders/${orderId}/deliver`, {});
  }

  receiptUrl(orderId: string): string {
    return `/api/orders/${orderId}/receipt`;
  }
}
