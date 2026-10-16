import { Component } from '@angular/core';
import { DecodedPref } from 'picsur-shared/dist/dto/preferences.dto';
import {
  SysPreference,
  SysPreferenceValidators,
  isSysPreferenceExposed,
} from 'picsur-shared/dist/dto/sys-preferences.enum';
import { map, Observable } from 'rxjs';

import { makeUnique } from 'picsur-shared/dist/util/unique';
import { z, ZodTypeAny } from 'zod';
import { SysPreferenceUI } from '../../../i18n/sys-pref.i18n';
import { SysPrefService } from '../../../services/api/sys-pref.service';

@Component({
  standalone: false,
  templateUrl: './settings-sys-pref.component.html',
  styleUrls: ['./settings-sys-pref.component.scss'],
})
export class SettingsSysprefComponent {
  public getName(key: string) {
    return SysPreferenceUI[key as SysPreference]?.name ?? key;
  }

  public getHelpText(key: string) {
    return SysPreferenceUI[key as SysPreference]?.helpText ?? '';
  }

  public getCategory(key: string): null | string {
    return SysPreferenceUI[key as SysPreference]?.category ?? null;
  }

  public getValidator(key: string): ZodTypeAny {
    return SysPreferenceValidators[key as SysPreference] ?? z.any();
  }

  /**
   * With editing turned off the API silently ignores every request carrying
   * edit parameters (resize, flip, ...), so the admin has to be told instead of
   * wondering why "nothing happens".
   */
  public showAllowEditingWarning(pref: DecodedPref): boolean {
    return pref.key === SysPreference.AllowEditing && pref.value === false;
  }

  preferences: Observable<
    Array<{ category: string | null; prefs: DecodedPref[] }>
  >;

  constructor(public readonly sysPrefService: SysPrefService) {
    this.preferences = sysPrefService.live.pipe(
      map((prefs) => {
        // The backend only serves the exposed preferences, filtering here as
        // well keeps the page honest if it ever talks to an older backend.
        const visible = prefs.filter((pref) =>
          isSysPreferenceExposed(pref.key),
        );
        const categories = makeUnique(
          visible.map((pref) => this.getCategory(pref.key)),
        );
        return categories.map((category) => ({
          category,
          prefs: visible.filter(
            (pref) => this.getCategory(pref.key) === category,
          ),
        }));
      }),
    );
  }
}
