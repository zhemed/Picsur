import { Injectable } from '@nestjs/common';
import { SysPreference } from 'picsur-shared/dist/dto/sys-preferences.enum';
import {
    AsyncFailable,
    Fail,
    FT,
    HasFailed,
} from 'picsur-shared/dist/types/failable';
import { URLRegex, UUIDRegex } from 'picsur-shared/dist/util/common-regex';
import { SysPreferenceDbService } from '../../collections/preference-db/sys-preference-db.service.js';
import { ReportInterval, ReportUrl } from '../config.static.js';

@Injectable()
export class UsageConfigService {
  constructor(private readonly sysPref: SysPreferenceDbService) {}

  async getTrackingUrl(): AsyncFailable<string | null> {
    const trackingUrl = await this.sysPref.getStringPreference(
      SysPreference.TrackingUrl,
    );
    if (HasFailed(trackingUrl)) return trackingUrl;

    if (trackingUrl === '') return null;

    if (!URLRegex.test(trackingUrl)) {
      return Fail(FT.UsrValidation, undefined, 'Invalid tracking URL');
    }

    return trackingUrl;
  }

  async getTrackingID(): AsyncFailable<string | null> {
    const trackingID = await this.sysPref.getStringPreference(
      SysPreference.TrackingId,
    );
    if (HasFailed(trackingID)) return trackingID;

    if (trackingID === '') return null;

    if (!UUIDRegex.test(trackingID)) {
      return Fail(FT.UsrValidation, undefined, 'Invalid tracking ID');
    }

    return trackingID;
  }

  // 上报总开关已随之删除（enable_telemetry 是个没有端点的死设置）：
  // 现在唯一的口径是 ReportUrl 是否为空，见 usage.service.ts。
  async getMetricsInterval(): Promise<number> {
    return ReportInterval;
  }

  async getMetricsUrl(): Promise<string> {
    return ReportUrl;
  }
}
