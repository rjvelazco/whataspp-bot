import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { Contact, StorySchedule } from './api-types';

export type { Contact, StorySchedule };

/** Response shape of POST /api/story/post-now (web-only, not a domain type). */
export interface StoryPostResult {
  posted: number;
  audience: number;
  reason: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);

  getStorySchedule(): Observable<StorySchedule> {
    return this.http.get<StorySchedule>('/api/settings/story-schedule');
  }

  saveStorySchedule(schedule: StorySchedule): Observable<StorySchedule> {
    return this.http.put<StorySchedule>('/api/settings/story-schedule', schedule);
  }

  postStoryNow(): Observable<StoryPostResult> {
    return this.http.post<StoryPostResult>('/api/story/post-now', {});
  }

  getContacts(): Observable<Contact[]> {
    return this.http.get<Contact[]>('/api/contacts');
  }
}
