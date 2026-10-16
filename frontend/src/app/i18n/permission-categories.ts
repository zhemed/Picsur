import { Permission } from 'picsur-shared/dist/dto/permissions.enum';

/**
 * Groups used to present permissions in the user page.
 *
 * The picker is a flat list, so the order of these groups is what makes the
 * dropdown (and the "effective permissions" chips) readable: image related
 * first, then account, then the system wide ones.
 */
export const PermissionGroups: { name: string; permissions: Permission[] }[] = [
  {
    name: 'permissions.groups.images',
    permissions: [
      Permission.ImageView,
      Permission.ImageUpload,
      Permission.ImageManage,
      Permission.ImageDeleteKey,
      Permission.ImageAdmin,
    ],
  },
  {
    name: 'permissions.groups.account',
    permissions: [
      Permission.UserLogin,
      Permission.UserKeepLogin,
      Permission.UserRegister,
      Permission.UserAdmin,
    ],
  },
  {
    name: 'permissions.groups.system',
    permissions: [Permission.Settings, Permission.SysPrefAdmin],
  },
];

/** The group a permission belongs to, or null when it is unknown to this build. */
export function permissionGroupOf(permission: string): string | null {
  for (const group of PermissionGroups) {
    if (group.permissions.includes(permission as Permission)) return group.name;
  }
  return null;
}

/** Every known permission, in group order. */
export function orderedPermissions(): string[] {
  return PermissionGroups.flatMap((group) => group.permissions);
}
