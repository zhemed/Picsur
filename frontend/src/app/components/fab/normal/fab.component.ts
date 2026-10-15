import { Component, Input } from '@angular/core';

@Component({
  standalone: false,
  selector: 'fab',
  templateUrl: './fab.component.html',
})
export class FabComponent {
  @Input('aria-label') ariaLabel = 'Floating Action Button';
  @Input() icon = 'add';
  @Input() color = 'primary';
  @Input('tooltip') tooltip: string;
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  @Input() onClick: () => void = () => {};
}
