import { Module } from '@nestjs/common';
import { LateConfigModule } from '../../../config/late/late-config.module.js';
import { UpdateManagerModule } from '../../../managers/update/update.module.js';
import { SystemUpdateController } from './system-update.controller.js';

@Module({
  imports: [LateConfigModule, UpdateManagerModule],
  controllers: [SystemUpdateController],
})
export class SystemApiModule {}
