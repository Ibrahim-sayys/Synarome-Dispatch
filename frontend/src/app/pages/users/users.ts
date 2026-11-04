import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService, AuthUser } from '../../core/auth.service';
import { UsersService } from '../../core/users.service';

@Component({
  selector: 'app-users',
  imports: [ReactiveFormsModule],
  templateUrl: './users.html',
  styleUrl: './users.css',
})
export class Users implements OnInit {
  protected readonly users = signal<AuthUser[]>([]);
  protected readonly isLoading = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly isResetting = signal(false);
  protected readonly message = signal('');
  protected readonly isErrorMessage = signal(false);
  protected readonly resetTarget = signal<AuthUser | null>(null);
  protected readonly currentUser = inject(AuthService).currentUser;
  protected readonly roleOptions = computed(() => {
    const role = this.currentUser()?.role;
    if (role === 'super_admin') {
      return [
        { value: 'manager', label: 'Manager' },
        { value: 'user', label: 'User' },
      ] as const;
    }

    if (role === 'manager') {
      return [{ value: 'user', label: 'User' }] as const;
    }

    return [] as const;
  });

  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly usersService = inject(UsersService);

  protected readonly userForm = this.formBuilder.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    role: ['user' as AuthUser['role'], Validators.required],
  });

  protected readonly resetForm = this.formBuilder.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected get createUserPassword(): string {
    return this.userForm.get('password')?.value || '';
  }

  protected get resetUserPassword(): string {
    return this.resetForm.get('password')?.value || '';
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

  ngOnInit(): void {
    this.loadUsers();
  }

  protected loadUsers(): void {
    this.isLoading.set(true);
    this.usersService.listUsers().subscribe({
      next: (users) => {
        this.users.set(users);
        this.isLoading.set(false);
      },
      error: () => {
        this.showMessage('Unable to load users.', true);
        this.isLoading.set(false);
      },
    });
  }

  protected createUser(): void {
    this.clearMessage();

    if (this.userForm.invalid || this.isSaving()) {
      this.userForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    this.usersService.createUser(this.userForm.getRawValue()).subscribe({
      next: () => {
        this.showMessage('User created.');
        this.userForm.reset({ username: '', password: '', role: this.roleOptions()[0]?.value ?? 'user' });
        this.isSaving.set(false);
        this.loadUsers();
      },
      error: (error) => {
        this.showMessage(error.error?.detail ?? 'Unable to create user.', true);
        this.isSaving.set(false);
      },
    });
  }

  protected openResetDialog(user: AuthUser): void {
    this.clearMessage();
    this.resetTarget.set(user);
    this.resetForm.reset({ password: '' });
  }

  protected closeResetDialog(): void {
    this.resetTarget.set(null);
    this.resetForm.reset({ password: '' });
  }

  protected resetPassword(): void {
    this.clearMessage();
    const target = this.resetTarget();

    if (!target || this.resetForm.invalid || this.isResetting()) {
      this.resetForm.markAllAsTouched();
      return;
    }

    this.isResetting.set(true);
    this.usersService.resetPassword(target.id, this.resetForm.getRawValue().password).subscribe({
      next: () => {
        this.showMessage(`Password reset for ${target.username}.`);
        this.closeResetDialog();
        this.isResetting.set(false);
      },
      error: (error) => {
        this.showMessage(error.error?.detail ?? 'Unable to reset password.', true);
        this.isResetting.set(false);
      },
    });
  }

  protected canResetPassword(user: AuthUser): boolean {
    const actor = this.currentUser();
    if (!actor || actor.id === user.id) {
      return false;
    }

    if (actor.role === 'super_admin') {
      return user.role === 'manager' || user.role === 'user';
    }

    return actor.role === 'manager' && user.role === 'user';
  }

  private showMessage(message: string, isError = false): void {
    this.message.set(message);
    this.isErrorMessage.set(isError);
  }

  private clearMessage(): void {
    this.message.set('');
    this.isErrorMessage.set(false);
  }
}
