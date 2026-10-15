import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DropzoneComponent, FileInputDirective } from '@ngx-dropzone/cdk';
import { I18nModule } from '../../i18n/i18n.module';
import { ErrorManagerModule } from '../../util/error-manager/error-manager.module';
import { CustomDropzone } from './dropzone/dropzone.component';
import { UploadComponent } from './upload.component';
import { UploadRoutingModule } from './upload.routing.module';

@NgModule({
  declarations: [UploadComponent, CustomDropzone],
  imports: [
    CommonModule,
    ErrorManagerModule,
    I18nModule,
    UploadRoutingModule,
    ReactiveFormsModule,
    // v19 dropped DropzoneCdkModule: the pieces are standalone now.
    DropzoneComponent,
    FileInputDirective,
  ],
})
export default class UploadRouteModule {}
