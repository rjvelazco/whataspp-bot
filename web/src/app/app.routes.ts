import { Routes } from '@angular/router';
import { Pairing } from './pairing/pairing';
import { Dashboard } from './dashboard/dashboard';

export const routes: Routes = [
  { path: '', component: Pairing },
  { path: 'dashboard', component: Dashboard },
  { path: '**', redirectTo: '' },
];
