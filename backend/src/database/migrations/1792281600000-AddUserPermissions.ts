import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `e_user_backend.permissions` and materialises the permissions every
 * existing user effectively had (the union of their roles' permissions).
 *
 * This is step 1 of removing the role system: from here on permissions live on
 * the user. During the transition the backend reads *both* the new column and
 * the roles, so the upgrade by itself changes nothing observable - the switch
 * happens later, in code.
 *
 * Nothing is dropped: `e_user_backend.roles` and `e_role_backend` (rows
 * included) are left untouched, which is what makes `down()` - and a rollback
 * to the previous release - possible.
 */
export class AddUserPermissions1792281600000 implements MigrationInterface {
  name = 'AddUserPermissions1792281600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "e_user_backend" ADD COLUMN IF NOT EXISTS "permissions" text[] NOT NULL DEFAULT '{}'`,
    );

    // Only fill rows that have no permissions yet, so re-running this (or
    // running it after someone edited permissions by hand) never overwrites
    // granted permissions.
    await queryRunner.query(
      `UPDATE "e_user_backend" AS u
          SET "permissions" = COALESCE((
                SELECT array_agg(DISTINCT p.permission)
                  FROM "e_role_backend" AS r
                  CROSS JOIN LATERAL unnest(r.permissions) AS p(permission)
                 WHERE r.name = ANY(u.roles)
              ), '{}')
        WHERE cardinality(u."permissions") = 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `roles` was never touched, so dropping the column restores the old
    // behaviour for the previous release. Permission edits made after the
    // switch are lost - that is inherent to going back to a role based model.
    await queryRunner.query(
      `ALTER TABLE "e_user_backend" DROP COLUMN IF EXISTS "permissions"`,
    );
  }
}
