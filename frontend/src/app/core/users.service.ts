import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthUser } from './auth.service';

export interface UserCreatePayload {
  username: string;
  password: string;
  role: AuthUser['role'];
}

@Injectable({
  providedIn: 'root',
})
export class UsersService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/api/v1/users`;

  listUsers(): Observable<AuthUser[]> {
    return this.http.get<AuthUser[]>(`${this.baseUrl}/`);
  }

  createUser(payload: UserCreatePayload): Observable<AuthUser> {
    return this.http.post<AuthUser>(`${this.baseUrl}/`, payload);
  }

  resetPassword(userId: number, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/${userId}/reset-password`, { password });
  }
}
