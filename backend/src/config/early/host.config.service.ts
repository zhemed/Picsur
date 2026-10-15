import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    ParseBool,
    ParseInt,
    ParseString,
} from 'picsur-shared/dist/util/parse-simple';
import { EnvPrefix } from '../config.static.js';

@Injectable()
export class HostConfigService {
  private readonly logger = new Logger(HostConfigService.name);

  /**
   * Single definition of "is this a production deployment?".
   *
   * `main.ts` needs the answer before the Nest application (and therefore this
   * service) exists, so the rule lives in a static that reads `process.env`
   * directly. Both call sites must go through here: previously `main.ts` used
   * `process.env['PICSUR_PRODUCTION'] !== undefined` while this service used
   * `ParseBool(...)`, so `PICSUR_PRODUCTION=false` meant "production" to one
   * and "not production" to the other (audit A-2).
   */
  public static readProductionFromEnv(env: NodeJS.ProcessEnv = process.env) {
    return ParseBool(env[`${EnvPrefix}PRODUCTION`], false);
  }

  constructor(private readonly configService: ConfigService) {
    this.logger.log('Production: ' + this.isProduction());
    this.logger.log('Verbose: ' + this.isVerbose());
    this.logger.log('Location: http://' + this.getHost() + ":" + this.getPort());

    if (this.isSchemaSync()) {
      this.logger.warn(
        'PICSUR_SYNC_SCHEMA is enabled: TypeORM will alter the schema to match ' +
          'the entities on startup. Never enable this against a database with data.',
      );
    }

    if (this.isDemo()) {
      this.logger.log('Running in demo mode');
      this.logger.log('Demo Interval: ' + this.getDemoInterval() / 1000 + 's');
    }

    if (!this.isTelemetry()) {
      this.logger.log('Telemetry disabled');
    }
  }

  public getHost(): string {
    return ParseString(this.configService.get(`${EnvPrefix}HOST`), '0.0.0.0');
  }

  public getPort(): number {
    return ParseInt(this.configService.get(`${EnvPrefix}PORT`), 8080);
  }

  public isDemo() {
    return ParseBool(this.configService.get(`${EnvPrefix}DEMO`), false);
  }

  public getDemoInterval() {
    return ParseInt(
      this.configService.get(`${EnvPrefix}DEMO_INTERVAL`),
      1000 * 60 * 5,
    );
  }

  public isProduction() {
    return ParseBool(this.configService.get(`${EnvPrefix}PRODUCTION`), false);
  }

  /**
   * `PICSUR_SYNC_SCHEMA` — the only way to turn TypeORM schema synchronisation
   * on. It used to be derived from `!isProduction()`, which silently enabled
   * schema altering (dropping unknown columns) whenever production mode was
   * not exactly `true` (audit A-2).
   */
  public isSchemaSync() {
    return ParseBool(this.configService.get(`${EnvPrefix}SYNC_SCHEMA`), false);
  }

  public isVerbose() {
    return ParseBool(this.configService.get(`${EnvPrefix}VERBOSE`), false);
  }

  public isTelemetry() {
    return ParseBool(this.configService.get(`${EnvPrefix}TELEMETRY`), true);
  }

  public getVersion() {
    return ParseString(this.configService.get(`npm_package_version`), '0.0.0');
  }
}
