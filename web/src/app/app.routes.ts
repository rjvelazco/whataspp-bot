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
      {
        path: 'productos',
        loadComponent: () => import('./productos/productos').then((m) => m.Productos),
      },
      { path: 'tienda', loadComponent: () => import('./tienda/tienda').then((m) => m.Tienda) },
      {
        path: 'recursos',
        loadComponent: () => import('./recursos/recursos').then((m) => m.Recursos),
      },
      {
        path: 'menus',
        loadComponent: () => import('./menus-view/menus-view').then((m) => m.MenusView),
      },
      // "Configuración" described where the view lived in the code; "Menús" describes
      // what the owner edits. The old path stays as a redirect so a bookmark or a deep
      // link the owner already has keeps working.
      { path: 'configuracion', redirectTo: 'menus', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: '' },
];
