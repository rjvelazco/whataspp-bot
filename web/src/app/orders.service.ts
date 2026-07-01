import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type OrderStatus =
  | 'pending_payment'
  | 'payment_submitted'
  | 'confirmed'
  | 'shipped'
  | 'cancelled';

export interface OrderItem {
  code: string;
  size: string;
  color: string;
  qty: number;
  price: number;
}

export interface Order {
  order_id: string;
  store_id: string;
  customer_wa: string;
  customer_name: string;
  items: OrderItem[];
  delivery_address: string;
  subtotal: number;
  status: OrderStatus;
  receipt_url?: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly http = inject(HttpClient);

  list(): Observable<Order[]> {
    return this.http.get<Order[]>('/api/orders');
  }

  verify(orderId: string): Observable<{ order: Order; notified: boolean }> {
    return this.http.post<{ order: Order; notified: boolean }>(`/api/orders/${orderId}/verify`, {});
  }

  receiptUrl(orderId: string): string {
    return `/api/orders/${orderId}/receipt`;
  }
}
