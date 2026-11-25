import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';

export interface MediaRetention {
  interval_days: number;
  next_run: string;
  notice_at: string | null;
  cutoff_at: string | null;
  file_count: number;
  oldest: string | null;
  newest: string | null;
}

@Injectable({ providedIn: 'root' })
export class MediaRetentionService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/api/v1/media-retention`;
  get() { return this.http.get<MediaRetention>(this.url); }
  update(interval_days: number) { return this.http.put<MediaRetention>(this.url, { interval_days }); }
}
