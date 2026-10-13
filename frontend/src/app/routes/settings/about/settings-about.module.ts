import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CopyFieldModule } from '../../../components/copy-field/copy-field.module';
import { I18nModule } from '../../../i18n/i18n.module';
import { SettingsAboutComponent } from './settings-about.component';
import { SettingsAboutRoutingModule } from './settings-about.routing.module';

@NgModule({
  declarations: [SettingsAboutComponent],
  imports: [
    CommonModule,
    I18nModule,
    SettingsAboutRoutingModule,
    CopyFieldModule,
    MatButtonModule,
    MatIconModule,
  ],
})
export default class SettingsAboutRouteModule {}
