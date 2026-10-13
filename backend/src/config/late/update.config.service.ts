import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    ParseBool,
    ParseString,
} from 'picsur-shared/dist/util/parse-simple';
import { EnvPrefix } from '../config.static.js';

/**
 * Configuration for the update panel.
 *
 * Two switches, on purpose:
 *  - version checking is on by default (it only reads the public GitHub tags API)
 *  - self updating is opt in, because it needs the docker socket (= root on the host)
 */
@Injectable()
export class UpdateConfigService {
  private readonly logger = new Logger(UpdateConfigService.name);

  // Never wait longer than this for the GitHub API, the check must not slow
  // down the panel (and the answer is cached anyway).
  public static readonly CheckTimeoutMs = 5000;
  public static readonly CheckCacheMs = 1000 * 60 * 60;
  // Failures are cached too (so a broken network does not hammer GitHub), but
  // only briefly: the admin should be able to retry after a minute or two.
  public static readonly CheckFailureCacheMs = 1000 * 60 * 2;

  constructor(private readonly configService: ConfigService) {
    if (this.isSelfUpdateEnabled()) {
      this.logger.warn(
        'PICSUR_ALLOW_SELF_UPDATE is enabled: the panel can recreate this container through the docker socket',
      );
    }
  }

  /** PICSUR_UPDATE_CHECK, default true. */
  public isUpdateCheckEnabled(): boolean {
    return ParseBool(this.configService.get(`${EnvPrefix}UPDATE_CHECK`), true);
  }

  /** PICSUR_ALLOW_SELF_UPDATE, default false. */
  public isSelfUpdateEnabled(): boolean {
    return ParseBool(
      this.configService.get(`${EnvPrefix}ALLOW_SELF_UPDATE`),
      false,
    );
  }

  /** PICSUR_UPDATE_REPO, default zhemed/picsur. */
  public getGithubRepo(): string {
    return ParseString(
      this.configService.get(`${EnvPrefix}UPDATE_REPO`),
      'zhemed/picsur',
    );
  }

  /** PICSUR_UPDATE_API_URL, default https://api.github.com. */
  public getGithubApiBase(): string {
    return ParseString(
      this.configService.get(`${EnvPrefix}UPDATE_API_URL`),
      'https://api.github.com',
    ).replace(/\/+$/, '');
  }

  /**
   * PICSUR_UPDATE_TIMEOUT, default 5000ms. The check never blocks longer than
   * this, so a slow/blocked network shows up as "could not check" instead of a
   * hanging panel. Raise it for very slow uplinks.
   */
  public getCheckTimeoutMs(): number {
    const parsed = parseInt(
      ParseString(this.configService.get(`${EnvPrefix}UPDATE_TIMEOUT`), '5000'),
      10,
    );
    if (!Number.isFinite(parsed) || parsed < 500) {
      return UpdateConfigService.CheckTimeoutMs;
    }
    return Math.min(parsed, 60000);
  }

  /** PICSUR_UPDATE_IMAGE: image repository to pull, defaults to our own image. */
  public getImageOverride(): string | undefined {
    const value = ParseString(
      this.configService.get(`${EnvPrefix}UPDATE_IMAGE`),
      '',
    );
    return value === '' ? undefined : value;
  }

  /** PICSUR_UPDATE_TAG: tag to pull, defaults to the newest GitHub tag. */
  public getTagOverride(): string | undefined {
    const value = ParseString(
      this.configService.get(`${EnvPrefix}UPDATE_TAG`),
      '',
    );
    return value === '' ? undefined : value;
  }

  /** PICSUR_UPDATE_COMMAND: override the "how to update by hand" command. */
  public getCommandOverride(): string | undefined {
    const value = ParseString(
      this.configService.get(`${EnvPrefix}UPDATE_COMMAND`),
      '',
    );
    return value === '' ? undefined : value;
  }

  /** PICSUR_DOCKER_SOCKET, default /var/run/docker.sock. */
  public getDockerSocketPath(): string {
    return ParseString(
      this.configService.get(`${EnvPrefix}DOCKER_SOCKET`),
      '/var/run/docker.sock',
    );
  }
}
