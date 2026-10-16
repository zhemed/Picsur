import { Injectable, Logger } from '@nestjs/common';
import { ImageDBService } from '../../collections/image-db/image-db.service.js';

/**
 * Demo mode: images are wiped periodically.
 *
 * It used to also widen the guest *role* at startup so anonymous visitors can
 * upload. That is now part of the guest permission template
 * (`GuestDefaultPermissions(isDemo)` in `UserDbModule`), so this service only
 * cleans up.
 */
@Injectable()
export class DemoManagerService {
  private readonly logger = new Logger(DemoManagerService.name);

  constructor(private readonly imagesService: ImageDBService) {}

  public execute() {
    this.executeAsync().catch(this.logger.error);
  }

  private async executeAsync() {
    this.logger.verbose('Executing demo cleanup');
    await this.imagesService.deleteAll(true);
  }
}
