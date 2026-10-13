import { Injectable, Logger } from '@nestjs/common';
import semver from 'semver';
import { UpdateConfigService } from '../../config/late/update.config.service.js';

export interface VersionCheckResult {
  latest: string | null;
  error: string | null;
}

/**
 * Asks the GitHub tags API for the newest release of this project.
 *
 * Contract:
 *  - only api.github.com is contacted (nothing else, and never any instance or
 *    user data - the user agent is just "picsur/<our version>")
 *  - the answer is cached for an hour (failures for five minutes)
 *  - this class never throws: a failure is returned as `error` so the panel can
 *    say "could not check" instead of breaking
 */
@Injectable()
export class UpdateCheckService {
  private readonly logger = new Logger(UpdateCheckService.name);

  private cache: { at: number; result: VersionCheckResult } | null = null;
  private inflight: Promise<VersionCheckResult> | null = null;

  constructor(private readonly updateConfig: UpdateConfigService) {}

  /** Cached newest version, null when nothing is cached (yet). */
  public getCachedLatest(): string | null {
    return this.cache?.result.latest ?? null;
  }

  public getCachedResult(): VersionCheckResult | null {
    return this.cache?.result ?? null;
  }

  public isEnabled(): boolean {
    return this.updateConfig.isUpdateCheckEnabled();
  }

  public async getLatest(force = false): Promise<VersionCheckResult> {
    if (!this.isEnabled()) {
      return {
        latest: null,
        error: 'Update checking is disabled (PICSUR_UPDATE_CHECK=false)',
      };
    }

    const now = Date.now();
    if (!force && this.cache !== null) {
      const ttl =
        this.cache.result.error === null
          ? UpdateConfigService.CheckCacheMs
          : UpdateConfigService.CheckFailureCacheMs;
      if (now - this.cache.at < ttl) return this.cache.result;
    }

    if (this.inflight !== null) return this.inflight;

    this.inflight = this.queryGithub()
      .then((result) => {
        this.cache = { at: Date.now(), result };
        return result;
      })
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  /** Compare a running version against the newest known one. */
  public isNewer(latest: string | null, current: string): boolean {
    if (latest === null) return false;
    const cleanLatest = semver.valid(latest);
    if (cleanLatest === null) return latest !== current;

    const cleanCurrent = semver.valid(current);
    if (cleanCurrent === null) return latest !== current;

    return semver.gt(cleanLatest, cleanCurrent);
  }

  private async queryGithub(): Promise<VersionCheckResult> {
    const repository = this.updateConfig.getGithubRepo();
    const url = `${this.updateConfig.getGithubApiBase()}/repos/${repository}/tags?per_page=30`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'picsur-update-check',
        },
        signal: AbortSignal.timeout(this.updateConfig.getCheckTimeoutMs()),
      });

      if (!response.ok) {
        const error = `GitHub answered with HTTP ${response.status}`;
        this.logger.warn(`Update check failed: ${error}`);
        return { latest: null, error };
      }

      const body: unknown = await response.json();
      if (!Array.isArray(body)) {
        const error = 'GitHub returned an unexpected answer';
        this.logger.warn(`Update check failed: ${error}`);
        return { latest: null, error };
      }

      const versions = body
        .map((tag: { name?: unknown }) =>
          typeof tag?.name === 'string'
            ? tag.name.replace(/^v/i, '')
            : null,
        )
        .filter((name): name is string => name !== null)
        .filter((name) => semver.valid(name) !== null)
        .sort((a, b) => semver.rcompare(a, b));

      if (versions.length === 0) {
        const error = 'No version tags found on GitHub';
        this.logger.warn(`Update check failed: ${error}`);
        return { latest: null, error };
      }

      this.logger.log(`Newest version on GitHub: ${versions[0]}`);
      return { latest: versions[0], error: null };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const cause =
        error instanceof Error && error.cause instanceof Error
          ? ` (${error.cause.message})`
          : '';
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? `GitHub did not answer within ${
              this.updateConfig.getCheckTimeoutMs() / 1000
            }s`
          : `${raw}${cause}`;
      this.logger.warn(`Update check failed: ${reason}`);
      return { latest: null, error: reason };
    }
  }
}
