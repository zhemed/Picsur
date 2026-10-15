import { Controller, Logger, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FT, Fail, ThrowIfFailed } from 'picsur-shared/dist/types/failable';
import { UsageConfigService } from '../../../config/late/usage.config.service.js';
import { EasyThrottle } from '../../../decorators/easy-throttle.decorator.js';
import { NoPermissions } from '../../../decorators/permissions.decorator.js';
import { ReturnsAnything } from '../../../decorators/returns.decorator.js';

/**
 * Largest analytics payload this proxy accepts.
 *
 * Ackee's own beacon is a few hundred bytes; anything bigger is not a visit.
 */
const MaxReportBytes = 8 * 1024;

/**
 * Headers forwarded to the tracking endpoint.
 *
 * The endpoint is configured by the admin, but this route is reachable by
 * anyone (the browser tracker has to be able to post to it), so the client
 * must not be able to smuggle arbitrary headers through the server — that
 * turned the instance into an open relay with attacker controlled request
 * headers (audit A-3). `X-Forwarded-For` is set from the connection, never
 * taken from the client.
 */
const ForwardedHeaders = ['content-type', 'accept', 'user-agent'];

@Controller('api/usage')
@NoPermissions()
export class UsageController {
  private readonly logger = new Logger(UsageController.name);

  constructor(private readonly usageService: UsageConfigService) {}

  @Post(['report', 'report/*'])
  @ReturnsAnything()
  @EasyThrottle(120, 60)
  async report(
    @Req() req: FastifyRequest,
    @Res({
      passthrough: true,
    })
    res: FastifyReply,
  ) {
    const trackingUrl = ThrowIfFailed(await this.usageService.getTrackingUrl());

    if (trackingUrl === null) {
      throw Fail(FT.NotFound, undefined, 'Tracking URL not set');
    }

    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MaxReportBytes) {
      throw Fail(
        FT.PayloadTooLarge,
        'Usage report is too large',
        `${contentLength} > ${MaxReportBytes}`,
      );
    }

    const contentType = String(req.headers['content-type'] ?? '');
    if (!contentType.includes('application/json')) {
      throw Fail(
        FT.UsrValidation,
        'Usage reports must be sent as application/json',
      );
    }

    await res.from(`${trackingUrl}/api`, {
      rewriteRequestHeaders(request, headers) {
        const req = request as unknown as FastifyRequest;
        const forwarded: Record<string, string | string[] | undefined> = {};

        for (const name of ForwardedHeaders) {
          if (headers[name] !== undefined) forwarded[name] = headers[name];
        }

        // Ackee resolves the visitor from this header, so it must reflect the
        // actual connection, not whatever the client sent.
        forwarded['X-Forwarded-For'] = req.ip;

        return forwarded;
      },
    });
  }
}
