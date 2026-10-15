import { Injectable } from '@angular/core';
import { AutoUnsubscribe } from 'ngx-auto-unsubscribe-decorator';
import { UserMePermissionsResponse } from 'picsur-shared/dist/dto/api/user.dto';
import { AsyncFailable, HasFailed } from 'picsur-shared/dist/types/failable';
import { BehaviorSubject, Observable, firstValueFrom, of } from 'rxjs';
import { filter, map, timeout } from 'rxjs/operators';
import { Throttle } from '../../util/throttle';
import { Logger } from '../logger/logger.service';
import { ApiService } from './api.service';
import { UserService } from './user.service';

/**
 * How long a caller waits for the user's real permission set before falling
 * back to "no permissions". Without this a failing
 * `/api/user/me/permissions` call would keep the router waiting forever.
 */
const PERMISSIONS_LOAD_TIMEOUT_MS = 5000;

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  private permissionsSubject = new BehaviorSubject<string[] | null>(null);

  /**
   * Permissions of the current user. As long as they are unknown this is an
   * empty list, so the UI hides what it cannot prove the user may do. A guest
   * gets the same answer from the backend, so failing closed never shows more
   * than the API would accept.
   */
  public get live(): Observable<string[]> {
    return this.permissionsSubject.pipe(
      map((permissions) => permissions ?? []),
    );
  }

  public get snapshot(): string[] {
    return this.permissionsSubject.getValue() ?? [];
  }

  // This will not be optimistic, it will instead wait for correct data
  public getLoadedSnapshot(): Promise<string[]> {
    return firstValueFrom(
      this.permissionsSubject.pipe(
        filter((permissions): permissions is string[] => permissions !== null),
        timeout({
          first: PERMISSIONS_LOAD_TIMEOUT_MS,
          with: () => of(this.snapshot),
        }),
      ),
    );
  }

  constructor(
    private readonly userService: UserService,
    private readonly api: ApiService,
  ) {
    this.subscribeUser();
  }

  @AutoUnsubscribe()
  private subscribeUser() {
    return this.userService.live.pipe(Throttle(300)).subscribe(async () => {
      const permissions = await this.updatePermissions();
      if (HasFailed(permissions)) {
        this.logger.error(permissions.getReason());
        return;
      }
    });
  }

  private async updatePermissions(): AsyncFailable<true> {
    const got = await this.api.get(
      UserMePermissionsResponse,
      '/api/user/me/permissions',
    ).result;
    if (HasFailed(got)) return got;

    this.permissionsSubject.next(got.permissions);
    return true;
  }
}
