import { z } from 'zod';
import { URLRegex } from '../util/common-regex.js';
import { IsEntityID } from '../validators/entity-id.validator.js';
import { IsValidMS } from '../validators/ms.validator.js';
import { IsPosInt } from '../validators/positive-int.validator.js';
import { PrefValueTypeStrings } from './preferences.dto.js';

// This enum is only here to make accessing the values easier, and type checking in the backend
export enum SysPreference {
  HostOverride = 'host_override',

  JwtSecret = 'jwt_secret',
  JwtExpiresIn = 'jwt_expires_in',
  BCryptStrength = 'bcrypt_strength',

  RemoveDerivativesAfter = 'remove_derivatives_after',
  AllowEditing = 'allow_editing',

  ConversionTimeLimit = 'conversion_time_limit',
  ConversionMemoryLimit = 'conversion_memory_limit',

  TrackingUrl = 'tracking_url',
  TrackingId = 'tracking_id',
}

export type SysPreferences = SysPreference[];
export const SysPreferenceList: string[] = Object.values(SysPreference);

/**
 * The preferences the panel exposes for editing.
 *
 * Everything else in the enum is fixed: it is either managed by environment
 * variables or read only once at startup, so an input box for it would lie
 * about taking effect - and `jwt_secret` would be echoed back as plain text.
 * Those keys keep existing (and keep their default in
 * `PreferenceDefaultsService`), they simply can not be read or written over
 * the API any more.
 *
 * Keep this list in sync with `frontend/src/app/i18n/sys-pref.i18n.ts`.
 */
export const SysPreferenceExposedList: SysPreference[] = [
  SysPreference.HostOverride,

  SysPreference.RemoveDerivativesAfter,
  SysPreference.AllowEditing,

  SysPreference.TrackingUrl,
  SysPreference.TrackingId,
];

export function isSysPreferenceExposed(key: string): boolean {
  return SysPreferenceExposedList.includes(key as SysPreference);
}

// Syspref Value types
export const SysPreferenceValueTypes: {
  [key in SysPreference]: PrefValueTypeStrings;
} = {
  [SysPreference.HostOverride]: 'string',

  [SysPreference.JwtSecret]: 'string',
  [SysPreference.JwtExpiresIn]: 'string',
  [SysPreference.BCryptStrength]: 'number',

  [SysPreference.RemoveDerivativesAfter]: 'string',
  [SysPreference.AllowEditing]: 'boolean',

  [SysPreference.ConversionTimeLimit]: 'string',
  [SysPreference.ConversionMemoryLimit]: 'number',

  [SysPreference.TrackingUrl]: 'string',
  [SysPreference.TrackingId]: 'string',
};

export const SysPreferenceValidators: {
  [key in SysPreference]: z.ZodTypeAny;
} = {
  [SysPreference.HostOverride]: z.string().regex(URLRegex).or(z.literal('')),

  [SysPreference.JwtSecret]: z.string(),
  [SysPreference.JwtExpiresIn]: IsValidMS(),

  [SysPreference.BCryptStrength]: IsPosInt(),
  [SysPreference.RemoveDerivativesAfter]: IsValidMS(60000),

  [SysPreference.AllowEditing]: z.boolean(),
  [SysPreference.ConversionTimeLimit]: IsValidMS(),
  [SysPreference.ConversionMemoryLimit]: IsPosInt(),

  [SysPreference.TrackingUrl]: z.string().regex(URLRegex).or(z.literal('')),
  [SysPreference.TrackingId]: IsEntityID().or(z.literal('')),
};
