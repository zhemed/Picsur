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

  /**
   * Legacy column, frozen.
   *
   * It pointed at rows in `e_role_backend` before the role system was removed.
   * Nothing reads or writes it anymore; it is kept (and still populated) so a
   * rollback to the previous release works. The migration
   * `AddUserPermissions1792281600000` copied what it granted into
   * `permissions`.
   */
  @Column('text', { nullable: false, array: true, default: '{}' })
  roles?: string[];

  /**
   * Permissions granted to this user directly.
   *
   * Implicit permissions (login, keep-login, settings) and the full set of the
   * reserved `admin` account are added at check time, see
   * `UserDbService.getPermissions`.
   */
  @Column('text', { nullable: false, array: true, default: '{}' })
  permissions: Permissions;

  @Column({ nullable: false, select: false })
  hashed_password?: string;

  @OneToMany(() => EUsrPreferenceBackend, (pref) => pref.user_id)
  preferences?: EUsrPreferenceBackend[];
}
