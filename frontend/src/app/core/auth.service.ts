import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AuthUser {
  id: number;
  username: string;
  role: 'super_admin' | 'manager' | 'user';
  created_at?: string | null;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
  user: AuthUser;
}

const tokenStorageKey = 'synarome_access_token';
const userStorageKey = 'synarome_user';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly token = signal<string | null>(localStorage.getItem(tokenStorageKey));
  private readonly user = signal<AuthUser | null>(this.getStoredUser());

  readonly currentUser = this.user.asReadonly();
  readonly isAuthenticated = computed(() => Boolean(this.token()));

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiBaseUrl}/api/v1/auth/login`, {
        username,
        password,
      })
      .pipe(
        tap((response) => {
          this.token.set(response.access_token);
          this.user.set(response.user);
          localStorage.setItem(tokenStorageKey, response.access_token);
          localStorage.setItem(userStorageKey, JSON.stringify(response.user));
        }),
      );
  }

  logout(): void {
    this.token.set(null);
    this.user.set(null);
    localStorage.removeItem(tokenStorageKey);
    localStorage.removeItem(userStorageKey);
  }

  getAccessToken(): string | null {
    return this.token();
  }

  private getStoredUser(): AuthUser | null {
    const value = localStorage.getItem(userStorageKey);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as AuthUser;
    } catch {
      localStorage.removeItem(userStorageKey);
      return null;
    }
  }
}
