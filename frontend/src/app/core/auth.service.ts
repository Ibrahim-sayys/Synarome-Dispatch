import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, of, tap } from 'rxjs';
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

interface JwtPayload {
  exp?: number;
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
  readonly isAuthenticated = computed(() => {
    const token = this.token();
    return token !== null && !this.isTokenExpired(token);
  });

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

  changePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiBaseUrl}/api/v1/auth/change-password`, {
      current_password: currentPassword,
      new_password: newPassword,
    });
  }

  endSession(): Observable<unknown> {
    return this.http.post(`${environment.apiBaseUrl}/api/v1/auth/logout`, {}).pipe(
      catchError(() => of(null)),
      finalize(() => this.logout()),
    );
  }

  logout(): void {
    this.token.set(null);
    this.user.set(null);
    localStorage.removeItem(tokenStorageKey);
    localStorage.removeItem(userStorageKey);
    sessionStorage.clear();
  }

  getAccessToken(): string | null {
    const token = this.token();
    if (!token || this.isTokenExpired(token)) {
      this.logout();
      return null;
    }

    return token;
  }

  private isTokenExpired(token: string): boolean {
    const payload = this.decodeJwtPayload(token);
    if (!payload?.exp) {
      return true;
    }

    return payload.exp * 1000 <= Date.now();
  }

  private decodeJwtPayload(token: string): JwtPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    try {
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
      return JSON.parse(json) as JwtPayload;
    } catch {
      return null;
    }
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
