import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { MarketingPerson } from './contacts.service';
import { AuthUser } from './auth.service';

export interface DispatchRecipient {
  id: number;
  person_id: number;
  delivery_status?: string | null;
  person?: MarketingPerson | null;
}

export interface DispatchRecord {
  id: number;
  sender_id: number;
  file_path?: string | null;
  message_text?: string | null;
  timestamp?: string | null;
  sender?: AuthUser | null;
  recipients: DispatchRecipient[];
}

export interface DispatchStats {
  total_dispatches: number;
  total_messages: number;
  messages_sent: number;
  messages_failed: number;
  today_dispatches: number;
  today_messages: number;
  total_contacts: number;
  active_contacts: number;
  delivery_rate: number;
  recent_dispatches: DispatchRecord[];
}

export interface HistoryFilters {
  search?: string;
  from_date?: string;
  to_date?: string;
  from_time?: string;
  to_time?: string;
  user_id?: number | null;
  person_id?: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class DispatchService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/v1/dispatch`;

  sendDispatch(recipientIds: number[], messageText: string, file: File | null): Observable<DispatchRecord> {
    const formData = new FormData();
    recipientIds.forEach((recipientId) => formData.append('recipient_ids', String(recipientId)));

    if (messageText.trim()) {
      formData.append('message_text', messageText.trim());
    }

    if (file) {
      formData.append('file', file);
    }

    return this.http.post<DispatchRecord>(`${this.baseUrl}/send`, formData);
  }

  listHistory(filters: HistoryFilters = {}): Observable<DispatchRecord[]> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return this.http.get<DispatchRecord[]>(`${this.baseUrl}/history`, { params });
  }

  getStats(): Observable<DispatchStats> {
    return this.http.get<DispatchStats>(`${this.baseUrl}/stats`);
  }

  downloadFile(dispatchId: number): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${dispatchId}/file`, {
      responseType: 'blob',
    });
  }
}

