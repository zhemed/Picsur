import { Injectable } from '@angular/core';
import {
    UpdateApplyRequest,
    UpdateApplyResponse,
    UpdateCheckResponse,
} from 'picsur-shared/dist/dto/api/update.dto';
import { AsyncFailable } from 'picsur-shared/dist/types/failable';
import { ApiService } from './api.service';

/**
 * Talks to the admin only update endpoints.
 *
 * The backend never answers these calls with a network failure: when GitHub is
 * unreachable the check response says so in `message`, and when self updating
 * is not enabled `apply` fails with a normal permission failure.
 */
@Injectable({
  providedIn: 'root',
})
export class SystemUpdateService {
  constructor(private readonly api: ApiService) {}

  public async checkForUpdates(): AsyncFailable<UpdateCheckResponse> {
    return this.api.postEmpty(
      UpdateCheckResponse,
      '/api/system/update/check',
    ).result;
  }

  public async applyUpdate(tag?: string): AsyncFailable<UpdateApplyResponse> {
    return this.api.post(
      UpdateApplyRequest,
      UpdateApplyResponse,
      '/api/system/update/apply',
      tag === undefined ? {} : { tag },
    ).result;
  }
}
