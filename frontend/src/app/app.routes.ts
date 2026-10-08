import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { Dashboard } from './pages/dashboard/dashboard';
import { Login } from './pages/login/login';

export const routes: Routes = [
  {
    path: 'login',
    component: Login,
    title: 'Sign in - Synarome Dispatch',
  },
  {
    path: '',
    component: Dashboard,
    canActivate: [authGuard],
    title: 'Synarome Dispatch Dashboard',
  },
  {
    path: '**',
    redirectTo: '',
  },
];
