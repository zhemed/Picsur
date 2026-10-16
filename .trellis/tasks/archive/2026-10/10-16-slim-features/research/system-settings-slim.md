# 调查 B：`/settings/system` 能不能精简（只出方案，未改任何代码）

任务 `10-16-slim-features` ③。基线：`master` @ `6ad4043`。
页面 = 把所有 **系统偏好（sys preference）** 渲染成一堆输入框：
`frontend/src/app/routes/settings/sys-pref/settings-sys-pref.component.html:3-19`
（按 `SysPreferenceUI[].category` 分组，`frontend/src/app/i18n/sys-pref.i18n.ts`）。
权限门槛 `SysPrefAdmin`（`settings.routing.module.ts:76-84`）。

**枚举一共 12 项**（`shared/src/dto/sys-preferences.enum.ts:10-26`），
四组：general(1) / imageProcessing(3) / authentication(3) / usage(4)。
（en.json 里 `systemPreferences` 有 13 个键，多的那个是 `categories`。）

---

## 1. 逐项清单（控制什么 / 默认 / 谁真正读它 / 前端入口）

| # | 偏好 | UI 名称 | 默认值 | 真正读取的位置 | 效果/坑 |
|---|---|---|---|---|---|
| 1 | `HostOverride` | Host Override | `''` | `config/late/info.config.service.ts:12-13` → `/api/info.host_override`（`routes/api/info/info.controller.ts:39`） | 面板/ShareX 里显示的主机名；**运行时可改、立即生效** |
| 2 | `JwtSecret` | JWT Secret | env `PICSUR_JWT_SECRET`，否则随机 64 位（`preference-defaults.service.ts:29-39`） | **仅启动时**：`late-config.module.ts:45`、`jwt.config.service.ts:20-30`、`JWT_SECRET` provider（同文件 63-70） | 改完**必须重启**才生效；界面里明文回显一个凭据；改它=全员掉线 |
| 3 | `JwtExpiresIn` | JWT Expiry Time | env，否则 `7d`（`defaults:40-41`） | 同 #2（`jwt.config.service.ts:32-38`，ms→s） | 同上：**只读一次，重启才生效**；界面会误导 |
| 4 | `BCryptStrength` | BCrypt Strength | `10`（`defaults:42`） | `collections/user-db/user-db.service.ts:150`、`:288-293` | 只影响**以后**的密码哈希；校验器是 `IsPosInt()`（`positive-int.validator.ts:3`）**无上限** → 填 31 等于把自己锁在外面 |
| 5 | `RemoveDerivativesAfter` | Cached Images Expiry Time | `'7d'`（`defaults:44`） | `managers/image/image-manager.module.ts:46-56`（清理 cron） | 真正的运维旋钮（磁盘）；`IsValidMS(60000)` 有下限保护 |
| 6 | `AllowEditing` | Allow images to be edited | `true`（`defaults:45`） | `managers/image/image.service.ts:179-181` | 关掉后**带参数的取图请求被静默忽略**；前端没有任何提示/灰化 → 用户会以为坏了 |
| 7 | `ConversionTimeLimit` | Convert/Edit Time Limit | `'15s'`（`defaults:47`） | `managers/image/image-converter.service.ts:73-81`（传给 sharp worker） | 排障参数；改坏=所有转换超时 |
| 8 | `ConversionMemoryLimit` | Convert/Edit Memory Limit MB | `512`（`defaults:48`） | 同上 `:74` | 排障参数；改坏=所有转换失败（OOM/拒绝） |
| 9 | `EnableTracking` | Enable Ackee Web Tracking | `false`（`defaults:50`） | **没有任何地方读它** —— `grep -rn "EnableTracking" backend frontend` 只命中枚举/default/i18n 自己 | **死设置**：`/api/info` 直接硬编码 `state: TrackingState.Detailed`（`info.controller.ts:44-47`），开关实际是"TrackingId 是否为空" |
| 10 | `TrackingUrl` | Ackee tracking URL | `''`（`defaults:51`） | `config/late/usage.config.service.ts:19-30` | 前端 ackee 走 `/api/usage/report` 代理（本任务同期加固过）；空=不统计 |
| 11 | `TrackingId` | Ackee trackign website ID | `''`（`defaults:52`） | `usage.config.service.ts:32-47` → `/api/info.tracking.id` | 前端 `UsageService` 靠它决定启停（`services/usage/usage.service.ts:41-47`）；**名字拼错**（trackign） |
| 12 | `EnableTelemetry` | Enable System Telemetry | `true`（`defaults:54`） | `usage.config.service.ts:50-52` | 但 `ReportUrl = ''`（`config/config.static.ts:8`），`usage.service.ts:42-45` 检测到空端点直接 return → **本仓库永远不上报**；留着只制造"隐私开关"的错觉 |

读取点统计：12 项里 **1 项完全没人读**（#9）、**1 项读了但功能上等于无效**（#12）、
**2 项只在启动时读一次**（#2#3，UI 却是实时输入框）、**2 项是排障专用**（#7#8）。

---

## 2. 三档清单

### A. 保留（继续暴露）——5 项

| 偏好 | 理由 | 影响面 |
|---|---|---|
| `HostOverride` | 自建实例常见需求：反代换域名后要修正展示/分享链接；实时生效 | 无 |
| `RemoveDerivativesAfter` | 唯一控制磁盘增长的旋钮，7d 对任何人都不是普适值 | 无（有下限校验） |
| `AllowEditing` | 核心功能开关（允许带参数取图/改图） | 建议顺手补前端提示：关闭时灰化编辑入口，否则是"静默无效" |
| `TrackingUrl` | 统计功能的总开关（空=关），部署者自己填 | 无 |
| `TrackingId` | 同上，前端启停就靠它 | 顺手修名字拼写（`trackign` → `tracking`），i18n 键改名注意 en/zh 同步 |

### B. 固定为默认值、从 UI 移除（保留偏好/接口，只是不给改）——5 项

| 偏好 | 固定值 | 理由 | 影响面 |
|---|---|---|---|
| `JwtSecret` | 启动时取 env，否则随机并入库（现状即默认） | 凭据**不该出现在设置页明文输入框**；改它=所有人掉线且必须重启才生效，UI 却在暗示实时 | 想换密钥的人用 `PICSUR_JWT_SECRET`（`early-jwt.config.service.ts`）或删库重生成；建议同时在页面留一句"由环境变量管理" |
| `JwtExpiresIn` | env 或 `7d` | 同上：只读一次，UI 误导；7d 对自建图床是合理值 | 需要改的人用 env |
| `BCryptStrength` | `10` | 无上限校验有自锁风险；10 是 OWASP 推荐区间的合理值 | 老用户哈希不受影响（登录时按新强度重算的路径本来就没有） |
| `ConversionTimeLimit` | `15s` | 纯排障；改错会让全站转码挂掉 | 需要调的人可临时改 DB |
| `ConversionMemoryLimit` | `512` | 同上 | 同上 |

> 实现口径（两种，任选）：
> **(a) 只改 UI**：前端过滤掉这 5 个 key（`settings-sys-pref.component.ts` 的 `map` 里加一个 hide 集合）
> ——约 15 行，**零后端/DB 风险**，推荐先做这个；
> **(b) 彻底删**：从 `SysPreference` 枚举/`SysPreferenceValidators`/defaults 里删掉，
> 读取点改成常量 ——约 150 行 + 一次删 DB 行的迁移，收益不大（枚举少 5 个成员），建议**顺手做**而非必须。

### C. 建议删除——2 项

| 偏好 | 理由 | 影响面 |
|---|---|---|
| `EnableTracking` | **死设置**：全仓库没有读取点，`/api/info` 硬编码 `Detailed`；实际上"TrackingId 非空即开"。留着只会让人以为能切 `normal/disabled` | 删枚举项 + defaults + i18n 2 个键（en/zh）；或反过来**把它接起来**（见下） |
| `EnableTelemetry` | 本仓库没有上报端点（`config.static.ts:8` 为空），`usage.service.ts:42-45` 直接跳过；"精度开关"没有任何实际作用 | 删枚举项 + defaults + i18n；若将来接自己的统计后端再加回 |

> 关于 #9 的另一种选择：`TrackingState.Normal/Detailed` 与 `/api/info` 的
> `state` 字段（`shared/src/dto/tracking-state.enum.ts`）目前是"永远 Detailed"。
> 若想保留"只统计 PV 不统计详情"的能力，正确做法是**把 `EnableTracking` 真的接进
> `info.controller.ts:44`**（三态映射），而不是让它当摆设。

---

## 3. 精简后的样子与工作量

- **12 项 → 5 项**（-58%）。消失的是整个 **authentication** 分组（3 项全部降为"固定默认"）
  和 **usage** 分组的一半；页面剩 3 组：
  `general(1) + imageProcessing(2：RemoveDerivativesAfter / AllowEditing) + usage(2：TrackingUrl/TrackingId)`。
- **预计工作量**
  - 只做 UI 隐藏（方案 a）+ 删 2 项死设置：**半天**（前端 ~40 行 + i18n 4 键 en/zh + 一次自测）。
  - 连枚举/校验器/默认值一起清（方案 b）：**+1 天**（后端 ~150 行 + 一条删偏好行的迁移 +
    受影响的单元/接口测试）。
  - 可选加项：修 `trackign` 拼写、给 `AllowEditing` 补前端提示、把 `JwtSecret` 那行换成
    "由 `PICSUR_JWT_SECRET` 管理"的只读说明 —— 各 ~1 小时。
- **风险**：低。改的都是"值"和"是否渲染"，不涉及权限判定与数据结构；
  唯一要注意的是 **JwtSecret 从 UI 拿掉**对"在面板里转过密钥"的老实例的影响
  （转回 env 或保持现状即可，不强制）。
