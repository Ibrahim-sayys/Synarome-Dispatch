import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, expand, reduce } from 'rxjs';
import { environment } from '../../environments/environment';
import { MarketingPerson } from './contacts.service';
import { AuthUser } from './auth.service';
import { SendResult } from './customer-dispatch.service';

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
  send_mode?: 'contact' | 'whatsapp_test' | 'customer_dispatch' | 'customer_test';
  whatsapp_status?: string | null;
  whatsapp_message_id?: string | null;
  actual_recipient?: string | null;
  customer_id?: number | null;
  marketing_person_id?: number | null;
  recipient_kind?: string | null;
  customer_name?: string | null;
  marketing_person_name?: string | null;
  recipient_name?: string | null;
  recipient_customer_id?: number | null;
  recipient_marketing_person_id?: number | null;
  original_filename?: string | null;
  failure_reason?: string | null;
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
  customer_id?: number | null;
  recipient_customer_id?: number | null;
  dispatch_id?: number | null;
  timezone_offset_minutes?: number;
}

export interface HistorySender {
  id: number;
  username: string;
}

export interface HistoryPage {
  items: DispatchRecord[];
  total: number;
  page: number;
  page_size: number;
}

@Injectable({
  providedIn: 'root',
})
export class DispatchService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/v1/dispatch`;

  listHistory(filters: HistoryFilters = {}): Observable<DispatchRecord[]> {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return this.http.get<DispatchRecord[]>(`${this.baseUrl}/history`, { params });
  }

  listHistoryPage(filters: HistoryFilters = {}, page = 1, pageSize = 20): Observable<HistoryPage> {
    let params = new HttpParams().set('page', page).set('page_size', pageSize);
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    });
    return this.http.get<HistoryPage>(`${this.baseUrl}/history/page`, { params });
  }

  listFullHistory(filters: HistoryFilters = {}): Observable<DispatchRecord[]> {
    return this.listHistoryPage(filters, 1, 100).pipe(
      expand((result) => result.page * result.page_size < result.total
        ? this.listHistoryPage(filters, result.page + 1, 100)
        : EMPTY),
      reduce((records, result) => {
        records.push(...result.items);
        return records;
      }, [] as DispatchRecord[]),
    );
  }

  listHistorySenders(): Observable<HistorySender[]> {
    return this.http.get<HistorySender[]>(`${this.baseUrl}/senders`);
  }

  getStats(): Observable<DispatchStats> {
    return this.http.get<DispatchStats>(`${this.baseUrl}/stats`);
  }

  retry(dispatchId: number): Observable<SendResult> {
    return this.http.post<SendResult>(`${environment.apiBaseUrl}/api/v1/customer-dispatch/${dispatchId}/retry`, {});
  }

  downloadFile(dispatchId: number): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${dispatchId}/file`, {
      responseType: 'blob',
    });
  }
}

