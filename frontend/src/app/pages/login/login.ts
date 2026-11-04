import { Component, OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly infoMessage = signal('');

  private readonly auth = inject(AuthService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly loginForm = this.formBuilder.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  ngOnInit(): void {
    const sessionExpired = this.route.snapshot.queryParamMap.get('sessionExpired');
    if (sessionExpired === 'true') {
      this.infoMessage.set('Your session has expired. Please sign in again.');
    }
  }

  submit(): void {
    this.errorMessage.set('');
    this.infoMessage.set('');

    if (this.loginForm.invalid || this.isSubmitting()) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    const { username, password } = this.loginForm.getRawValue();

    this.auth.login(username, password).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.router.navigateByUrl('/dashboard');
      },
      error: () => {
        this.isSubmitting.set(false);
        this.errorMessage.set('Invalid username or password.');
      },
    });
  }
}
