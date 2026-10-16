import { makeUnique } from 'picsur-shared/dist/util/unique';
import {
  Permission,
  Permissions,
  PermissionsList,
} from './permissions.const.js';

/**
 * Default permission sets.
 *
 * These used to be rows in `e_role_backend` (guest / user / admin). Roles are
 * gone: permissions live on the user, and these templates are what the UI
 * offers as starting points and what the built-in accounts are seeded with.
 */

/** Anonymous visitors - the built-in `guest` account. */
export const GuestPermissions: Permissions = [
  Permission.ImageView,
  Permission.ImageDeleteKey,
];

/** Regular accounts: everything a normal user needs, including uploading. */
export const UserPermissions: Permissions = [
  ...GuestPermissions,
  Permission.ImageManage,
  Permission.ImageUpload,
];

/**
 * Everything.
 *
 * Reserved for the built-in `admin` account, which is granted this at read
 * time (see `UserDbService.getPermissions`) instead of storing it: that way a
 * future release can add a permission without a migration, and the owner can
 * never lock themselves out.
 */
export const SuperUserPermissions: Permissions = PermissionsList;

/**
 * Permissions every account has, whatever is stored on it.
 *
 * `user-login` is checked by the login endpoint itself and `user-keep-login`
 * by `/api/user/me` - an account without them cannot be used at all, so they
 * are not offered in the permission picker. `settings` is the personal
 * settings page, which every logged in user is expected to reach.
 */
export const ImplicitPermissions: Permissions = [
  Permission.UserLogin,
  Permission.UserKeepLogin,
  Permission.Settings,
];

/**
 * The guest permission set, which depends on demo mode: a demo instance lets
 * anonymous visitors upload (images are wiped periodically anyway).
 *
 * This replaced `DemoManagerService.setupRoles()`, which used to add
 * `image-upload` to the guest *role* at startup.
 */
export function GuestDefaultPermissions(isDemo: boolean): Permissions {
  if (!isDemo) return [...GuestPermissions];

  return makeUnique([...GuestPermissions, Permission.ImageUpload]);
}
