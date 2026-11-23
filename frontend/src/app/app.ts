import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { timer } from 'rxjs';
import { MediaRetention, MediaRetentionService } from './core/media-retention.service';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  imports: [ReactiveFormsModule, RouterLink, RouterLinkActive, RouterOutlet, DatePipe],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly mediaRetention = inject(MediaRetentionService);
  protected readonly cleanupNotice = signal<MediaRetention | null>(null);
  protected readonly retention = signal<MediaRetention | null>(null);
  protected readonly retentionError = signal('');
  protected readonly retentionMessage = signal('');
  protected readonly retentionSaving = signal(false);
  protected readonly retentionLoading = signal(false);
  protected isRetentionDialogOpen = false;
  protected readonly retentionForm = this.formBuilder.group({ days: [10, [Validators.required, Validators.min(2), Validators.max(3650), Validators.pattern(/^[0-9]+$/)]] });

  protected isAccountMenuOpen = false;
  protected isPasswordDialogOpen = false;
  protected passwordMessage = '';
  protected theme: 'light' | 'dark' = (localStorage.getItem('synarome_theme') as 'light' | 'dark') || 'light';
  protected readonly currentUser = this.auth.currentUser;
  protected readonly canManageUsers = computed(() => {
    const role = this.currentUser()?.role;
    return role === 'super_admin' || role === 'manager';
  });
  protected readonly passwordForm = this.formBuilder.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected isLoginPage(): boolean {
    return this.router.url.startsWith('/login');
  }

  constructor() {
    this.applyTheme();
    effect((onCleanup) => {
      if (this.currentUser()?.role !== 'super_admin') { this.cleanupNotice.set(null); return; }
      const subscription = timer(0, 60000).subscribe(() => {
        this.mediaRetention.get().subscribe({ next: (value) => this.cleanupNotice.set(value.notice_at ? value : null), error: () => this.cleanupNotice.set(null) });
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (this.isAccountMenuOpen && !target.closest('.account-menu')) {
      this.isAccountMenuOpen = false;
    }
  }

  protected toggleAccountMenu(event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    this.isAccountMenuOpen = !this.isAccountMenuOpen;
  }

  protected openRetentionDialog(): void {
    this.isAccountMenuOpen = false;
    this.isRetentionDialogOpen = true;
    this.retention.set(null);
    this.retentionError.set('');
    this.retentionMessage.set('');
    this.retentionLoading.set(true);
    this.mediaRetention.get().subscribe({
      next: (value) => {
        this.retention.set(value);
        this.retentionForm.setValue({ days: value.interval_days });
        this.retentionLoading.set(false);
      },
      error: () => { this.retentionError.set('Could not load the media cleanup schedule.'); this.retentionLoading.set(false); },
    });
  }

  protected saveRetention(): void {
    if (this.retentionForm.invalid || this.retentionSaving() || !this.retention()) return;
    this.retentionSaving.set(true);
    this.retentionError.set('');
    this.retentionMessage.set('');
    this.mediaRetention.update(this.retentionForm.getRawValue().days).subscribe({
      next: (value) => {
        this.retention.set(value);
        this.cleanupNotice.set(value.notice_at ? value : null);
        this.retentionSaving.set(false);
        this.retentionMessage.set('Cleanup schedule updated.');
      },
      error: () => { this.retentionError.set('Could not save the media cleanup schedule.'); this.retentionSaving.set(false); },
    });
  }

  protected get newPasswordValue(): string {
    return this.passwordForm.get('newPassword')?.value || '';
  }

  protected getPasswordStrength(password: string): { label: string; class: string; width: string } {
    if (!password) {
      return { label: '', class: '', width: '0%' };
    }
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 10) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score <= 1) {
      return { label: 'Weak', class: 'weak', width: '25%' };
    } else if (score === 2) {
      return { label: 'Fair', class: 'fair', width: '50%' };
    } else if (score === 3 || score === 4) {
      return { label: 'Good', class: 'good', width: '75%' };
    } else {
      return { label: 'Strong', class: 'strong', width: '100%' };
    }
  }

  protected openPasswordDialog(): void {
    this.isAccountMenuOpen = false;
    this.isPasswordDialogOpen = true;
    this.passwordMessage = '';
    this.passwordForm.reset({
      currentPassword: '',
      newPassword: '',
    });
  }

  protected closePasswordDialog(): void {
    this.isPasswordDialogOpen = false;
  }

  protected changePassword(): void {
    this.passwordMessage = '';

    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    this.auth.changePassword(currentPassword, newPassword).subscribe({
      next: () => {
        this.closePasswordDialog();
        this.auth.logout();
        this.router.navigateByUrl('/login');
      },
      error: (error) => {
        this.passwordMessage = error.error?.detail ?? 'Unable to change password.';
      },
    });
  }

  protected logout(): void {
    this.isAccountMenuOpen = false;
    this.auth.endSession().subscribe(() => {
      this.router.navigateByUrl('/login');
    });
  }

  protected toggleTheme(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('synarome_theme', this.theme);
    this.applyTheme();
    this.isAccountMenuOpen = false;
  }

  private applyTheme(): void {
    document.documentElement.dataset['theme'] = this.theme;
  }
}
