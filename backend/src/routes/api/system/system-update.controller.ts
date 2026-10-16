import { Body, Controller, Logger, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
    UpdateApplyRequest,
    UpdateApplyResponse,
    UpdateCheckResponse,
} from 'picsur-shared/dist/dto/api/update.dto';
import { ParseBool } from 'picsur-shared/dist/util/parse-simple';
import { HostConfigService } from '../../../config/early/host.config.service.js';
import { UpdateConfigService } from '../../../config/late/update.config.service.js';
import { EasyThrottle } from '../../../decorators/easy-throttle.decorator.js';
import { RequiredPermissions } from '../../../decorators/permissions.decorator.js';
import { Returns } from '../../../decorators/returns.decorator.js';
import { SelfUpdateService } from '../../../managers/update/self-update.service.js';
import { UpdateCheckService } from '../../../managers/update/update-check.service.js';
import { Permission } from '../../../models/constants/permissions.const.js';

/**
 * Optional body of the check endpoint.
 *
 * `force` makes the server ask GitHub again instead of answering from the
 * ~1 hour cache. The panel's "check for updates" button sets it, so a release
 * is visible immediately instead of up to an hour later. Callers that poll
 * (the upgrade progress bar asks every 3s for up to 10 minutes) leave it out:
 * they keep the cached answer and stay well inside GitHub's 60 requests/hour
 * budget for unauthenticated calls.
 *
 * Declared here rather than in `shared/` because the body is entirely optional
 * and therefore not part of the request DTO - `POST /check` has always been
 * callable with no body at all.
 */
interface UpdateCheckBody {
  force?: boolean;
}

@Controller('api/system/update')
@RequiredPermissions(Permission.SysPrefAdmin)
export class SystemUpdateController {
  private readonly logger = new Logger(SystemUpdateController.name);

  constructor(
    private readonly updateConfig: UpdateConfigService,
    private readonly hostConfig: HostConfigService,
    private readonly checkService: UpdateCheckService,
    private readonly selfUpdate: SelfUpdateService,
  ) {}

  /**
   * Look for a newer version on GitHub. Never fails because of the network:
   * `latest: null` + `message` says the check did not work.
   *
   * An explicit check refreshes; pass `{"force": true}` in the body, or
   * `?force=true`, to bypass the cache. Both spellings are accepted so a
   * caller without a request DTO can still ask for a refresh.
   */
  @Post('check')
  @Returns(UpdateCheckResponse)
  @EasyThrottle(30)
  async check(
    @Body() body?: UpdateCheckBody,
    @Query('force') forceQuery?: string,
  ): Promise<UpdateCheckResponse> {
    const force = body?.force === true || ParseBool(forceQuery, false) === true;

    const current = this.hostConfig.getVersion();
    const checkEnabled = this.updateConfig.isUpdateCheckEnabled();

    const result = await this.checkService.getLatest(force);
    const latest = result.latest;
    const updateAvailable =
      checkEnabled && this.checkService.isNewer(latest, current);

    let message: string | null = null;
    if (!checkEnabled) {
      message = 'Update checking is disabled (PICSUR_UPDATE_CHECK=false)';
    } else if (result.error !== null) {
      message = `Could not check for updates: ${result.error}`;
    }

    let command = 'docker pull ghcr.io/zhemed/picsur:latest';
    try {
      command = await this.selfUpdate.getManualCommand();
    } catch (error) {
      this.logger.warn(`Could not build the manual update command: ${error}`);
    }

    return {
      current,
      latest,
      updateAvailable,
      checkEnabled,
      selfUpdateEnabled: this.updateConfig.isSelfUpdateEnabled(),
      command,
      message,
      lastUpdate: await this.selfUpdate.getStatus(),
    };
  }

  /**
   * Start the self update. The answer is sent before anything is touched -
   * the container this API runs in is going to be replaced, so the request
   * would otherwise be cut off halfway.
   */
  @Post('apply')
  @Returns(UpdateApplyResponse)
  @EasyThrottle(10)
  async apply(
    @Body() body: UpdateApplyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UpdateApplyResponse> {
    const plan = await this.selfUpdate.prepare(body?.tag);
    const current = this.hostConfig.getVersion();

    reply.raw.once('finish', () => {
      setTimeout(() => {
        this.selfUpdate.begin(plan).catch((error) => {
          this.logger.error(`Self update failed: ${error}`);
        });
      }, 500);
    });

    this.logger.log(
      `Self update requested: ${current} -> ${plan.imageRef} (container ${plan.containerName})`,
    );

    return {
      started: true,
      current,
      image: plan.imageRef,
      tag: plan.tag,
    };
  }
}
