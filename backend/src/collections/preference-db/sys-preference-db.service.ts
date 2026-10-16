import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
    DecodedSysPref,
    PrefValueType,
    PrefValueTypeStrings,
} from 'picsur-shared/dist/dto/preferences.dto';
import {
    SysPreference,
    SysPreferenceExposedList,
    SysPreferenceList,
    SysPreferenceValidators,
    SysPreferenceValueTypes,
    isSysPreferenceExposed,
} from 'picsur-shared/dist/dto/sys-preferences.enum';
import {
    AsyncFailable,
    Fail,
    FT,
    Failable,
    HasFailed,
} from 'picsur-shared/dist/types/failable';
import { Repository } from 'typeorm';
import {
    ESysPreferenceBackend,
    ESysPreferenceSchema,
} from '../../database/entities/system/sys-preference.entity.js';
import { MutexFallBack } from '../../util/mutex-fallback.js';
import { PreferenceCommonService } from './preference-common.service.js';
import { PreferenceDefaultsService } from './preference-defaults.service.js';

@Injectable()
export class SysPreferenceDbService {
  private readonly logger = new Logger(SysPreferenceDbService.name);

  constructor(
    @InjectRepository(ESysPreferenceBackend)
    private readonly sysPreferenceRepository: Repository<ESysPreferenceBackend>,
    private readonly defaultsService: PreferenceDefaultsService,
    private readonly prefCommon: PreferenceCommonService,
  ) {}

  public async setPreference(
    key: string,
    value: PrefValueType,
  ): AsyncFailable<DecodedSysPref> {
    // Validate
    const sysPreference = await this.encodeSysPref(key, value);
    if (HasFailed(sysPreference)) return sysPreference;

    // Set
    try {
      // Upsert here, because we want to create a new record if it does not exist
      await this.sysPreferenceRepository.upsert(sysPreference, {
        conflictPaths: ['key'],
      });
    } catch (e) {
      return Fail(FT.Database, e);
    }

    return {
      key: sysPreference.key,
      value,
      // key has to be valid here, we validated it
      type: SysPreferenceValueTypes[key as SysPreference],
    };
  }

  public async getPreference(key: string): AsyncFailable<DecodedSysPref> {
    // Validate
    const validatedKey = this.prefCommon.validatePrefKey(key, SysPreference);
    if (HasFailed(validatedKey)) return validatedKey;

    // See the comment in 'mutex-fallback.ts' for why we are using a mutex here
    return MutexFallBack(
      `fetchSysPrefrence-${key}`,
      async () => {
        let existing: ESysPreferenceBackend | null;
        try {
          existing = await this.sysPreferenceRepository.findOne({
            where: { key: validatedKey as SysPreference },
            cache: 60000,
          });
          if (!existing) return null;
        } catch (e) {
          return Fail(FT.Database, e);
        }

        // Validate
        const result = ESysPreferenceSchema.safeParse(existing);
        if (!result.success) {
          return Fail(FT.SysValidation, result.error);
        }

        // Return
        return this.prefCommon.DecodePref(
          result.data as any,
          SysPreference,
          SysPreferenceValueTypes,
        );
      },
      () => this.saveDefault(validatedKey as SysPreference),
    );
  }

  public async getStringPreference(key: string): AsyncFailable<string> {
    return this.getPreferencePinned(key, 'string') as AsyncFailable<string>;
  }

  public async getNumberPreference(key: string): AsyncFailable<number> {
    return this.getPreferencePinned(key, 'number') as AsyncFailable<number>;
  }

  public async getBooleanPreference(key: string): AsyncFailable<boolean> {
    return this.getPreferencePinned(key, 'boolean') as AsyncFailable<boolean>;
  }

  // Get a preference that will be pinned to a specified type
  private async getPreferencePinned(
    key: string,
    type: PrefValueTypeStrings,
  ): AsyncFailable<PrefValueType> {
    const pref = await this.getPreference(key);
    if (HasFailed(pref)) return pref;
    if (pref.type !== type)
      return Fail(FT.UsrValidation, 'Invalid preference type');

    return pref.value;
  }

  /**
   * Only the preferences the panel is allowed to show. The others are fixed
   * (environment variables or a startup-only value) and must not leak over the
   * API - `jwt_secret` in particular would be echoed back in plain text.
   */
  public async getExposedPreferences(): AsyncFailable<DecodedSysPref[]> {
    // TODO: We are fetching each value invidually, we should fetch all at once
    const internalSysPrefs = await Promise.all(
      SysPreferenceExposedList.map((key) => this.getPreference(key)),
    );
    if (internalSysPrefs.some((pref) => HasFailed(pref))) {
      return Fail(FT.Internal, 'Could not get all preferences');
    }

    return internalSysPrefs as DecodedSysPref[];
  }

  public async getExposedPreference(
    key: string,
  ): AsyncFailable<DecodedSysPref> {
    const denied = this.rejectUnexposed(key);
    if (denied !== null) return denied;

    return this.getPreference(key);
  }

  /**
   * The panel path for writing. Fixed preferences are rejected instead of being
   * silently written to the database where nothing would read them again until
   * the next restart.
   */
  public async setExposedPreference(
    key: string,
    value: PrefValueType,
  ): AsyncFailable<DecodedSysPref> {
    const denied = this.rejectUnexposed(key);
    if (denied !== null) return denied;

    return this.setPreference(key, value);
  }

  private rejectUnexposed(key: string): Failable<DecodedSysPref> | null {
    if (isSysPreferenceExposed(key)) return null;

    // Unknown keys are left to the normal validation path, so that a typo still
    // reports "unknown preference" rather than "not editable".
    if (!SysPreferenceList.includes(key)) return null;

    return Fail(
      FT.UsrValidation,
      `'${key}' is fixed and can not be changed from the panel. ${
        key === SysPreference.JwtSecret
          ? 'Set PICSUR_JWT_SECRET instead'
          : 'Change it through the environment or the database'
      }`,
    );
  }

  // Private

  private async saveDefault(
    key: SysPreference, // Force enum here because we dont validate
  ): AsyncFailable<DecodedSysPref> {
    return this.setPreference(key, this.defaultsService.getSysDefault(key));
  }

  private async encodeSysPref(
    key: string,
    value: PrefValueType,
  ): AsyncFailable<ESysPreferenceBackend> {
    const validated = await this.prefCommon.EncodePref(
      key,
      value,
      SysPreference,
      SysPreferenceValueTypes,
    );
    if (HasFailed(validated)) return validated;

    const valueValidated =
      SysPreferenceValidators[key as SysPreference].safeParse(value);
    if (!valueValidated.success) {
      return Fail(FT.UsrValidation, undefined, valueValidated.error);
    }

    const verifySysPreference = new ESysPreferenceBackend();
    verifySysPreference.key = validated.key;
    verifySysPreference.value = validated.value;

    // It should already be valid, but these two validators might go out of sync
    const result = ESysPreferenceSchema.safeParse(verifySysPreference);
    if (!result.success) {
      return Fail(FT.UsrValidation, result.error);
    }

    return result.data;
  }
}
