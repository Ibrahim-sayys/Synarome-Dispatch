import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  auth.logout();
  return router.createUrlTree(['/login']);
};

export const userManagementGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    auth.logout();
    return router.createUrlTree(['/login']);
  }

  const role = auth.currentUser()?.role;
  if (role === 'super_admin' || role === 'manager') {
    return true;
  }

  return router.createUrlTree(['/dashboard']);
};
