import { EUserSchema } from 'picsur-shared/dist/entities/user.entity';
import {
    Column,
    Entity,
    Index,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { z } from 'zod';
import type { Permissions } from '../../../models/constants/permissions.const.js';
import { EUsrPreferenceBackend } from '../system/usr-preference.entity.js';

// Different data for public and private
const OverriddenEUserSchema = EUserSchema.omit({ hashedPassword: true }).merge(
  z.object({
    hashedPassword: z.string().optional(),
  }),
);
type OverriddenEUser = z.infer<typeof OverriddenEUserSchema>;

@Entity()
export class EUserBackend implements OverriddenEUser {
  @PrimaryGeneratedColumn('uuid', {})
  id: string;

  @Index()
  @Column({ nullable: false, unique: true })
  username: string;

  @Column('text', { nullable: false, array: true })
  roles: string[];

  /**
   * Permissions granted to this user directly.
   *
   * The role system is being removed: instead of `roles` pointing at rows in
   * `e_role_backend`, the permissions live here. During the transition both are
   * read (see `UserDbService.getPermissions`); the migration
   * `AddUserPermissions1792281600000` materialised what every existing user
   * effectively had.
   *
   * Optional on purpose: the column is `NOT NULL DEFAULT '{}'`, but an entity
   * that was loaded without this column (or a freshly built one) must not
   * silently write an empty array over the stored permissions on save.
   */
  @Column('text', { nullable: false, array: true, default: '{}' })
  permissions?: Permissions;

  @Column({ nullable: false, select: false })
  hashed_password?: string;

  @OneToMany(() => EUsrPreferenceBackend, (pref) => pref.user_id)
  preferences?: EUsrPreferenceBackend[];
}
