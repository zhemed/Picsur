import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../../../i18n/i18n.service';

import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { Permission } from 'picsur-shared/dist/dto/permissions.enum';
import { HasFailed, FT } from 'picsur-shared/dist/types/failable';
import { LoginControl } from '../../../models/forms/login.control';
import { PermissionService } from '../../../services/api/permission.service';
import { UserPassModel } from '../../../models/forms-dto/userpass.dto';
import { UserService } from '../../../services/api/user.service';
import { Logger } from '../../../services/logger/logger.service';
import { ErrorService } from '../../../util/error-manager/error.service';

@Component({
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit {
  private readonly logger = new Logger(LoginComponent.name);

  public showRegister = false;
  public loading = false;

  public readonly model = new LoginControl();

  constructor(
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
    private readonly router: Router,
    private readonly errorService: ErrorService,
    private readonly i18n: I18nService,
  ) {}

  ngOnInit(): void {
    const state = history.state as UserPassModel;
    if (state) {
      this.model.putData(state);
      history.replaceState(null, '');
    }

    this.onPermissions();
  }

  @AutoUnsubscribe()
  onPermissions() {
    return this.permissionService.live.subscribe((permissions) => {
      this.showRegister = permissions.includes(Permission.UserRegister);
    });
  }

  async onSubmit() {
    const data = this.model.getData();
    if (HasFailed(data)) {
      return;
    }

    this.loading = true;
    const user = await this.userService.login(data.username, data.password);
    this.loading = false;

    if (HasFailed(user)) {
      // The server answers a rejected login with a 401 envelope, but the
      // reason it sends is not translated. Keep the wording of the form.
      if (user.getType() === FT.Authentication)
        return this.errorService.warn(
          this.i18n.instant('auth.invalidUsernameOrPassword'),
          this.logger,
        );

      return this.errorService.showFailure(user, this.logger);
    }

    this.errorService.success(this.i18n.instant('auth.loginSuccess'));
    this.router.navigate(['/']);
  }

  async onRegister() {
    this.router.navigate(['/user/register'], {
      state: this.model.getRawData(),
    });
  }
}
