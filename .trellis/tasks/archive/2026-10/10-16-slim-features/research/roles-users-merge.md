# 调查 A：用户与角色能否合并（只出方案，未改任何代码）

任务 `10-16-slim-features` ②。基线：`master` @ `6ad4043`（工作区干净）。
所有结论附 `file:line`；行号对应当前 master。

---

## 1. 现状到底是什么模型

### 1.1 用户：多角色数组

- `EUserBackend.roles: string[]`（Postgres `text[]`）——
  `backend/src/database/entities/users/user.entity.ts:31-32`。
- 创建用户：`user-db.service.ts:43-70`。非特权路径会 `DefaultRolesList`（= `['user']`）
  再并上请求里的角色，并**剥掉 soulbound 角色**（`filterAddedRoles`，`user-db.service.ts:280-285`）。
- 改角色：`setRoles`（`user-db.service.ts:92-114`）＝ 保留现有 soulbound 角色 +
  请求角色里过滤后的部分；对 `ImmutableUsersList = ['admin']` **静默失败**（`:98-102`）。
- 用户能挂**多个**自定义角色，权限＝所有角色权限的并集。

### 1.2 角色：数据库行 + 一份权限清单，可自建

- `ERoleBackend{ id, name(unique), permissions: text[] }`——
  `backend/src/database/entities/users/role.entity.ts:6-16`（表 `e_role_backend`）。
- 系统角色是**真实数据行**，启动时补齐：`role-db.module.ts:46-67`
  （`SystemRolesList = guest | user | admin`）；
  `admin` 每次启动**强制回写**为全权限（`role-db.module.ts:69-90` + `roles.const.ts:56`），
  因为它在 `ImmutableRolesList` 里（`roles.const.ts:9`），UI 改不动。
- `guest | user` 属于 `SoulBoundRolesList`（`roles.const.ts:7`）：**不能加也不能从用户身上移除**；
  `UndeletableRolesList = guest | user | admin`（`roles.const.ts:11-14`）→ 不能删。
- 但 `guest`/`user` **不是 immutable**：权限可以被角色页随意改。
  `RolePermissionsLocks` 只锁了一条：`guest` 必须留 `user-login`（`roles.const.ts:19-24`）。
- **自建角色**：`POST /api/roles/create`（`routes/api/roles/roles.controller.ts:64+`），
  整个 `/api/roles` 控制器受 `@RequiredPermissions(Permission.RoleAdmin)`
  （`roles.controller.ts:28`）保护。
- 前端：`/settings/roles`（列表+增删改，`settings.routing.module.ts:57-70`）与
  `/settings/users`（用户管理）两个独立页面。

### 1.3 guest 是"半内置"

- guest **角色**是数据行（启动补齐，见上）；guest **用户**是查库失败时的内存兜底对象：
  `guest.service.ts:30-34`（`username='guest'`，`roles=['guest']`）。
- 匿名请求由 `MainAuthGuard` 的 `AuthGuard(['apikey','jwt','guest'])` 兜底成 guest 身份
  （`managers/auth/guards/main.guard.ts:20`）。

### 1.4 权限判定：两段式（这一点决定了合并的可行性）

1. **路由要求**：`extractPermissions()` 取 handler + class 两级 `@RequiredPermissions` 的
   **并集**（`main.guard.ts:80-107`）；两级都没有元数据 → 直接拒绝（`:88-93`）。
2. **用户权限**：`usersService.getPermissions(user.id)` → 查用户 → 把 `user.roles`
   展开成所有角色权限的并集（`main.guard.ts:67` → `user-db.service.ts:136-141`
   → `role-db.service.ts:65-75`）。
3. 判定：要求集合 ⊆ 用户权限集合（`main.guard.ts:75`）。

**关键点：第 1 段（类+handler 并集）与"角色怎么组织"完全正交** —— 它只描述路由，
不关心用户权限从哪来。所以合并用户/角色**不会**触碰这条语义；
只有把权限改成"按用户存储"时才需要动第 2 段。

### 1.5 谁在依赖角色系统（删之前必须知道）

| 依赖方 | 位置 | 说明 |
|---|---|---|
| 权限展开 | `role-db.service.ts:65-75` | 用户权限＝角色并集 |
| 启动补齐/回写 | `role-db.module.ts:46-90` | 系统角色数据行 |
| demo 模式 | `demo.service.ts:16-21` | **运行时给 guest 角色加 `image-upload`**，靠角色可变实现 |
| 前端角色页 | `frontend/src/app/routes/settings/roles/**`（554 行） | 增删改权限 |
| 前端用户页 | `settings/users/**` | 角色 chip + 角色选择器（`soulBoundRoles` 里过滤） |
| `/api/roles/special` | `roles.controller.ts:109-119` | 前端拿 SoulBound/Immutable/Default/Locked |

依赖面很小：`RoleDbService` 只有 4 个消费者（`roles.controller`、`user-db.service`、
`role-db.module`、`demo.service`）。

---

## 2. 候选形态

### 候选 ①：保留现模型，但只暴露内置角色（隐藏"角色"这个概念的一半）

- **做法**：数据模型一行不改；`/settings/roles` 页下线或只读化，
  `/api/roles/create|update|delete` 冻结（或仅 admin 可用）；用户页的角色选择器只列内置三种。
- **失去**：自定义角色（本来就是少数人用）。
- **改造量**：前端隐藏入口 ~30 行 + i18n 若干；后端 0 改动（接口留着不暴露）。
  **约 0.5 天**，零迁移、零数据风险。
- **数据影响**：无。已有的自定义角色行与用户绑定继续生效 —— 但**用户看不见也管不了**，
  这是它的主要缺点（权限来源变成"隐形状态"）。

### 候选 ②：删掉角色页，权限收敛为内置三档（推荐）

- **做法**：删除 `/settings/roles` 与 `/api/roles` 的 create/update/delete（保留 `special` 或直接内联常量）；
  权限由 `SystemRoleDefaults`（`roles.const.ts:40-57`）唯一决定；
  角色数据行保留（`e_role_backend` 不 drop），启动仍按代码回写；
  用户页只剩"这个用户是 admin 还是 user"（guest 仍 soulbound、仍是匿名兜底）。
- **失去**：自定义角色；`admin`/`user`/`guest` 三档之外的任何权限组合。
- **改造量（估）**：
  - 后端删 ~599 行中的 CRUD 部分（`routes/api/roles/*` 149 行 + `role-db.service.ts` 的
    create/delete/setPermissions 分支），**保留**权限展开逻辑 ~2 小时；
  - 前端删 `settings/roles/**` + `roles.service.ts` 554 行、路由 1 条、`settings.roles.*` 20 个 i18n 键、
    `Permission.RoleAdmin` 相关入口 ~6 小时；
  - 用户页角色选择器改成三档（admin 固定不可改）~2 小时；
  - demo 模式必须改写（现在靠 `addPermissions('guest', ...)`，`demo.service.ts:20`）：
    建议改成启动时把 guest 权限集合整体设为 `SystemRoleDefaults.guest + [image-upload]`，
    或让 demo 用独立常量 ~2 小时；
  - 迁移：**无需 SQL**，因为角色行与用户绑定都不动；只是 UI/API 不再可编辑 ~0 小时。
- **数据影响**：老实例里自定义角色的用户，其权限仍按并集生效（不可见），
  若要"一次性纠正"，需要一条 `update e_user_backend set roles = array['user'] where roles && ARRAY[<自定义角色名>]`
  式的可选脚本 —— 建议**不做**，避免悄悄提权/降权。
- **总工作量**：**1.5~2 天**（含回归）。风险低：判定路径与数据结构都不变。

### 候选 ③：用户页内联权限勾选，彻底不要角色

- **做法**：`EUserBackend` 新增 `permissions text[]`；`getPermissions()` 返回
  `union(user.permissions, 内置角色权限)`，或干脆只用 `user.permissions`；
  角色表/页面/API 全删。
- **失去**：角色这一层抽象（好处是"改一次、全组生效"）；`admin` 用户的特殊性要靠
  "admin 永远是全权限"硬编码（现在由 immutable admin 角色承担，`roles.const.ts:9,56`）。
- **改造量（估）**：
  - 后端：新列 + TypeORM 迁移 + `getPermissions` 改写 + 删 599 行里的大部分；
    `ImmutableUsersList`/demo/guest 三条特殊路径都要重新设计 ~1.5 天；
  - 前端：用户编辑页加权限勾选（复用 roles-edit 里的 `values-picker` + `UIFriendlyPermission`，
    `settings-roles-edit.component.ts:106`）~4 小时；删角色页 554 行 ~2 小时；
  - 迁移：把每个用户的"当前生效权限"物化进新列（一次性脚本 + 校验），
    admin 用户要显式跳过 ~4 小时；
  - **回归面大**：权限判定是安全边界，需要重跑权限矩阵测试。
- **总工作量**：**3~5 天**，中风险（迁移 + 安全边界）。
- **收益**：概念最少（没有角色），权限粒度最细（每人可定制）。

---

## 3. 推荐

**推荐候选 ②（分两步走）**：

1. **第一步（0.5 天，可立刻做）**：前端把 `/settings/roles` 从侧栏隐藏 / 只读化，
   `RoleAdmin` 保留但不在 UI 暴露 —— 等价于候选① ，先止血，随时可回滚。
2. **第二步（1~1.5 天）**：删 `role-create/update/delete` 端点与角色页，
   权限固定为 `SystemRoleDefaults` 三档；用户页角色选择器变成 admin/user 二选一
   （guest 仍匿名兜底、仍 soulbound）。

**理由**：

- **符合用户诉求**：要的事是"阉割没用的东西"。单机自建图床里，"自定义角色 + 权限矩阵"
  是典型的低频高复杂度功能：20 个 i18n 键、一整页设置、一套 CRUD API，
  但实际用户就三类（我 / 朋友 / 匿名）。
- **性价比最高**：删掉 ~1150 行 UI+API 面（599 后端 + 554 前端），
  而**判定语义、数据结构、迁移代价都是零** —— `extractPermissions` 的类+handler 并集
  （`main.guard.ts:80-107`）完全不受影响，因为它只描述路由要求。
- **保留逃生舱**：角色行、`RoleDbService`、`/api/roles/special` 不删，
  将来要恢复"高级角色"随时能接回；也不用 drop 表（与 ① 任务"不破坏性迁移"的口径一致）。
- **不建议现在就上 ③**：它把"权限"从组级降到用户级，等于重写权限模型 + 一次数据迁移，
  属于用户说的"先精简后再决定要不要重写"里的**重写**——应该等 ② 落地、用一段时间后
  再判断是否真的需要逐人权限。

**② 落地时要小心的三个点**（都已在上面定位）：

1. demo 模式靠 `addPermissions('guest', [ImageUpload])`（`demo.service.ts:20`），
   权限固定后必须换实现；
2. `admin` 用户不可改（`user-db.service.ts:98-102` 静默失败）→ 用户页对 admin 必须只读，
   避免"改了没反应"的迷惑；
3. `RolePermissionsLocks` 目前只有一条（guest 必须能 `user-login`），
   固定三档后这条约束天然成立，可以一并删掉。
