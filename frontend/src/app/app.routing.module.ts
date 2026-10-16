import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { PRoutes } from './models/dto/picsur-routes.dto';

const routes: PRoutes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'upload',
  },
  {
    path: 'upload',
    loadChildren: () =>
      import('./routes/upload/upload.module').then((m) => m.default),
  },
  {
    path: 'processing',
    loadChildren: () =>
      import('./routes/processing/processing.module').then((m) => m.default),
  },
  {
    path: 'view',
    loadChildren: () =>
      import('./routes/view/view.module').then((m) => m.default),
  },
  {
    path: 'user',
    loadChildren: () =>
      import('./routes/user/user.module').then((m) => m.default),
  },
  {
    path: 'images',
    loadChildren: () =>
      import('./routes/images/images.module').then((m) => m.default),
  },
  {
    path: 'settings',
    loadChildren: () =>
      import('./routes/settings/settings.module').then((m) => m.default),
  },
  {
    path: 'error',
    loadChildren: () =>
      import('./routes/errors/errors.module').then((m) => m.default),
  },
  // Unknown urls (an old bookmark, a removed page) land on the 404 page. Without
  // this the router matches nothing and the layout renders an empty outlet,
  // which looks like a broken white page.
  {
    path: '**',
    redirectTo: 'error/404',
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
