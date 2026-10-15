import { Component } from '@angular/core';
import { DropzoneComponent } from '@ngx-dropzone/cdk';

@Component({
  standalone: false,
  selector: 'my-dropzone',
  templateUrl: './dropzone.component.html',
  styleUrls: ['./dropzone.component.scss'],
})
export class CustomDropzone extends DropzoneComponent {
  onContainerClick() {
    this.openFilePicker();
  }
}
