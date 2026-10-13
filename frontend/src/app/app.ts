import { Component, computed, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  imports: [ReactiveFormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);

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
  }

  protected toggleAccountMenu(): void {
    this.isAccountMenuOpen = !this.isAccountMenuOpen;
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
