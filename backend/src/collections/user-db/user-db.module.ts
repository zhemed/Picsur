import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import { generateRandomString } from 'picsur-shared/dist/util/random';
import { AuthConfigService } from '../../config/early/auth.config.service.js';
import { EarlyConfigModule } from '../../config/early/early-config.module.js';
import { HostConfigService } from '../../config/early/host.config.service.js';
import { EUserBackend } from '../../database/entities/users/user.entity.js';
import { GuestDefaultPermissions, SuperUserPermissions } from '../../models/constants/permission-templates.const.js';
import { PreferenceDbModule } from '../preference-db/preference-db.module.js';
import { UserDbService } from './user-db.service.js';

@Module({
  imports: [
    EarlyConfigModule,
    PreferenceDbModule,
    TypeOrmModule.forFeature([EUserBackend]),
  ],
  providers: [UserDbService],
  exports: [UserDbService],
})
export class UserDbModule implements OnModuleInit {
  private readonly logger = new Logger(UserDbModule.name);

  constructor(
    private readonly usersService: UserDbService,
    private readonly authConfigService: AuthConfigService,
    private readonly hostConfig: HostConfigService,
  ) {}

  async onModuleInit() {
    // Demo instances let anonymous visitors upload, which is a property of the
    // guest permission set (it used to be done by adding `image-upload` to the
    // guest role at startup). Keeping guest in sync with the template is what
    // makes switching demo mode a restart-only change, same as before.
    const guestPermissions = GuestDefaultPermissions(this.hostConfig.isDemo());

    await this.ensureUserExists(
      'guest',
      // Guest should never be able to login
      // It should be prevented even if you know the password
      // But to be sure, we set it to a random string
      generateRandomString(128),
      guestPermissions,
    );
    await this.syncSystemUserPermissions('guest', guestPermissions);

    await this.ensureUserExists(
      'admin',
      this.authConfigService.getDefaultAdminPassword(),
      // Stored for completeness; the account is granted everything at check
      // time anyway (see UserDbService.getPermissions).
      SuperUserPermissions,
    );
  }

  private async ensureUserExists(
    username: string,
    password: string,
    permissions: string[],
  ) {
    this.logger.verbose(`Ensuring user "${username}" exists`);

    const exists = await this.usersService.exists(username);
    if (exists) return;

    const newUser = await this.usersService.create(
      username,
      password,
      permissions as never,
    );
    if (HasFailed(newUser)) {
      this.logger.error(
        `Failed to create user "${username}" because: ${newUser.getReason()}`,
      );
      return;
    }
  }

  /** System accounts are owned by the code, not by the user page. */
  private async syncSystemUserPermissions(
    username: string,
    permissions: string[],
  ) {
    const user = await this.usersService.findByUsername(username, true);
    if (HasFailed(user)) return;

    const current = [...(user.permissions ?? [])].sort().join(',');
    if (current === [...permissions].sort().join(',')) return;

    this.logger.log(`Updating permissions of the built-in "${username}" account`);
    const result = await this.usersService.forceSetPermissions(
      user.id,
      permissions as never,
    );
    if (HasFailed(result)) {
      this.logger.error(
        `Failed to update permissions of "${username}": ${result.getReason()}`,
      );
    }
  }
}
