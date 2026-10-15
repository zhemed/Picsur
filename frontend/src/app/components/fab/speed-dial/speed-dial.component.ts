import { Component, Input, Output } from '@angular/core';
import { Subject } from 'rxjs';
import { OpenManager } from './open-manager';
import { SpeedDialAnimation } from './speed-dial.animation';

@Component({
  standalone: false,
  selector: 'speed-dial',
  templateUrl: './speed-dial.component.html',
  animations: [SpeedDialAnimation],
  // Angular 21 no longer accepts stacked @HostListener decorators, so the
  // global listeners live in the host metadata.
  host: {
    '(document:touchstart)': 'touchEvent($event)',
    '(document:touchend)': 'touchEvent($event)',
    '(document:click)': 'anyClick()',
    '(document:keydown.escape)': 'anyClick()',
  },
})
export class SpeedDialComponent {
  @Input('aria-label') ariaLabel = 'Floating Action Button';

  @Input('icon') icon = 'add';
  @Input('icon-hover') iconHover = 'close';
  @Input('color') color = 'primary';
  @Input('open-on-hover') openOnHover = false;
  @Input('tooltip') tooltip: string;

  @Output('main-click') clickEmitter = new Subject<void>();

  public openManager = new OpenManager();

  private touchUntil = 0;

  touchEvent(e: TouchEvent) {
    if (e.type === 'touchstart') {
      this.touchUntil = Infinity;
    } else {
      this.touchUntil = e.timeStamp + 2000;
    }
  }

  anyClick() {
    if (!this.openManager.isOpen || this.openManager.isAnimating) return;

    this.openManager.close();
  }

  click() {
    if (!this.openManager.isOpen) {
      this.openManager.open();
    } else {
      this.clickEmitter.next();
    }
  }

  enter(e: MouseEvent) {
    if (e.timeStamp <= this.touchUntil) return;

    if (this.openOnHover) {
      this.openManager.open();
    }
  }

  leave(e: MouseEvent) {
    if (e.timeStamp <= this.touchUntil) return;

    if (this.openOnHover) {
      this.openManager.close();
    }
  }
}
