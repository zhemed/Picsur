import { Newable } from 'picsur-shared/dist/types/newable';
import { MigrationInterface } from 'typeorm';
import { V030A1661692206479 } from './1661692206479-V_0_3_0_a.js';
import { V032A1662029904716 } from './1662029904716-V_0_3_2_a.js';
import { V040A1662314197741 } from './1662314197741-V_0_4_0_a.js';
import { V040B1662485374471 } from './1662485374471-V_0_4_0_b.js';
import { V040C1662535484200 } from './1662535484200-V_0_4_0_c.js';
import { V040D1662728275448 } from './1662728275448-V_0_4_0_d.js';
import { V050A1672154027079 } from './1672154027079-V_0_5_0_a.js';
import { AddImageSourceFiletype1780617600000 } from './1780617600000-AddImageSourceFiletype.js';
import { RemoveApikeyPermissionFromRoles1792195200000 } from './1792195200000-RemoveApikeyPermissionFromRoles.js';
import { AddUserPermissions1792281600000 } from './1792281600000-AddUserPermissions.js';
import { RemoveRoleAdminPermission1792368000000 } from './1792368000000-RemoveRoleAdminPermission.js';

export const MigrationList: Newable<MigrationInterface>[] = [
  V030A1661692206479,
  V032A1662029904716,
  V040A1662314197741,
  V040B1662485374471,
  V040C1662535484200,
  V040D1662728275448,
  V050A1672154027079,
  AddImageSourceFiletype1780617600000,
  RemoveApikeyPermissionFromRoles1792195200000,
  AddUserPermissions1792281600000,
  RemoveRoleAdminPermission1792368000000,
];
