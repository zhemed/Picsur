import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PaginatorComponent } from './paginator.component';
import { I18nModule } from '../../i18n/i18n.module';
import { PipesModule } from '../../pipes/pipes.module';

@NgModule({
  declarations: [PaginatorComponent],
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    I18nModule,
    PipesModule,
  ],
  exports: [PaginatorComponent],
})
export class PaginatorModule {}
