import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  Story,
  StoryMediaItem,
  StoryMode,
  StoryPostReason,
  StoryPostResult,
} from './api-types';

// Re-exported, never re-declared: this union had already drifted once (no_stories ->
// no_media) while it was written out by hand on both sides.
export type { Story, StoryMediaItem, StoryMode, StoryPostReason, StoryPostResult };

/** What the API accepts. `media` is asset ids in posting order. */
export interface StoryInput {
  caption: string;
  mode: StoryMode;
  weekdays: number[];
  post_date: string | null;
  post_time: string;
  delete_after: boolean;
  enabled: boolean;
  media: string[];
}

@Injectable({ providedIn: 'root' })
export class StoriesService {
  private readonly http = inject(HttpClient);

  list(): Observable<Story[]> {
    return this.http.get<Story[]>('/api/stories');
  }

  create(input: StoryInput): Observable<Story> {
    return this.http.post<Story>('/api/stories', input);
  }

  update(id: string, input: StoryInput): Observable<Story> {
    return this.http.put<Story>(`/api/stories/${id}`, input);
  }

  remove(id: string): Observable<{ ok: boolean; removed: number }> {
    return this.http.delete<{ ok: boolean; removed: number }>(`/api/stories/${id}`);
  }

  postNow(id: string): Observable<StoryPostResult> {
    return this.http.post<StoryPostResult>(`/api/stories/${id}/post-now`, {});
  }
}
