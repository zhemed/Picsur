import {
  Logger,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnModuleInit,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import cors from 'cors';
import { IncomingMessage, ServerResponse } from 'http';
import semver from 'semver';
import { EarlyConfigModule } from './config/early/early-config.module.js';
import { ServeStaticConfigService } from './config/early/serve-static.config.service.js';
import { DatabaseModule } from './database/database.module.js';
import { PicsurLayersModule } from './layers/PicsurLayers.module.js';
import { PicsurLoggerModule } from './logger/logger.module.js';
import { AuthManagerModule } from './managers/auth/auth.module.js';
import { DemoManagerModule } from './managers/demo/demo.module.js';
import { UsageManagerModule } from './managers/usage/usage.module.js';
import { PicsurRoutesModule } from './routes/routes.module.js';

const supportedNodeVersions = ['^16.17.0', '^18.6.0', '>=20.0.0'];

const mainCorsConfig = cors({
  origin: '<origin>',
});

const imageCorsConfig = cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  exposedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false,
  // A month
  maxAge: 30 * 24 * 60 * 60,
});

const imageCorsOverride = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  next();
};

const imageCacheSet = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => {
  // Set cache for a month
  res.setHeader('Cache-Control', 'max-age=2592000');

  next();
};

@Module({
  imports: [
    PicsurLoggerModule,
    ServeStaticModule.forRootAsync({
      useExisting: ServeStaticConfigService,
      imports: [EarlyConfigModule],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthManagerModule,
    UsageManagerModule,
    DemoManagerModule,
    PicsurRoutesModule,
    PicsurLayersModule,
  ],
})
export class AppModule implements NestModule, OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  configure(consumer: MiddlewareConsumer) {
    // Wildcards use the named form that path-to-regexp v8 (Express 5 /
    // @fastify/middie 9) requires. The previous `(.*)` / `*` spelling still
    // worked, but only because Nest's LegacyRouteConverter silently rewrote it
    // at startup to exactly these strings and logged a warning per occurrence.
    // `{*path}` is the same pattern that rewrite produced, so the matched paths
    // and the resulting headers are unchanged:
    //   - `i/{*path}` also matches the bare `/i` prefix, which the rewrite did
    //     too (it is what the running instance already serves);
    //   - `/{*path}` matches everything `'*'` matched, including `/`.
    // Use `{*path}`, not `*path`: the braces keep the wildcard optional, while
    // `i/*path` would require at least one more segment and change behaviour.
    consumer.apply(mainCorsConfig).exclude('i/{*path}').forRoutes('{*path}');
    consumer
      .apply(imageCorsConfig, imageCorsOverride, imageCacheSet)
      .forRoutes('i/{*path}');
  }

  onModuleInit() {
    const nodeVersion = process.version;
    if (!supportedNodeVersions.some((v) => semver.satisfies(nodeVersion, v))) {
      this.logger.error(
        `Unsupported Node version: ${nodeVersion}. Transcoding performance will be severely degraded.`,
      );

      this.logger.log(
        `Supported Node versions: ${supportedNodeVersions.join(', ')}`,
      );
    }
  }
}
