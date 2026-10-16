# 设计：彻底去角色化（用户页直接勾权限）

任务 `10-16-slim-features` ③（用户已拍板：**取消角色概念，改为在用户页直接勾权限**）。
本文件只做设计，**不改任何代码**；实现等评审通过后另开步骤。

- 基线：`master` @ `24e8f6c`；现状证据见同目录
  [`research/roles-users-merge.md`](research/roles-users-merge.md)。
- 关联：API 密钥移除（`fix/slim-apikeys`）已把 `Permission.ApiKey` / `ApiKeyAdmin` 删掉，
  并补了清理旧库里死字符串的迁移；本设计沿用同一"不 drop 表、不删行"的口径。

---

## 1. 目标与非目标

**目标**

1. 取消"角色"这一层：权限**直接挂在用户身上**，在用户编辑页勾选。
2. 三个内置角色（`guest` / `user` / `admin`）降级为**代码里的默认权限模板**。
3. 删掉角色相关的页面、端点、服务、常量、i18n 与权限项（`Permission.RoleAdmin`）。
4. 老库升级**自动完成**（把角色权限并集物化到每个用户），且**可回滚**。

**非目标**

- 不 drop `e_role_backend` 表、不删角色行、不删 `e_user_backend.roles` 列（保持回滚能力）。
- 不改"类级 + handler 权限取并集"的路由要求语义（`main.guard.ts:80-107`）——它与本次改造正交。
- 不引入角色组/权限组等新抽象。

---

## 2. 数据模型

### 2.1 用户身上怎么存权限

**推荐：`e_user_backend` 新增 `permissions text[] NOT NULL DEFAULT '{}'`。**

| 方案 | 优点 | 缺点 |
|---|---|---|
| **`text[]`（推荐）** | 与现有 `e_role_backend.permissions`（`role.entity.ts:13`）同构，迁移=一次 `array_agg`；Postgres 原生支持 `&&`/`@>` 查询与 GIN 索引；代码里已有 `makeUnique()` 处理字符串数组（`shared/src/util/unique.ts`） | 没有"权限元数据"（不需要） |
| JSON/JSONB | 可放元数据、可演进 | 要解析/序列化、要写校验、与现有数组工具不兼容，收益为零 |
| 位图/整数 | 紧凑 | 加权限就要改 schema 语义、不可读、调试困难 |

实体改动：`backend/src/database/entities/users/user.entity.ts`

```ts
@Column('text', { nullable: false, array: true, default: '{}' })
permissions: string[];
```

`EUserSchema`（`shared/src/entities/user.entity.ts`）同步加 `permissions`，让前端能直接读
（现在前端拿到的用户对象没有权限字段，勾选框需要它）。

### 2.2 `roles` 列：保留、冻结

- **保留**（用户明确要求，也是回滚的锚点）。迁移**不动它**。
- 新代码**不再读写** `roles`：`UserDbService.create/setRoles` 里对 `roles` 的写入移除，
  `filterAddedRoles` / `SoulBoundRolesList` / `DefaultRolesList` 一并删除。
- `roles` 从此是"历史遗留列"，在代码注释与 spec 里说明"由 ③ 之前的版本写入，
  现在只用于回滚（见 §5.2）"。

### 2.3 三条内置角色 → 默认权限模板

把 `models/constants/roles.const.ts` 换成
`models/constants/permission-templates.const.ts`：

```ts
export const GuestPermissions: Permissions = ['image-view', 'image-delete-key'];
export const UserPermissions: Permissions = [...GuestPermissions, 'image-manage', 'image-upload', 'settings'];
export const SuperUserPermissions = PermissionsList; // 见 §3.3

/** 任何账号都必须保留、不出现在勾选框里的权限（原 RolePermissionsLocks 的替代） */
export const ImplicitPermissions: Permissions = ['user-login', 'user-keep-login'];
```

对照关系（现在 → 之后）：

| 现在 | 之后 |
|---|---|
| `SystemRoleDefaults.guest`（`roles.const.ts:40-44`） | `GuestPermissions` |
| `SystemRoleDefaults.user`（`:45-55`） | `UserPermissions` |
| `SystemRoleDefaults.admin = PermissionsList`（`:56`） | `SuperUserPermissions`，只对保留账号生效（§3.3） |
| `RolePermissionsLocks.guest = [UserLogin]`（`:19-24`） | `ImplicitPermissions`（对所有账号，见 §7.3） |
| `DefaultRolesList = ['user']`（`:16`） | 新账号 `permissions = UserPermissions` |
| `SoulBoundRolesList` / `ImmutableRolesList` / `UndeletableRolesList`（`:7-14`） | 只保留 `UndeletableUsersList`（`special-users.const.ts:2`）对账号的约束 |

### 2.4 启动播种逻辑怎么改

| 现在 | 之后 |
|---|---|
| `RoleDbModule.onModuleInit` 补齐三个系统角色并按代码回写 admin（`role-db.module.ts:46-90`） | **删掉**整个 `RoleDbModule` |
| `UserDbModule.onModuleInit` 建 guest / admin 用户并给角色（`user-db.module.ts:30-44`） | 建用户时直接给模板：guest → `GuestPermissions(+demo)`、admin → `SuperUserPermissions`（列里存 `SuperUserPermissions` 快照，读时仍走 §3.3 规则） |
| `UserDbService.create` 按 `DefaultRolesList` + 角色校验（`user-db.service.ts:43-70`） | 按调用方给的 `permissions`，缺省用 `UserPermissions`；不再做角色名过滤 |

---

## 3. 判定路径

### 3.1 守卫基本不动（这是本设计的关键）

`main.guard.ts` 只做两件事：取路由要求（`extractPermissions`，`:80-107`）和取用户权限
（`usersService.getPermissions(user.id)`，`:67`），然后判包含（`:75`）。

**改造点只有一处：`UserDbService.getPermissions()` 的实现**
（`user-db.service.ts:136-141`）。方法签名不变 → 守卫、`HasPermission` 装饰器
（`permissions.decorator.ts:28-41`）、所有控制器都不用动。

```ts
public async getPermissions(uuid: string): AsyncFailable<Permissions> {
  const user = await this.findOne(uuid);
  if (HasFailed(user)) return user;

  if (IsReservedSuperUser(user.username)) return SuperUserPermissions; // §3.3
  return makeUnique([...ImplicitPermissions, ...user.permissions]);
}
```

顺带收益：现在一次请求要 **2 次查询**（用户 + 角色），之后 **1 次**。

### 3.2 `Permission` 枚举

- **删** `Permission.RoleAdmin`（`shared/src/dto/permissions.enum.ts:24`）：没有角色可管了。
- **留** `UserAdmin`（用户页仍要）、`SysPrefAdmin`、`Settings`、`ImageRegister`…其余不动。
- `/api/info/permissions`（`info.controller.ts:52-56`）继续返回 `PermissionsList`，
  但**过滤掉 `ImplicitPermissions`**，供勾选框使用（现在前端就是靠它渲染权限列表）。
- 枚举里那些"前端与后端可以不同步"的注释语义不变。

### 3.3 admin 特例：推荐"读时计算的全权"，不把全权写进列

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A. 保留账号读时全权（推荐）** | 永不把自己锁在门外；**将来新增权限自动生效**（不需要迁移）；与今天 admin 角色每次启动回写全权的效果一致（`role-db.module.ts:69-90`） | 是一条"隐式放权"路径，必须显式测试并写进 spec |
| B. 迁移时把 `PermissionsList` 物化进 admin 的列 | 语义最统一（无隐式路径） | **每次新增权限都要一个迁移**，否则升级后 owner 悄悄失去新功能；任何一次误编辑都可能自锁 |
| C. 新增 `is_superuser` 布尔列 | 显式、可审计 | 多一个字段、多一处数据库状态，收益与 A 相同 |

**推荐 A**：判定函数 `IsReservedSuperUser(username) === (username === 'admin')`，
与 `ImmutableUsersList = ['admin']`（`special-users.const.ts:5`）共用同一个常量，避免两处定义。
配套约束：

- UI：admin 用户的权限区**只读**，附一句"内置管理员始终拥有全部权限"。
- API：`POST /api/user/update` 对 admin 的 `permissions` 改动返回明确的
  `FT.Permission`，而不是静默忽略（见 §7.2）。

### 3.4 隐式权限（防自锁）

`ImplicitPermissions = ['user-login', 'user-keep-login']`，对所有账号生效、不出现在勾选框：

- `user-login` 是登录接口自身的权限（`user.controller.ts:37` `@UseLocalAuth(Permission.UserLogin)`）
  → 去掉它就等于账号作废；
- `user-keep-login` 是 `/api/user/me`（`:73`）的权限，前端每个页面都靠它拿当前身份，
  去掉会让面板半瘫。

其余权限（含 `settings`、`image-*`、`user-admin`、`syspref-admin`）都是可自由勾选的。
**最后一个管理员的保护**：因为 admin 账号永远全权（§3.3），不需要"禁止移除最后一个
user-admin"这类复杂校验；但仍要在测试里覆盖"把某个普通管理员的 `user-admin` 去掉后，
他自己还能否打开用户页"。

---

## 4. UI

### 4.1 用户页（`frontend/src/app/routes/settings/users/**`）

- **列表**：`roles` 列的 chip（`settings-users.component.html:15-40`）改为
  "权限数 + 前 N 个权限名"，或直接显示 `admin` / `user` 模板标签
  （推荐：显示权限 chip，与勾选框一致，避免又造一套"档位"概念）。
- **编辑页**：在现有表单（用户名/密码，`settings-users-edit.component.html`）下方加一个
  权限勾选区，**直接复用角色编辑页现成的 `values-picker` 组件**
  （`settings-roles-edit.component.html:38-46`）与
  `UIFriendlyPermission` 映射（`settings-roles-edit.component.ts:106`）
  + `UIPermissionTranslationKeys`（`frontend/src/app/i18n/permissions.i18n.ts`）。
- **分组**：新增 `frontend/src/app/i18n/permission-categories.ts`，把权限分成
  「图片（image-*）」「账号（user-*）」「系统（*-admin / settings）」三组，
  避免 12 个复选框平铺。
- **模板按钮**：勾选区上方给两个快捷动作「套用访客默认 / 套用普通用户默认」
  （对应 §2.3 的 `GuestPermissions` / `UserPermissions`），解决"从零勾"的体验问题。
- **admin 只读**：`isSystem(user)` 时权限区置灰 + 说明文案（users 列表已有
  `isSystem()` 判断与 system chip，可直接复用）。
- `UpdateUserControl`（`models/forms/update-user.control.ts`）加 `permissions` 字段与校验
  （至少不包含隐式权限、不超范围）。

### 4.2 角色页/CRUD 下线

| 对象 | 处理 |
|---|---|
| 路由 `/settings/roles`（`settings.routing.module.ts:57-70`） | 删除；侧栏由路由数据生成（`SettingsSidebarComponent`），入口自动消失 |
| `frontend/src/app/routes/settings/roles/**`（8 文件 / 484 行） | 删除 |
| `frontend/src/app/services/api/roles.service.ts`（70 行） | 删除；`static-info.service.ts:23-35` 的 `getSpecialRoles()` 及 `/api/roles/special` 兜底一并删 |
| 后端 `routes/api/roles/**`、`collections/role-db/**`、`database/entities/users/role.entity.ts`、`models/constants/roles.const.ts` | 删除（表保留，见 §5.2） |
| i18n | `settings.roles.*`（en/zh 各 20 键）、`permissions.roleAdmin`、`settings.users.roles`（改成 `permissions`） |
| `Permission.RoleAdmin` | 删除，并检查引用点（`settings.routing.module.ts:62`、`permissions.i18n.ts:21`、权限勾选列表会自动少一项） |

### 4.3 用户可见的行为变化（要写进 release note）

- 用户不再有"角色"概念，改权限就是改这个人的权限；
- 老的自定义角色内容在升级时**被物化**为该角色的用户各自的权限集合（之后各自独立）；
- `/api/roles*` 端点消失（第三方脚本若在用会 404）。

---

## 5. 迁移与回滚

### 5.1 `up()`（新迁移，约 10 行 SQL）

```sql
-- 1) 新列（幂等）
ALTER TABLE "e_user_backend"
  ADD COLUMN IF NOT EXISTS "permissions" text[] NOT NULL DEFAULT '{}';

-- 2) 物化当前生效权限：并集(该用户所有角色的权限)
UPDATE "e_user_backend" u
   SET "permissions" = COALESCE((
         SELECT array_agg(DISTINCT p)
           FROM e_role_backend r
           CROSS JOIN LATERAL unnest(r.permissions) AS p
          WHERE r.name = ANY(u.roles)
       ), '{}')
 WHERE cardinality(u.permissions) = 0;   -- 只在未物化时执行，保护手工/后续编辑
```

要点：

- **不动** `roles`、不动 `e_role_backend`（表与行都留着）。
- `guest` 行会得到 `guest` 角色权限；`admin` 行得到 `user ∪ admin = 全部`（读时仍走 §3.3）。
- 自定义角色的用户按并集一次性拿到等价权限 → 行为与升级前**逐项一致**。
- 迁移里**不要**引用 `ImplicitPermissions`：隐式权限在读取时叠加（`getPermissions()`），
  所以列里存的是"显式授予"的部分，语义干净。

### 5.2 `down()`

```sql
ALTER TABLE "e_user_backend" DROP COLUMN IF EXISTS "permissions";
```

因为 `roles` 列与角色行都还在，回滚到旧版本后**旧代码立刻恢复工作**（旧代码只读 `roles`）。
代价：切换之后在用户页做的权限编辑会丢失（这是双向兼容的必然成本，需在 release note 说明）。

### 5.3 发布顺序（推荐一步，不必两阶段）

1. 迁移与新代码**同一个版本**发布：迁移先跑（TypeORM `migrationsRun: true`，`type-orm.config.service.ts`），
   随后应用启动即按新语义读取。
2. 老版本镜像回滚：`down()` 由 TypeORM 在下次启动执行（或手工一条 `DROP COLUMN`），`roles` 完好。
3. 若某实例在切换后有权限编辑、又回滚，再升级回来时列会被重新物化 ——
   §5.1 的 `WHERE cardinality(...)=0` 保证**不会覆盖已编辑的值**（回滚后列被 drop 的情况除外，
   此路径要在 release note 里明确写"回滚会丢权限编辑"）。

---

## 6. 已知坑与替代方案

### 6.1 demo 模式：`demo.service.ts:16-21` 靠改 guest 角色权限

- **现状**：`setupRoles()` 执行 `rolesService.addPermissions('guest', [ImageUpload])`
  → 让匿名访客在 demo 实例里能上传。
- **替代（推荐）**：权限模板变成函数，把 demo 判断收进模板：

  ```ts
  export function GuestDefaultPermissions(isDemo: boolean): Permissions {
    return isDemo ? [...GuestPermissions, Permission.ImageUpload] : GuestPermissions;
  }
  ```
  `UserDbModule` 播种 guest 时用它；`DemoManagerService.setupRoles()` 变成空实现并删除
  （`DemoManagerService` 只保留 `execute()` 的清理逻辑，`demo.module` 去掉 `RoleDbModule` 依赖）。
- **注意**：demo 开关是启动时的（`hostConfig.isDemo()`），所以**切 demo 需要重启**才能改变
  guest 权限 —— 这与现状一致（现在是启动时改一次角色），不算回归；在 spec 里写明。

### 6.2 admin 改角色静默失败（`user-db.service.ts:98-102`）

- **现状**：对 `ImmutableUsersList` 的改动"静默返回原用户"，前端以为改成功了。
- **替代**：`setPermissions` 对保留账号**明确失败**
  （`Fail(FT.Permission, 'The built-in admin account always has all permissions')`），
  前端用户页对 admin 只读，双保险。`setRoles` 连同角色逻辑一起删除。

### 6.3 `RolePermissionsLocks` 清理（`roles.const.ts:19-24`）

- 只有一条锁（guest 必须有 `user-login`），语义已被 §3.4 的 `ImplicitPermissions`
  **更严格地**覆盖（对所有账号生效），因此直接删除常量与
  `role-db.service.ts:106-118` 里的校验分支。

---

## 7. 工作量拆分（4 步，各自可独立验收、可独立回滚）

| 步骤 | 内容 | 交付物 | 验收标准 | 估时 |
|---|---|---|---|---|
| **S1 数据模型 + 读路径（无行为变化）** | 加 `permissions` 列 + 迁移物化；`getPermissions()` 改为 `union(列, 角色权限)`（过渡期两者都读）；admin 特例先保留在角色侧 | 1 迁移 + 3 个文件 | ① 三包构建通过；② 34 项镜像回归全绿；③ 权限矩阵（guest/user/admin × 关键路由）与改前逐项一致；④ 角色页仍可编辑且**仍生效** | 0.5~1 天 |
| **S2 语义切换 + 用户页勾权限** | `getPermissions()` 只读用户列 + 隐式权限 + 超管特例；`POST /api/user/update` 接受 `permissions`；用户页加勾选区；**同版本**下线角色页与 `/api/roles` CRUD；demo/admin 两坑修掉 | 后端 6~8 文件 + 前端 5~6 文件 | ① 勾/去权限立即生效（用 `manageonly` 式账号实测 403↔201）；② admin 用户权限区只读、API 明确报错；③ demo 实例匿名上传仍可用；④ 老库升级后权限与升级前一致 | 1~1.5 天 |
| **S3 删死代码 + 文档** | 删 `role-db/**`、`roles.controller`、`roles.const.ts`、shared `roles.dto/role.entity/role.validators`、前端 roles 页与 service、i18n 键、`Permission.RoleAdmin`；更新 spec（`image-api-contracts.md` §6、`permissions` 相关页）与 `MAINTAINING` 的权限说明 | 纯删除 + spec | ① `grep -rn "RoleAdmin\|RoleDbService\|roles.const" backend frontend shared` 无残留；② 构建通过；③ spec 中不再有"角色"作为可用概念 | 0.5~1 天 |
| **S4 收尾（可选）** | 文档化 `e_role_backend` / `roles` 为 legacy（不 drop）；journal/spec 记录；为将来的物理删除留 issue | 文档 | ① 下一轮可安全 drop 表；② 回滚窗口明确关闭 | 0.5 天 |

总计 **2.5~4 天**。S1 与 S2 之间可以插入一次发布（S1 纯内部改动、风险最低）。

---

## 8. 测试计划（实现时按此写）

1. **权限矩阵**：`guest`（匿名）/`user`/`admin` × {`/api/info`, `/i/<id>`, `/api/image/upload`,
   `/api/image/list`, `/api/user/list`, `/api/pref/sys`, `/api/user/me`, `/api/user/login`}
   —— 与改造前的实际返回码逐项比对（S1 验收）、并覆盖 S2 的新语义。
2. **隐式权限**：把某用户的 `permissions` 清空 → 仍能登录、仍能打开面板（`me` 可用）。
3. **自锁场景**：普通管理员去掉自己的 `user-admin` → 立即失去用户页（预期行为）；
   admin 账号无论怎么改都全权。
4. **升级路径**：造一个含自定义角色的旧库（role 行 + `user.roles`）→ 跑迁移 →
   逐用户比对并集是否等于迁移前 `getPermissions()` 的结果。
5. **回滚路径**：跑 `down()` → 旧代码（上个镜像）启动后权限与升级前一致。
6. **demo**：`PICSUR_DEMO=true` 启动 → 匿名上传 201；关掉 → 403。
7. **回归**：`bash support/regression-image-api.sh <url> <pw>` → 34/34（夹具自给）。

---

## 9. 开放问题（请评审时拍板）

1. 用户页勾选区默认展示"模板按钮"（访客/普通用户/清空）是否够？要不要"复制另一用户的权限"。
2. `settings`（个人设置页）权限是否也设为隐式？去掉它只会让该用户看不到自己的设置页，
   不会锁死账号，倾向**保持可勾选**。
3. 新建用户时默认给 `UserPermissions` 全套（当前 `DefaultRolesList = ['user']` 的行为）还是给空？
   倾向**保持全套**，减少"新建用户啥也干不了"的困惑。
4. `e_role_backend` 何时物理删除：建议**至少跨一个发布**（例如 0.9.x 之后再单独一条迁移 drop），
   本次只文档化。
