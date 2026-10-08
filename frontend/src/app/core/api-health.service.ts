import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ApiHealth {
  status: string;
}

@Injectable({
  providedIn: 'root',
})
export class ApiHealthService {
  private readonly http = inject(HttpClient);

  getHealth(): Observable<ApiHealth> {
    return this.http.get<ApiHealth>(`${environment.apiBaseUrl}/health`);
  }
}
