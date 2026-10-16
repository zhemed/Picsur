import { Injectable } from '@angular/core';
import {
  UpdateApplyRequest,
  UpdateApplyResponse,
  UpdateCheckResponse,
} from 'picsur-shared/dist/dto/api/update.dto';
import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { RunningRequest } from './api.service';
import { ApiService } from './api.service';

/**
 * How long the update check may take before it is treated as failed.
 *
 * The request itself has no timeout, and `/api/system/update/check` talks to
 * GitHub on a cold cache. Without this bound a slow answer (or a stalled
 * socket) left the caller waiting forever, which the about page rendered as a
 * permanent "checking..." — see `10-16-about-page-fix`.
 */
const CHECK_TIMEOUT_MS = 15000;

/**
 * Endpoint of the version check.
 *
 * `?force=true` asks the backend to skip its (about one hour) GitHub cache, so
 * "check for updates" shows a release that was published a minute ago. The
 * automatic calls (page load, upgrade progress poll) deliberately use the plain
 * URL and keep hitting the cache, which saves GitHub quota.
 */
const CHECK_URL = '/api/system/update/check';
const CHECK_URL_FORCE = `${CHECK_URL}?force=true`;

export interface CheckForUpdatesOptions {
  /** Bypass the backend cache. Only for an explicit user click. */
  force?: boolean;
  /** How long to wait for an answer before returning a failure. */
  timeoutMs?: number;
}

/**
 * Talks to the admin only update endpoints.
 *
 * The backend never answers these calls with a network failure: when GitHub is
 * unreachable the check response says so in `message`, and when self updating
 * is not enabled `apply` fails with a normal permission failure.
 */
@Injectable({
  providedIn: 'root',
})
export class SystemUpdateService {
  constructor(private readonly api: ApiService) {}

  /**
   * @param options.force bypass the backend cache (manual "check" click only).
   * @param options.timeoutMs how long to wait. The manual button keeps the
   *   generous default; the upgrade progress poll passes a shorter bound so a
   *   container that is down mid swap is noticed quickly.
   */
  public async checkForUpdates(
    options: CheckForUpdatesOptions = {},
  ): AsyncFailable<UpdateCheckResponse> {
    return this.withTimeout(
      this.api.postEmpty(
        UpdateCheckResponse,
        options.force ? CHECK_URL_FORCE : CHECK_URL,
      ),
      options.timeoutMs ?? CHECK_TIMEOUT_MS,
    );
  }

  public async applyUpdate(tag?: string): AsyncFailable<UpdateApplyResponse> {
    return this.api.post(
      UpdateApplyRequest,
      UpdateApplyResponse,
      '/api/system/update/apply',
      tag === undefined ? {} : { tag },
    ).result;
  }

  /**
   * Bounds a request: either it answers, or the request is aborted and a
   * readable `Failure` is returned. The promise always settles, so callers can
   * safely use it as a "stop the spinner" signal.
   */
  private async withTimeout<T>(
    request: RunningRequest<T>,
    ms: number,
  ): AsyncFailable<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(
          Fail(
            FT.Network,
            `Update check did not answer within ${ms}ms`,
            'settings.about.checkTimeout',
          ),
        );
      }, ms);
    });

    try {
      return await Promise.race([request.result, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // A request that is still pending after the race was lost would leak an
      // open connection and keep the interceptor busy, so abort it.
      if (timedOut) request.cancel();
    }
  }
}
