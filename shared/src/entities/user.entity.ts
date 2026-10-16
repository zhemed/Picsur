import { z } from 'zod';
import { IsEntityID } from '../validators/entity-id.validator.js';
import { IsStringList } from '../validators/string-list.validator.js';
import { IsPlainTextPwd, IsUsername } from '../validators/user.validators.js';

export const SimpleUserSchema = z.object({
  username: IsUsername(),
  password: IsPlainTextPwd(),
  /** Optional: new accounts start with no permissions (default deny). */
  permissions: IsStringList().optional(),
});
export type SimpleUser = z.infer<typeof SimpleUserSchema>;

export const EUserSchema = z.object({
  id: IsEntityID(),
  username: IsUsername(),
  /**
   * Permissions granted to this account directly. Implicit permissions (login,
   * keep-login, settings) and the full set of the reserved `admin` account are
   * added at check time and are not necessarily part of this list.
   */
  permissions: IsStringList(),
  hashedPassword: z.undefined(),
});
export type EUser = z.infer<typeof EUserSchema>;
