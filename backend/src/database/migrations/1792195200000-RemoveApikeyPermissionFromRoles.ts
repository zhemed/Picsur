import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the now dead API key permission strings from the stored roles.
 *
 * The API key feature was removed outright (Permission.ApiKey /
 * Permission.ApiKeyAdmin no longer exist, and the built-in `user` role no
 * longer grants `apikey`), but roles live in `e_role_backend.permissions` as a
 * `text[]` and any instance that was set up before the removal still carries
 * the old strings around. They grant nothing (`MainAuthGuard` intersects
 * against permissions from the enum, and a string that is not in the enum can
 * never be required by a route), so this is cosmetic - it keeps the role
 * editor from showing a permission that no longer exists.
 *
 * Deliberately non destructive: no table is dropped, no row is deleted, and
 * the column type is untouched. Rows are only rewritten in place, and only
 * when they actually contain one of the two strings.
 */
export class RemoveApikeyPermissionFromRoles1792195200000
  implements MigrationInterface
{
  name = 'RemoveApikeyPermissionFromRoles1792195200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "e_role_backend"
          SET "permissions" = array_remove(array_remove("permissions", 'apikey'), 'apikey-admin')
        WHERE "permissions" && ARRAY['apikey', 'apikey-admin']::text[]`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally empty. `apikey` / `apikey-admin` are not permissions
    // anymore, so there is no meaningful state to restore: re-adding the
    // strings would only put invalid entries back into the column. The role
    // rows themselves are left exactly as they are.
  }
}
