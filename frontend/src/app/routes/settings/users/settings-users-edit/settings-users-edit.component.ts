import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { I18nService } from '../../../../i18n/i18n.service';

import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { HasFailed } from 'picsur-shared/dist/types/failable';
import {
  permissionGroupOf,
  orderedPermissions,
} from '../../../../i18n/permission-categories';
import { UIPermissionTranslationKeys } from '../../../../i18n/permissions.i18n';
import { UpdateUserControl } from '../../../../models/forms/update-user.control';
import { StaticInfoService } from '../../../../services/api/static-info.service';
import { UserAdminService } from '../../../../services/api/user-manage.service';
import { Logger } from '../../../../services/logger/logger.service';
import { ErrorService } from '../../../../util/error-manager/error.service';

enum EditMode {
  edit = 'edit',
  add = 'add',
}

/** Which template the buttons in the form apply. */
export type PermissionTemplate = 'guest' | 'user' | 'none';

@Component({
  standalone: false,
  selector: 'app-settings-users-edit',
  templateUrl: './settings-users-edit.component.html',
  styleUrls: ['./settings-users-edit.component.scss'],
})
export class SettingsUsersEditComponent implements OnInit {
  private readonly logger = new Logger(SettingsUsersEditComponent.name);

  private immutableUsersList: string[] = [];
  /** Sorted by group, so the picker does not look like a random list. */
  private knownPermissions: string[] = [];
  private implicitPermissions: string[] = [];
  private guestPermissions: string[] = [];
  private userPermissions: string[] = [];

  private mode: EditMode = EditMode.edit;

  model = new UpdateUserControl();
  get allPermissions(): string[] {
    // Implicit permissions are always granted, offering them would be a lie.
    return this.knownPermissions.filter(
      (permission) => !this.implicitPermissions.includes(permission),
    );
  }

  get adding() {
    return this.mode === EditMode.add;
  }

  get editing() {
    return this.mode === EditMode.edit;
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly userManageService: UserAdminService,
    private readonly staticInfo: StaticInfoService,
    private readonly errorService: ErrorService,
    private readonly i18n: I18nService,
  ) {}

  ngOnInit() {
    Promise.all([
      this.initSpecialUsers(),
      this.initPermissions(),
    ])
      .then(() => this.initUser())
      .catch(this.logger.error);
  }

  private async initPermissions() {
    const all = await this.staticInfo.getAllPermissions();
    this.knownPermissions = orderedPermissions().filter((permission) =>
      all.includes(permission),
    );
    // Permissions a newer server knows but this build does not: keep them
    // selectable instead of silently dropping them on save.
    for (const permission of all) {
      if (!this.knownPermissions.includes(permission)) {
        this.knownPermissions.push(permission);
      }
    }
  }

  private async initSpecialUsers() {
    const special = await this.staticInfo.getSpecialUsers();
    this.immutableUsersList = special.ImmutableUsersList;
    this.implicitPermissions = special.ImplicitPermissions;
    this.guestPermissions = special.GuestPermissions;
    this.userPermissions = special.UserPermissions;
  }

  private async initUser() {
    const uuid = this.route.snapshot.paramMap.get('uuid');

    if (!uuid) {
      this.mode = EditMode.add;
      return;
    }

    this.mode = EditMode.edit;
    this.model.putId(uuid);

    const user = await this.userManageService.getUser(uuid);
    if (HasFailed(user)) return this.errorService.showFailure(user, this.logger);

    this.model.putUsername(user.username);
    this.model.putPermissions(user.permissions ?? []);
  }

  /** "Apply guest defaults" / "Apply user defaults" / "Remove everything". */
  public applyTemplate(template: PermissionTemplate) {
    const source =
      template === 'guest'
        ? this.guestPermissions
        : template === 'user'
          ? this.userPermissions
          : [];

    this.model.putPermissions(
      source.filter((permission) => !this.implicitPermissions.includes(permission)),
    );
  }

  public UIFriendlyPermission = (name: string) => {
    const group = permissionGroupOf(name);
    const key = UIPermissionTranslationKeys[name as Permission];
    const label = key ? this.i18n.instant(key) : name;

    return group ? `${this.i18n.instant(group)} · ${label}` : label;
  };

  /** Permissions this account will really have, implicit ones included. */
  public getEffectivePermissions(): string[] {
    const permissions = [
      ...this.implicitPermissions,
      ...this.model.selectedPermissions,
    ];

    return [...new Set(permissions)];
  }

  cancel() {
    this.router.navigate(['/settings/users']);
  }

  async updateUser() {
    if (this.adding) {
      const data = this.model.getDataCreate();
      const resultUser = await this.userManageService.createUser(data);
      if (HasFailed(resultUser))
        return this.errorService.showFailure(resultUser, this.logger);

      this.errorService.success(this.i18n.instant('settings.users.created'));
    } else {
      const data = this.model.getDataUpdate();
      if (!data.password) delete data.password;

      const resultUser = await this.userManageService.updateUser(data);
      if (HasFailed(resultUser))
        return this.errorService.showFailure(resultUser, this.logger);

      this.errorService.success(this.i18n.instant('settings.users.updated'));
    }

    this.router.navigate(['/settings/users']);
  }

  /** The built-in admin account always has everything, so it is read only. */
  isLockedPerms(): boolean {
    if (this.adding) return false;

    return this.immutableUsersList.includes(this.model.getDataCreate().username);
  }

  /** Shown above the picker, so the admin knows which set it starts from. */
  isUserTemplate(): boolean {
    const selected = [...this.model.selectedPermissions].sort().join(',');
    return selected === [...this.userPermissions].sort().join(',');
  }
}
