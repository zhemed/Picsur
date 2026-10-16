import { FormControl } from '@angular/forms';
import {
  UserCreateRequest,
  UserUpdateRequest,
} from 'picsur-shared/dist/dto/api/user-manage.dto';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import {
  CreatePasswordError,
  CreateUsernameError,
  PasswordValidators,
  UsernameValidators,
} from '../validators/user.validator';

/**
 * Form model of the user page.
 *
 * Accounts carry their permissions directly (the role concept is gone); the
 * implicit ones (login, keep login, settings) are not part of the control, the
 * server adds them.
 */
export class UpdateUserControl {
  private id = '';
  public username = new FormControl('', UsernameValidators);
  public password = new FormControl('', PasswordValidators);
  public permissions = new FormControl<Permission[]>([], {
    nonNullable: true,
  });

  public get usernameValue() {
    return this.username.value;
  }

  public get usernameError() {
    return CreateUsernameError(this.username.errors);
  }

  public get passwordError() {
    return CreatePasswordError(this.password.errors);
  }

  public get selectedPermissions(): Permission[] {
    return this.permissions.value ?? [];
  }

  // Data interaction

  public putId(id: string) {
    this.id = id;
  }

  public putUsername(username: string) {
    this.username.setValue(username);
  }

  public putPermissions(permissions: string[]) {
    this.permissions.setValue(permissions as Permission[]);
  }

  public getDataCreate(): UserCreateRequest {
    return {
      username: this.username.value ?? '',
      password: this.password.value ?? '',
      permissions: this.selectedPermissions,
    };
  }

  public getDataUpdate(): UserUpdateRequest {
    return {
      ...this.getDataCreate(),
      id: this.id,
    };
  }
}
