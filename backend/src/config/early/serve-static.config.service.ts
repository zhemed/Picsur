import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    ServeStaticModuleOptions,
    ServeStaticModuleOptionsFactory,
} from '@nestjs/serve-static';
import { join } from 'path';
import { ParseString } from 'picsur-shared/dist/util/parse-simple';
import { EnvPrefix, PackageRoot } from '../config.static.js';

@Injectable()
export class ServeStaticConfigService
  implements ServeStaticModuleOptionsFactory
{
  private readonly logger = new Logger(ServeStaticConfigService.name);

  private defaultLocation = join(PackageRoot, '../frontend/dist');

  constructor(private readonly configService: ConfigService) {
    this.logger.log('Static directory: ' + this.getStaticDirectory());
  }

  public getStaticDirectory(): string {
    return ParseString(
      this.configService.get(
        `${EnvPrefix}STATIC_FRONTEND_ROOT`,
        this.defaultLocation,
      ),
    );
  }

  public createLoggerOptions(): ServeStaticModuleOptions[] {
    return [
      {
        rootPath: this.getStaticDirectory(),
        serveStaticOptions: {
          // @nestjs/serve-static >= 11 no longer serves index.html on unknown
          // routes unless `fallthrough` is set: its Fastify loader returns a
          // JSON 404 when the flag is falsy. Without this the single-page-app
          // deep links (e.g. /images, /settings) break, because the SPA
          // fallback stops working. Setting it restores the pre-upgrade
          // behaviour exactly (`/` and every unmatched non-API path render the
          // frontend index.html).
          fallthrough: true,
        },
      },
    ];
  }
}
