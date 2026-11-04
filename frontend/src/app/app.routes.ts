import { Routes } from '@angular/router';
import { authGuard, userManagementGuard } from './core/auth.guard';
import { Contacts } from './pages/contacts/contacts';
import { Dashboard } from './pages/dashboard/dashboard';
import { DispatchPage } from './pages/dispatch/dispatch';
import { Login } from './pages/login/login';
import { Users } from './pages/users/users';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login',
  },
  {
    path: 'login',
    component: Login,
    title: 'Sign in - Synarome Dispatch',
  },
  {
    path: 'dashboard',
    component: Dashboard,
    canActivate: [authGuard],
    title: 'Synarome Dispatch Dashboard',
  },
  {
    path: 'users',
    component: Users,
    canActivate: [authGuard, userManagementGuard],
    title: 'Users - Synarome Dispatch',
  },
  {
    path: 'contacts',
    component: Contacts,
    canActivate: [authGuard],
    title: 'Contacts - Synarome Dispatch',
  },
  {
    path: 'dispatch',
    component: DispatchPage,
    canActivate: [authGuard],
    title: 'Dispatch - Synarome Dispatch',
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
