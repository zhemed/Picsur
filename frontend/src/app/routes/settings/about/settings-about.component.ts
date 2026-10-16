import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy,
} from '@angular/core';
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

/**
 * What the panel is currently doing, derived from what we can actually observe:
 *
 *  - `starting`   the apply request is in flight
 *  - `pulling`    the backend reported `lastUpdate.state === 'running'`, i.e. the
 *                 helper is pulling the image and rebuilding the container
 *  - `restarting` the API stopped answering, which is the moment the container is
 *                 swapped; the page comes back when the new version serves
 */
export type UpgradePhase = 'starting' | 'pulling' | 'restarting';

interface UpgradeFailure {
  /** Version the instance runs right now (after a rollback). */
  version: string;
  reason: string;
  /** true = the backend reported a rollback, false = our own deadline hit. */
  rolledBack: boolean;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 4000;
const UPGRADE_DEADLINE_MS = 10 * 60 * 1000;

@Component({
  standalone: false,
  templateUrl: './settings-about.component.html',
  styleUrls: ['./settings-about.component.scss'],
})
export class SettingsAboutComponent implements AfterViewInit, OnDestroy {
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

  /** Current upgrade progress, null when no upgrade is running. */
  public upgrading = false;
  public upgradePhase: UpgradePhase | null = null;
  public upgradeTarget: string | null = null;
  public upgradeSeconds = 0;

  /** Set when this session's upgrade failed, so the reason stays on the page. */
  public upgradeFailure: UpgradeFailure | null = null;

  /**
   * The admin pressed "retry" after a failed upgrade: the backend still reports
   * the *old* failure until a new attempt concludes, so hide it until then.
   */
  private failureAcknowledged = false;

  private disposed = false;

  /** Rendering is only safe once the view exists (the first check runs in the
   *  constructor, before the template has ever been rendered). */
  private viewReady = false;

  constructor(
    private readonly updateService: SystemUpdateService,
    private readonly infoService: InfoService,
    private readonly i18n: I18nService,
    private readonly errorService: ErrorService,
    private readonly changeDetector: ChangeDetectorRef,
    @Inject(WINDOW) private readonly windowRef: Window,
  ) {
    // Warm the cache on page load, the backend only asks GitHub once an hour.
    void this.checkForUpdates();
  }

  public ngAfterViewInit(): void {
    this.viewReady = true;
  }

  public ngOnDestroy(): void {
    this.disposed = true;
  }

  /**
   * Renders this view after an async state change.
   *
   * The states below are produced by promise callbacks (an awaited request, a
   * poll timer) that do not come with a user event, and in this app those do
   * not reliably reach change detection: without this the page kept showing
   * "checking"/"starting" although the new state was already there, and only a
   * reload or another click revealed it.
   */
  private render(): void {
    if (this.disposed || !this.viewReady) return;
    this.changeDetector.detectChanges();
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
      !this.upgrading &&
      !this.checking &&
      this.selfUpdateEnabled &&
      (this.checkResult?.updateAvailable ?? false)
    );
  }

  /** Line of text under the version numbers, null when all is well. */
  public get statusMessage(): string | null {
    // The progress block owns the message while an upgrade is running.
    if (this.upgrading) return null;

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
    // Progress/failure blocks below carry these states themselves.
    if (this.upgrading || this.upgradeFailure !== null) return null;

    const state: UpdateState | undefined = this.checkResult?.lastUpdate?.state;
    switch (state) {
      case 'running':
        return 'settings.about.stateRunning';
      case 'success':
        return 'settings.about.stateSuccess';
      default:
        // 'failed' is rendered by the failure block, which also names the
        // version the instance was rolled back to and offers a retry.
        return null;
    }
  }

  /** Progress line while an upgrade runs. */
  public get upgradeMessage(): string {
    switch (this.upgradePhase) {
      case 'starting':
        return 'settings.about.upgradeStarting';
      case 'restarting':
        return 'settings.about.upgradeRestarting';
      default:
        return 'settings.about.upgradePulling';
    }
  }

  /**
   * The failure to show, either from the upgrade this session started or from
   * the one the backend still remembers (e.g. after a page reload).
   */
  public get shownFailure(): UpgradeFailure | null {
    if (this.upgrading) return null;
    if (this.upgradeFailure !== null) return this.upgradeFailure;
    if (this.failureAcknowledged) return null;

    const status = this.checkResult?.lastUpdate;
    if (status?.state !== 'failed') return null;

    return {
      version: this.currentVersion,
      reason: status.message ?? this.i18n.instant('settings.about.stateFailed'),
      rolledBack: true,
    };
  }

  public get failureTitle(): string {
    const failure = this.shownFailure;
    if (failure === null) return '';

    if (!failure.rolledBack) {
      return this.i18n.instant('settings.about.upgradeTimeoutTitle');
    }
    return this.i18n.instant('settings.about.rollbackTitle', {
      version: failure.version,
    });
  }

  public async checkForUpdates(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    // A new attempt must not keep showing the previous failure.
    this.checkFailure = null;
    this.render();
    try {
      const result = await this.updateService.checkForUpdates();
      if (HasFailed(result)) {
        // Keep the reason on the page: the snackbar disappears, and a silent
        // "unknown" state is what users read as "updating is disabled".
        this.checkFailure = result.getReason();
        this.checkResult = null;
        this.render();
        this.errorService.showFailure(result, this.logger);
        return;
      }
      this.checkResult = result;
      // Once the backend reports anything but a failure, the acknowledged one
      // is history and a new failure must be able to show up again.
      if (result.lastUpdate?.state !== 'failed') {
        this.failureAcknowledged = false;
      }
    } catch (e) {
      // Defensive: the promise is documented to always settle, but a rejected
      // await must still clear the spinner and say something.
      this.checkFailure = e instanceof Error ? e.message : String(e);
      this.checkResult = null;
      this.logger.error(e);
    } finally {
      this.checking = false;
      this.render();
    }
  }

  /**
   * Starts the update and then follows it until the instance runs the new
   * version (page reload), fails (rollback), or the deadline passes.
   */
  public async apply(): Promise<void> {
    if (!this.canUpgrade) return;

    const previousVersion = this.currentVersion;
    this.upgradeFailure = null;
    this.failureAcknowledged = false;
    this.upgradeSeconds = 0;
    this.upgrading = true;
    this.upgradePhase = 'starting';
    this.applying = true;
    this.render();

    try {
      const result = await this.updateService.applyUpdate();
      if (HasFailed(result)) {
        this.upgrading = false;
        this.upgradePhase = null;
        this.render();
        this.errorService.showFailure(result, this.logger);
        return;
      }

      this.upgradeTarget = result.tag;
      this.errorService.info(
        this.i18n.instant('settings.about.started', {
          version: result.tag,
        }),
      );

      await this.followUpgrade(previousVersion);
    } finally {
      this.applying = false;
      this.upgrading = false;
      this.upgradePhase = null;
      this.upgradeTarget = null;
      this.render();
    }
  }

  /** Retry after a failure: ask for the state again and upgrade if possible. */
  public async retryUpgrade(): Promise<void> {
    if (this.checking || this.upgrading || this.applying) return;

    this.upgradeFailure = null;
    this.failureAcknowledged = true;
    this.render();
    await this.checkForUpdates();

    if (this.canUpgrade) await this.apply();
  }

  /**
   * Polls the check endpoint while the container is being replaced.
   *
   * Failing polls are expected (the instance is down for a moment) and are
   * reported as the "restarting" phase instead of an error. A version change
   * means the new container serves, so the page reloads itself.
   */
  private async followUpgrade(previousVersion: string): Promise<void> {
    const startedAt = Date.now();
    const deadline = startedAt + UPGRADE_DEADLINE_MS;
    this.upgradePhase = 'pulling';

    while (!this.disposed && Date.now() < deadline) {
      await this.sleep(POLL_INTERVAL_MS);
      if (this.disposed) return;

      this.upgradeSeconds = Math.round((Date.now() - startedAt) / 1000);
      this.render();

      const result = await this.updateService.checkForUpdates(POLL_TIMEOUT_MS);

      if (HasFailed(result)) {
        // The container is swapped right now: the API is unreachable until the
        // new one is up. Keep waiting instead of calling it a failure.
        this.upgradePhase = 'restarting';
        this.render();
        continue;
      }

      this.checkResult = result;
      this.checkFailure = null;

      const status = result.lastUpdate;
      if (status?.state === 'failed') {
        this.upgradeFailure = {
          version: result.current,
          reason:
            status.message ?? this.i18n.instant('settings.about.stateFailed'),
          rolledBack: true,
        };
        this.render();
        return;
      }

      if (result.current === previousVersion) {
        this.upgradePhase = 'pulling';
        this.render();
        if (status?.state === 'success') {
          // The update concluded but the version did not change: nothing to
          // reload, the instance already runs this version.
          return;
        }
        continue;
      }

      // Another version answers now, so the new container is serving. Reload
      // instead of leaving a stale bundle in the tab.
      this.upgradePhase = 'restarting';
      this.windowRef.location.reload();
      return;
    }

    if (this.disposed) return;

    this.upgradeFailure = {
      version: this.currentVersion,
      reason: this.i18n.instant('settings.about.upgradeTimeoutReason'),
      rolledBack: false,
    };
    this.render();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
