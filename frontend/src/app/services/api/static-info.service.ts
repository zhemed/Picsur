import { Injectable } from '@angular/core';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { AllPermissionsResponse } from 'picsur-shared/dist/dto/api/info.dto';
import { GetSpecialUsersResponse } from 'picsur-shared/dist/dto/api/user-manage.dto';
import { Open } from 'picsur-shared/dist/types/failable';
import { CacheService } from '../storage/cache.service';
import { ApiService } from './api.service';
import { InfoService } from './info.service';

@Injectable({
  providedIn: 'root',
})
export class StaticInfoService {
  constructor(
    private readonly api: ApiService,
    private readonly info: InfoService,
    private readonly cache: CacheService,
  ) {
    this.subscribeVersion();
  }

  public async getSpecialUsers(): Promise<GetSpecialUsersResponse> {
    return this.cache.getFallback(
      'specialUsers',
      {
        ImmutableUsersList: [],
        LockedLoginUsersList: [],
        UndeletableUsersList: [],
        ImplicitPermissions: [],
        GuestPermissions: [],
        UserPermissions: [],
      },
      () => this.api.get(GetSpecialUsersResponse, '/api/user/special').result,
    );
  }

  public async getAllPermissions(): Promise<string[]> {
    return this.cache.getFallback(
      'allPermissions',
      // "error" works fine, it is not a valid permission, but will display where necessary and will otherwise be ignored
      ['error'] as string[],
      async () => {
        const res = await this.api.get(
          AllPermissionsResponse,
          '/api/info/permissions',
        ).result;
        return Open(res, 'permissions');
      },
    );
  }

  @AutoUnsubscribe()
  private subscribeVersion() {
    return this.info.live.subscribe((info) => {
      // `info` is null until the server answered, so there is no version yet.
      if (info === null) return;

      this.cache.setVersion(info.version);
    });
  }
}
