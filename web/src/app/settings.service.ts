import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface StorySchedule {
  enabled: boolean;
  /** "HH:MM" 24h local time. */
  time: string;
}

export interface StoryPostResult {
  posted: number;
  audience: number;
  reason: string;
}

export interface Contact {
  wa_jid: string;
  phone: string | null;
  name: string | null;
  first_seen: string;
  last_seen: string;
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
