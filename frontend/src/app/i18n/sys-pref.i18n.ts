import { SysPreference } from 'picsur-shared/dist/dto/sys-preferences.enum';

/**
 * Only the preferences the panel exposes are listed here. The fixed ones
 * (`jwt_secret`, `jwt_expires_in`, `bcrypt_strength`, `conversion_time_limit`,
 * `conversion_memory_limit`) keep their defaults in the backend and are
 * managed through environment variables - an input box for them would lie
 * about taking effect, so they have no UI entry (and no i18n keys) at all.
 */
export const SysPreferenceUI: Partial<
  Record<
    SysPreference,
    {
      name: string;
      helpText: string;
      category: string;
    }
  >
> = {
  [SysPreference.HostOverride]: {
    name: 'systemPreferences.hostOverride.name',
    helpText: 'systemPreferences.hostOverride.helpText',
    category: 'systemPreferences.categories.general',
  },

  [SysPreference.RemoveDerivativesAfter]: {
    name: 'systemPreferences.removeDerivativesAfter.name',
    helpText: 'systemPreferences.removeDerivativesAfter.helpText',
    category: 'systemPreferences.categories.imageProcessing',
  },
  [SysPreference.AllowEditing]: {
    name: 'systemPreferences.allowEditing.name',
    helpText: 'systemPreferences.allowEditing.helpText',

    category: 'systemPreferences.categories.imageProcessing',
  },

  [SysPreference.TrackingUrl]: {
    name: 'systemPreferences.trackingUrl.name',
    helpText: 'systemPreferences.trackingUrl.helpText',
    category: 'systemPreferences.categories.usage',
  },
  [SysPreference.TrackingId]: {
    name: 'systemPreferences.trackingId.name',
    helpText: 'systemPreferences.trackingId.helpText',
    category: 'systemPreferences.categories.usage',
  },
};
