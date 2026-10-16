# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

- **ORM**：TypeORM 0.3.x，实体在 `backend/src/database/entities/**`，用
  `@Entity()` 装饰器 + 显式列类型（`text[]`、`character varying`、`uuid`…）。
- **表名/列名**：TypeORM 默认命名策略 —— 类名转 snake_case（`EUserBackend` →
  `e_user_backend`、`EImageDerivativeBackend` → `e_image_derivative_backend`），
  列名用实体的属性名（TypeORM 不做 camelCase→snake_case 转换，所以
  `hashed_password`、`source_filetype` 都是手写 snake_case 的字段名）。
- **连接与迁移**：`config/early/type-orm.config.service.ts`，`migrationsRun: true`
  → **应用启动即执行待跑迁移**，不需要手工 `typeorm migration:run`。
- **schema 同步**：只在 `PICSUR_SYNC_SCHEMA=true` 时 `synchronize`（默认关，见
  `build-and-deploy.md`）。生产实例升级必须靠迁移，不能靠同步。
- **事务**：迁移里的多条语句用 `queryRunner.query` 顺序执行（本仓库的迁移都很小，未用显式事务）。

---

## Query Patterns

- 复杂查询用 `Repository` 的 `find/findOne/findAndCount`；需要 `UPDATE ... ARRAY_REMOVE`
  这类 SQL 能力时用 `queryRunner.query` 或 `createQueryBuilder`。
- 派生数据（例如图片派生表）的写入要考虑并发：唯一键冲突（Postgres `23505`）应视为
  "另一个请求已经写好"，回读已有行而不是报 500（见
  `image-file-db.service.ts` 的 `addDerivative`）。
- 分页接口一律给上限（`list/all` 默认 100、硬上限 1000；`/api/user/list` 上限 100）。

---

## Migrations

新增迁移的步骤：

1. 在 `backend/src/database/migrations/` 建 `<unix-ms>-<Name>.ts`，**时间戳就是迁移 id**，
   必须大于现有最大值（现有：`1780617600000` 起，最新 `1792368000000`）。
2. 实现 `MigrationInterface`：`name` 属性写类名，`up()` / `down()` 都实现
   （`down()` 若语义上无法回退，留空并写明原因，例如"该字符串已不是权限，恢复只会写回无效值"）。
3. 在 `backend/src/database/migrations/index.ts` 的 `MigrationList` 里注册 —— 忘了注册
   等于没写。
4. **非破坏性优先**：不 drop 表、不删行。清理历史值时用
   `UPDATE ... SET col = array_remove(col, 'x') WHERE col @> ARRAY['x']`（幂等，重跑
   `UPDATE 0`），参考 `1792195200000-RemoveApikeyPermissionFromRoles.ts`、
   `1792368000000-RemoveRoleAdminPermission.ts`。
5. 回填数据要**幂等**：加保护条件（如 `WHERE cardinality(col) = 0`）避免覆盖用户后来的编辑，
   参考 `1792281600000-AddUserPermissions.ts`。

> 列 NOT NULL 且**没有 DB 默认值**时，任何"以前会写、现在不写了"的代码路径都会让 INSERT 失败
> （`e_user_backend.roles` 就是这么踩到过一次：新建用户不再写 roles，插入直接报 not-null
> 违反）。要么保留写入（写空数组），要么给列加 `DEFAULT`。

---

## Legacy / frozen schema（去角色化后）

去角色化（任务 `10-16-derolify-impl`）之后有两处**保留但冻结**的历史结构，**不要删**：

| 结构 | 状态 | 说明 |
|---|---|---|
| `e_user_backend.roles` | 冻结（`text[] NOT NULL DEFAULT '{}'`） | 角色时代的权限来源。迁移 `1792281600000` 已把"角色并集"物化进 `e_user_backend.permissions`；之后代码不再读它，只在新用户 INSERT 时写 `[]` 保持非空约束。**保留是为了回滚**：换回旧版本镜像后旧代码仍按 roles 判定。 |
| `e_role_backend`（及行） | 冻结 | 角色表与角色行都保留，同样只为回滚。没有任何代码再读它。 |
| `e_api_key_backend` | 冻结 | API 密钥功能的残留表（`fix/slim-apikeys`），行保留、不再读。 |

**权限模型（当前）**：

- 权限存在 `e_user_backend.permissions`，用户页直接勾选；
- `UserDbService.getPermissions()` = 内置 `admin` 账号**读时全权**（不物化，新权限零迁移）
  + `ImplicitPermissions`（`user-login` / `user-keep-login` / `settings`）+ 用户列；
- 默认权限模板在 `models/constants/permission-templates.const.ts`（访客/普通用户），
  demo 模式通过 `GuestDefaultPermissions(isDemo)` 影响 guest 账号（**重启生效**）；
- 新建账号默认**空权限**（默认拒绝），由管理员在用户页套模板或逐个勾。

**回滚语义**：`AddUserPermissions` 的 `down()` 只 `DROP COLUMN permissions`，roles 完好
→ 旧代码可立即接管。反过来，回滚会丢掉"切换之后在用户页做的权限编辑"（角色模型里没有
这些信息），发版说明里要写清。

**历史坑（曾经如此，S2 已消除）**：`RoleDbService.setPermissions` 对**自定义角色**必然
500 —— `RolePermissionsLocks[roleName]` 对非内置角色是 `undefined`，随后 `.filter` 抛
TypeError。整条角色 CRUD 路径已在 S2 删除，所以现在不存在这个入口；记录在此避免以后
重新引入"按名字查表、名字不在表里就崩"的写法。

---

## Naming Conventions

- 表：`e_<domain>_backend`（`e_user_backend`、`e_image_file_backend`）。
- 列：snake_case，且与实体属性名一致（TypeORM 不做自动转换）。
- 索引/唯一约束：交给 TypeORM 生成（约束名形如 `UQ_fa03f5333afd...`），迁移里要用约束名时
  先 `psql \d+` 查实际名字。

---

## Common Mistakes

- **忘了在 `MigrationList` 注册**：迁移文件写了也不会跑。
- **`down()` 写成"删数据"**：回滚应该回到上一个版本能工作的状态，而不是清理；
  本仓库的清理型迁移 `down()` 一律留空并注明。
- **依赖 `synchronize` 兜底**：生产默认关闭；新列必须写迁移，否则老实例升级后
  该列不存在、读取报错。
- **在迁移里引用代码里的枚举/常量**：迁移要能在"代码已经继续演进"之后重跑，
  所以直接写字符串字面量（例如 `'role-admin'`），不要 import 常量。
