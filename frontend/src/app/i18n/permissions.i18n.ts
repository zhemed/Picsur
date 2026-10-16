import { Permission } from 'picsur-shared/dist/dto/permissions.enum';

/**
 * Label for every permission the UI can show.
 *
 * A partial map on purpose: a permission can be removed from the shared enum
 * while this build still runs (and the other way around), and consumers already
 * fall back to the raw permission name — `UIPermissionTranslationKeys[name] ??
 * name`. The API-key permissions were dropped here together with the feature.
 */
export const UIPermissionTranslationKeys: Partial<Record<Permission, string>> =
  {
    [Permission.ImageView]: 'permissions.imageView',
    [Permission.ImageUpload]: 'permissions.imageUpload',
    [Permission.ImageManage]: 'permissions.imageManage',
    [Permission.ImageDeleteKey]: 'permissions.imageDeleteKey',

    [Permission.UserLogin]: 'permissions.userLogin',
    [Permission.UserKeepLogin]: 'permissions.userKeepLogin',
    [Permission.UserRegister]: 'permissions.userRegister',

    [Permission.Settings]: 'permissions.settings',

    [Permission.ImageAdmin]: 'permissions.imageAdmin',
    [Permission.UserAdmin]: 'permissions.userAdmin',
    [Permission.RoleAdmin]: 'permissions.roleAdmin',
    [Permission.SysPrefAdmin]: 'permissions.sysPrefAdmin',
  };
