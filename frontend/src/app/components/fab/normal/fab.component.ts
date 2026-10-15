import { Component, Input } from '@angular/core';

@Component({
  selector: 'fab',
  templateUrl: './fab.component.html',
})
export class FabComponent {
  @Input('aria-label') ariaLabel = 'Floating Action Button';
  @Input() icon = 'add';
  @Input() color = 'primary';
  @Input('tooltip') tooltip: string;
  @Input() onClick: () => void = () => {};
}
