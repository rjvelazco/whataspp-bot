import { Routes } from '@angular/router';
import { Pairing } from './pairing/pairing';

export const routes: Routes = [
  { path: '', component: Pairing },
  {
    path: 'dashboard',
    loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard),
    children: [
      { path: '', redirectTo: 'pagos', pathMatch: 'full' },
      { path: 'pagos', loadComponent: () => import('./pagos/pagos').then((m) => m.Pagos) },
      { path: 'pedidos', loadComponent: () => import('./pedidos/pedidos').then((m) => m.Pedidos) },
      { path: 'recursos', loadComponent: () => import('./recursos/recursos').then((m) => m.Recursos) },
      {
        path: 'configuracion',
        loadComponent: () => import('./configuracion/configuracion').then((m) => m.Configuracion),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
