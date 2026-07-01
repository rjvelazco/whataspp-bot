import { Routes } from '@angular/router';
import { Pairing } from './pairing/pairing';

export const routes: Routes = [
  { path: '', component: Pairing },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  { path: '**', redirectTo: '' },
];
