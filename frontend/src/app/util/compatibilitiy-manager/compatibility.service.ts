import { Inject, Injectable } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { WA_HISTORY } from '@ng-web-apis/common';

import { HasFailed } from 'picsur-shared/dist/types/failable';
import { InfoService } from '../../services/api/info.service';
import { Logger } from '../../services/logger/logger.service';
import { DialogService } from '../dialog-manager/dialog.service';
import { ErrorService } from '../error-manager/error.service';

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
    @Inject(WA_HISTORY) private readonly history: History,
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
      this.dialogService
        .showDialog({
          title: this.i18n.instant('compatibility.title'),
          description: this.i18n.instant('compatibility.description'),
          buttons: [
            {
              text: this.i18n.instant('compatibility.back'),
              name: 'back',
              color: 'accent',
            },
            {
              text: this.i18n.instant('compatibility.ignore'),
              name: 'ignore',
              color: 'warn',
            },
          ],
        })
        .then((button) => {
          if (button === 'ignore') {
            this.logger.warn('Ignoring server compatibility');
            return;
          }

          // Go to previous page. Re-checking here (as the upstream code did)
          // would only ask the same question again and stack dialogs.
          this.history.back();
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
