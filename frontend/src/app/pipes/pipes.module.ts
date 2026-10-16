import { NgModule } from '@angular/core';
import { PermissionLabelPipe } from './permission-label.pipe';
import { RangePipe } from './range.pipe';
import { TruncatePipe } from './truncate.pipe';

@NgModule({
  declarations: [PermissionLabelPipe, TruncatePipe, RangePipe],
  exports: [PermissionLabelPipe, TruncatePipe, RangePipe],
})
export class PipesModule {}
