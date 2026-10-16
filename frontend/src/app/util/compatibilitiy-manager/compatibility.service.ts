import { Inject, Injectable } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { WA_WINDOW } from '@ng-web-apis/common';

import { HasFailed } from 'picsur-shared/dist/types/failable';
import { InfoService } from '../../services/api/info.service';
import { Logger } from '../../services/logger/logger.service';
import { DialogService } from '../dialog-manager/dialog.service';
import { ErrorService } from '../error-manager/error.service';
import { reloadFresh } from '../reload-fresh';

/**
 * How long we wait for the server version before giving up silently. A server
 * that never answers, or that does not know its own version, must not turn
 * into a "not compatible" dialog.
 */
const COMPATIBILITY_TIMEOUT_MS = 5000;

@Injectable({
  providedIn: 'root',
})
export class CompatibilityService {
  private readonly logger = new Logger(CompatibilityService.name);

  constructor(
    private readonly infoService: InfoService,
    private readonly errorService: ErrorService,
    private readonly dialogService: DialogService,
    private readonly i18n: I18nService,
    @Inject(WA_WINDOW) private readonly windowRef: Window,
  ) {
    this.checkCompatibility().catch(this.logger.error);
  }

  nothing() {}

  /**
   * Comparing the versions at startup is what catches a cached frontend
   * talking to an upgraded backend (and the other way around). Without it the
   * mismatch only shows up later as unrelated looking errors.
   */
  private async checkCompatibility() {
    const isCompatible = await this.withTimeout(
      this.infoService.isCompatibleWithServer(),
      COMPATIBILITY_TIMEOUT_MS,
    );

    if (isCompatible === null) {
      this.logger.warn(
        'Could not determine the server version, skipping the compatibility check',
      );
      return;
    }

    if (HasFailed(isCompatible)) {
      return this.errorService.showFailure(isCompatible, this.logger);
    }

    if (!isCompatible) {
      // One action and no way around it: the tab runs a bundle that does not
      // match the server, and staying there only produces confusing errors.
      // `dismissable: false` also removes the ESC / backdrop exit, so the only
      // way forward is the refresh.
      this.dialogService
        .showDialog(
          {
            title: this.i18n.instant('compatibility.title'),
            description: this.i18n.instant('compatibility.description'),
            buttons: [
              {
                text: this.i18n.instant('compatibility.refresh'),
                name: 'refresh',
                color: 'primary',
              },
            ],
          },
          { dismissable: false },
        )
        .then(() => {
          this.logger.warn('Reloading because the client is out of date');
          reloadFresh(this.windowRef.location);
        });
    }
  }

  /** Resolves to null when the check needs longer than the timeout. */
  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
  ): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
