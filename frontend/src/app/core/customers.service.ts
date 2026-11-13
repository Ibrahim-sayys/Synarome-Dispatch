import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { MarketingPerson } from './contacts.service';

export interface Customer {
  id: number;
  full_name: string;
  phone_number: string | null;
  city: string | null;
  other_info: string | null;
  marketing_person_id: number;
  marketing_person: MarketingPerson;
}

export interface CustomerPayload {
  full_name: string;
  phone_number: string | null;
  city: string | null;
  other_info: string | null;
  marketing_person_id: number;
}

export interface CustomerPage {
  items: Customer[];
  total: number;
  page: number;
  page_size: number;
}

export interface CustomerFilters { marketing_person_id?: number | null; city?: string; phone_status?: 'all' | 'with_phone' | 'without_phone'; }

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/api/v1/customers`;

  list(search = '', page = 1, pageSize = 25, filters: CustomerFilters = {}): Observable<CustomerPage> {
    let params = new HttpParams().set('page', page).set('page_size', pageSize);
    if (search.trim()) params = params.set('search', search.trim());
    if (filters.marketing_person_id) params = params.set('marketing_person_id', filters.marketing_person_id);
    if (filters.city) params = params.set('city', filters.city);
    if (filters.phone_status && filters.phone_status !== 'all') params = params.set('phone_status', filters.phone_status);
    return this.http.get<CustomerPage>(`${this.url}/`, { params });
  }

  filterOptions(): Observable<{ cities: string[] }> { return this.http.get<{ cities: string[] }>(`${this.url}/filters`); }

  create(payload: CustomerPayload): Observable<Customer> {
    return this.http.post<Customer>(`${this.url}/`, payload);
  }

  update(id: number, payload: CustomerPayload): Observable<Customer> {
    return this.http.put<Customer>(`${this.url}/${id}`, payload);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }
}
