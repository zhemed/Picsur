import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { I18nService } from '../../i18n/i18n.service';
import { InfoService } from '../../services/api/info.service';

@Component({
  standalone: false,
  selector: 'app-footer',
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent implements OnInit {
  constructor(
    private readonly infoService: InfoService,
    private readonly changeDetector: ChangeDetectorRef,
    private readonly i18n: I18nService,
  ) {}

  isDemo = false;
  /** Version reported by the server, null until `/api/info` answered. */
  loadedVersion: string | null = null;

  public get version() {
    if (this.loadedVersion === null) {
      return this.i18n.instant('app.unknownVersion');
    }

    return 'V' + this.loadedVersion;
  }

  ngOnInit(): void {
    this.subscribeLanguage();
    this.subscribeInfo();
  }

  @AutoUnsubscribe()
  subscribeLanguage() {
    // The version placeholder is translated on the fly, so a language switch
    // only needs to trigger a re-render.
    return this.i18n.languageChange.subscribe(() => {
      this.changeDetector.markForCheck();
    });
  }

  @AutoUnsubscribe()
  subscribeInfo() {
    return this.infoService.live.subscribe((info) => {
      this.isDemo = info.demo;
      this.loadedVersion = info.version;
      this.changeDetector.markForCheck();
    });
  }
}
