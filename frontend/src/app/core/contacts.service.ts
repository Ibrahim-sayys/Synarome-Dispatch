import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface MarketingPerson {
  id: number;
  full_name: string;
  phone_number: string;
  is_active: boolean;
  added_by?: number | null;
  suspended_by?: number | null;
  suspended_by_username?: string | null;
}

export interface ContactPayload {
  full_name: string;
  phone_number: string;
  is_active?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class ContactsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/v1/contacts`;

  listContacts(search = '', includeInactive = true): Observable<MarketingPerson[]> {
    let params = new HttpParams().set('include_inactive', String(includeInactive));

    if (search.trim()) {
      params = params.set('search', search.trim());
    }

    return this.http.get<MarketingPerson[]>(`${this.baseUrl}/`, { params });
  }

  createContact(payload: ContactPayload): Observable<MarketingPerson> {
    return this.http.post<MarketingPerson>(`${this.baseUrl}/`, payload);
  }

  updateContact(id: number, payload: Partial<ContactPayload>): Observable<MarketingPerson> {
    return this.http.put<MarketingPerson>(`${this.baseUrl}/${id}`, payload);
  }

  deactivateContact(id: number): Observable<MarketingPerson> {
    return this.http.delete<MarketingPerson>(`${this.baseUrl}/${id}`);
  }
}
