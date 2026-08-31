import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { Contact } from './api-types';

export type { Contact };

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);

  getContacts(): Observable<Contact[]> {
    return this.http.get<Contact[]>('/api/contacts');
  }
}
