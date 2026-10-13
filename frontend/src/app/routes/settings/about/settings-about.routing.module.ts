import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { PRoutes } from '../../../models/dto/picsur-routes.dto';
import { SettingsAboutComponent } from './settings-about.component';

const routes: PRoutes = [
  {
    path: '',
    component: SettingsAboutComponent,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SettingsAboutRoutingModule {}
