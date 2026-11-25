import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SendResult {
  record_id: number;
  recipient_kind: 'marketing_person' | 'customer' | 'test' | 'customer_test';
  recipient_name: string;
  actual_recipient: string;
  status: string;
  message_id: string | null;
  error: string | null;
}

export interface SendResponse { mode: 'test' | 'live'; results: SendResult[]; }
export interface SendMode { mode: 'test' | 'live'; test_recipient: string | null; customer_test_recipient: string | null; }
export interface WindowStatus { all_open: boolean; recipients: { name: string; number: string; open: boolean; expires_at: string | null }[]; }

@Injectable({ providedIn: 'root' })
export class CustomerDispatchService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/api/v1/customer-dispatch`;

  mode(): Observable<SendMode> { return this.http.get<SendMode>(`${this.url}/mode`); }

  windowStatus(customerId: number, includeCustomer: boolean, marketingIds: number[], customerIds: number[]): Observable<WindowStatus> {
    return this.http.post<WindowStatus>(`${this.url}/window-status`, {
      customer_id: customerId, include_customer: includeCustomer,
      additional_marketing_person_ids: marketingIds, additional_customer_ids: customerIds,
    });
  }

  send(customerId: number, includeCustomer: boolean, message: string, file: File | null, additionalMarketingPersonIds: number[] = [], additionalCustomerIds: number[] = []): Observable<SendResponse> {
    if (!file) return this.http.post<SendResponse>(`${this.url}/text`, {
      customer_id: customerId, include_customer: includeCustomer, message: message.trim(),
      additional_marketing_person_ids: additionalMarketingPersonIds, additional_customer_ids: additionalCustomerIds,
    });
    const body = new FormData();
    body.append('customer_id', String(customerId));
    body.append('include_customer', String(includeCustomer));
    additionalMarketingPersonIds.forEach((id) => body.append('additional_marketing_person_ids', String(id)));
    additionalCustomerIds.forEach((id) => body.append('additional_customer_ids', String(id)));
    body.append('file', file);
    if (message.trim()) body.append('caption', message.trim());
    return this.http.post<SendResponse>(`${this.url}/media`, body);
  }
}
