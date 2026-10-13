import { Component, Inject } from '@angular/core';
import { WINDOW } from '@ng-web-apis/common';
import {
    UpdateCheckResponse,
    UpdateState,
} from 'picsur-shared/dist/dto/api/update.dto';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { I18nService } from '../../../i18n/i18n.service';
import { InfoService } from '../../../services/api/info.service';
import { SystemUpdateService } from '../../../services/api/system-update.service';
import { Logger } from '../../../services/logger/logger.service';
import { ErrorService } from '../../../util/error-manager/error.service';

@Component({
  templateUrl: './settings-about.component.html',
  styleUrls: ['./settings-about.component.scss'],
})
export class SettingsAboutComponent {
  private readonly logger = new Logger(SettingsAboutComponent.name);

  public checkResult: UpdateCheckResponse | null = null;
  public checking = false;
  public applying = false;

  constructor(
    private readonly updateService: SystemUpdateService,
    private readonly infoService: InfoService,
    private readonly i18n: I18nService,
    private readonly errorService: ErrorService,
    @Inject(WINDOW) private readonly windowRef: Window,
  ) {
    // Warm the cache on page load, the backend only asks GitHub once an hour.
    void this.checkForUpdates();
  }

  public get currentVersion(): string {
    return this.checkResult?.current ?? this.infoService.snapshot.version;
  }

  public get latestVersion(): string | null {
    return this.checkResult?.latest ?? null;
  }

  public get selfUpdateEnabled(): boolean {
    return this.checkResult?.selfUpdateEnabled ?? false;
  }

  public get canUpgrade(): boolean {
    return (
      !this.applying &&
      !this.checking &&
      this.selfUpdateEnabled &&
      (this.checkResult?.updateAvailable ?? false)
    );
  }

  /** Line of text under the version numbers, null when all is well. */
  public get statusMessage(): string | null {
    const result = this.checkResult;
    if (this.checking) return 'settings.about.checking';
    if (result === null) return null;
    if (!result.checkEnabled) return result.message;
    if (result.message !== null) return result.message;
    if (result.updateAvailable && result.latest !== null) {
      return this.i18n.instant('settings.about.updateAvailable', {
        version: result.latest,
      });
    }
    return 'settings.about.upToDate';
  }

  public get lastUpdateMessage(): string | null {
    const state: UpdateState | undefined = this.checkResult?.lastUpdate?.state;
    if (state === undefined || state === 'idle') return null;

    switch (state) {
      case 'running':
        return 'settings.about.stateRunning';
      case 'success':
        return 'settings.about.stateSuccess';
      case 'failed':
        return (
          this.checkResult?.lastUpdate?.message ??
          'settings.about.stateFailed'
        );
      default:
        return null;
    }
  }

  public async checkForUpdates(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const result = await this.updateService.checkForUpdates();
      if (HasFailed(result)) {
        this.errorService.showFailure(result, this.logger);
        return;
      }
      this.checkResult = result;
    } finally {
      this.checking = false;
    }
  }

  public async apply(): Promise<void> {
    if (!this.canUpgrade) return;

    const previousVersion = this.currentVersion;
    this.applying = true;
    try {
      const result = await this.updateService.applyUpdate();
      if (HasFailed(result)) {
        this.errorService.showFailure(result, this.logger);
        return;
      }

      this.errorService.info(
        this.i18n.instant('settings.about.started', {
          version: result.image,
        }),
      );

      await this.pollUntilRestarted(previousVersion);
    } finally {
      this.applying = false;
    }
  }

  /**
   * The container is going to be replaced, so polls keep failing until the new
   * one is up. As soon as it answers with another version the page is reloaded.
   */
  private async pollUntilRestarted(previousVersion: string): Promise<void> {
    const deadline = Date.now() + 5 * 60 * 1000;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const result = await this.updateService.checkForUpdates();
      if (HasFailed(result)) continue;

      this.checkResult = result;
      if (result.current !== previousVersion) {
        this.windowRef.location.reload();
        return;
      }
      if (result.lastUpdate?.state === 'failed') {
        this.errorService.error(
          result.lastUpdate.message ??
            this.i18n.instant('settings.about.stateFailed'),
          this.logger,
        );
        return;
      }
    }
  }
}
