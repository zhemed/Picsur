import { PortalModule } from '@angular/cdk/portal';
import { NgModule } from '@angular/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { MatSidenavModule } from '@angular/material/sidenav';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app.routing.module';
import { HeaderModule } from './components/header/header.module';
import { GuardsModule } from './guards/guards.module';
import { PicsurPaginatorIntl } from './i18n/paginator.i18n';
import { ApiErrorManagerModule } from './util/api-error-manager/api-error-manager.module';
import { CompatibilityManagerModule } from './util/compatibilitiy-manager/compatibility-manager.module';
import { SnackBarManagerModule } from './util/snackbar-manager/snackbar-manager.module';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    PortalModule,
    MatSidenavModule,

    SnackBarManagerModule.forRoot(),
    CompatibilityManagerModule,
    ApiErrorManagerModule,

    GuardsModule,
    AppRoutingModule,

    HeaderModule,
  ],
  providers: [
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', color: 'accent' },
    },
    // Translate the built-in labels of `MatPaginator` (settings tables).
    {
      provide: MatPaginatorIntl,
      useClass: PicsurPaginatorIntl,
    },
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
