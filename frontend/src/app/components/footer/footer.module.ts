import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { I18nModule } from '../../i18n/i18n.module';
import { FooterComponent } from './footer.component';

@NgModule({
  declarations: [FooterComponent],
  imports: [CommonModule, I18nModule],
  exports: [FooterComponent],
})
export class FooterModule {}
