import { Module } from '@nestjs/common';
import { LateConfigModule } from '../../config/late/late-config.module.js';
import { DockerApiService } from './docker-api.service.js';
import { SelfUpdateService } from './self-update.service.js';
import { UpdateCheckService } from './update-check.service.js';

@Module({
  imports: [LateConfigModule],
  providers: [UpdateCheckService, DockerApiService, SelfUpdateService],
  exports: [UpdateCheckService, DockerApiService, SelfUpdateService],
})
export class UpdateManagerModule {}
