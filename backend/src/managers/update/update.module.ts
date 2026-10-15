import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { LateConfigModule } from '../../config/late/late-config.module.js';
import { DockerApiService } from './docker-api.service.js';
import { SelfUpdateService } from './self-update.service.js';
import { UpdateCheckService } from './update-check.service.js';

@Module({
  imports: [LateConfigModule],
  providers: [UpdateCheckService, DockerApiService, SelfUpdateService],
  exports: [UpdateCheckService, DockerApiService, SelfUpdateService],
})
export class UpdateManagerModule implements OnModuleInit {
  private readonly logger = new Logger(UpdateManagerModule.name);

  constructor(private readonly selfUpdate: SelfUpdateService) {}

  onModuleInit() {
    // If a previous self update was interrupted, this boot is the first chance
    // to repair it (see SelfUpdateService.selfHealOnStartup). Never block the
    // start of the app on the docker socket.
    const timer = setTimeout(() => {
      this.selfUpdate.selfHealOnStartup().catch((error) => {
        this.logger.warn(`Update self healing failed: ${error}`);
      });
    }, 2000);
    timer.unref?.();
  }
}
