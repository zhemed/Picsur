import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the `role-admin` permission string, which no longer exists.
 *
 * The role system is gone (`Permission.RoleAdmin` was deleted), but instances
 * that were set up before it still carry the string in the permissions of
 * their users and in the frozen `e_role_backend` rows. It grants nothing - a
 * permission the code no longer knows cannot be required by a route - so this
 * is cosmetic, and it keeps the permission picker honest.
 *
 * Non destructive, same shape as the API key cleanup: no table or row is
 * removed, only the stale string inside the arrays.
 */
export class RemoveRoleAdminPermission1792368000000 implements MigrationInterface {
  name = 'RemoveRoleAdminPermission1792368000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "e_user_backend"
          SET "permissions" = array_remove("permissions", 'role-admin')
        WHERE "permissions" @> ARRAY['role-admin']::text[]`,
    );

    // The role table is frozen (kept for rollback), but its stored permission
    // lists are cleaned the same way so a later rollback does not resurrect a
    // permission that the old release would also have to ignore.
    await queryRunner.query(
      `UPDATE "e_role_backend"
          SET "permissions" = array_remove("permissions", 'role-admin')
        WHERE "permissions" @> ARRAY['role-admin']::text[]`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing meaningful to restore: `role-admin` is not a permission anymore,
    // so putting the string back would only reintroduce an invalid value.
  }
}
