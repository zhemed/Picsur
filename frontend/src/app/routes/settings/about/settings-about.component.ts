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
  standalone: false,
  templateUrl: './settings-about.component.html',
  styleUrls: ['./settings-about.component.scss'],
})
export class SettingsAboutComponent {
  private readonly logger = new Logger(SettingsAboutComponent.name);

  /** Result of the last successful check, null while unknown. */
  public checkResult: UpdateCheckResponse | null = null;
  public checking = false;
  public applying = false;

  /**
   * Readable reason of the last *failed* check (offline, timeout, 5xx...).
   *
   * `checkResult === null` only means "we do not know yet" — it must never be
   * rendered as "the feature is not enabled", which is what made the about
   * page lie about self updating while the request was still in flight.
   */
  public checkFailure: string | null = null;

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

  /**
   * True only when a check actually said so. While the answer is unknown
   * (loading, failed, timed out) this is false *and* callers must ask
   * `checkResult !== null` before showing "self update is disabled".
   */
  public get selfUpdateEnabled(): boolean {
    return this.checkResult?.selfUpdateEnabled ?? false;
  }

  /**
   * Whether the self-update section may be explained at all. Without a
   * successful check the enable/disable state is simply not known yet.
   */
  public get selfUpdateKnown(): boolean {
    return this.checkResult !== null;
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
    // A failed check keeps its result cleared, so the retry hint is the only
    // thing left to show. It is *not* a statement about the feature flags.
    if (result === null) {
      if (this.checkFailure === null) return null;
      return this.i18n.instant('settings.about.checkFailed', {
        reason: this.checkFailure,
      });
    }
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
          this.checkResult?.lastUpdate?.message ?? 'settings.about.stateFailed'
        );
      default:
        return null;
    }
  }

  public async checkForUpdates(): Promise<void> {

    if (this.checking) return;
    this.checking = true;
    // A new attempt must not keep showing the previous failure.
    this.checkFailure = null;
    try {
      const result = await this.updateService.checkForUpdates();

      if (HasFailed(result)) {
        // Keep the reason on the page: the snackbar disappears, and a silent
        // "unknown" state is what users read as "updating is disabled".
        this.checkFailure = result.getReason();
        this.checkResult = null;
        this.errorService.showFailure(result, this.logger);
        return;
      }
      this.checkResult = result;
    } catch (e) {
      // Defensive: the promise is documented to always settle, but a rejected
      // await must still clear the spinner and say something.
      this.checkFailure = e instanceof Error ? e.message : String(e);
      this.checkResult = null;
      this.logger.error(e);
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
