import { Module } from '@nestjs/common';
import { ExperimentModule } from './experiment/experiment.module.js';
import { InfoModule } from './info/info.module.js';
import { PrefModule } from './pref/pref.module.js';
import { RolesApiModule } from './roles/roles.module.js';
import { SystemApiModule } from './system/system.module.js';
import { UsageApiModule } from './usage/usage.module.js';
import { UserApiModule } from './user/user.module.js';

@Module({
  imports: [
    UserApiModule,
    PrefModule,
    ExperimentModule,
    InfoModule,
    RolesApiModule,
    UsageApiModule,
    SystemApiModule,
  ],
})
export class PicsurApiModule {}
