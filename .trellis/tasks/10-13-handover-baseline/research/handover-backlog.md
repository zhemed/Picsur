# 改造清单（接手 Picsur）— 阶段 5 产出

> 数据来源：`git fetch upstream`（2026-10-13）、`gh issue list` / `gh pr list`（公开数据）、
> 本仓库代码走查。**未做**依赖漏洞扫描的部分已明确标注。

## 1. 上游状态快照

| 项 | 值 |
|---|---|
| 仓库 | `CaramelFur/Picsur`（本 fork：`zhemed/Picsur`，公开） |
| 默认分支 | `master`，合入 v0.5.7，最后一次真实代码提交 **2024-11-13** |
| 声明 | README 明确 **NOT MAINTAINED**，作者公开邀请别人接手 |
| 体量 | 1.2k star / 68 fork / 40 open issues+PR / 5 open PR |
| 许可 | 根 LICENSE = **AGPL-3.0**（`backend`/`frontend` 的 package.json 写 GPL-3.0，不一致，以根 LICENSE 为准） |

## 2. 分支盘点

| 分支 | 最后提交 | 与 master 关系 | 判断 |
|---|---|---|---|
| `master` | 2024-11-13 | 基线（v0.5.7） | **我们的基线** |
| `dev` | **2023-03-15** | 分叉点 `0e1146f`；dev 独有 12 提交，master 领先 46 提交 | ❌ 不能直接 merge |
| `s3` | 更早的 WIP | — | ❌ 废弃草案 |
| `old/test-update` | 更早 | — | ❌ 无价值 |

**`dev` 里有什么**：本地文件存储、S3 存储、存储设置页、动图存成无损 WebP、Node 版本过旧告警。
**为什么不能合**：`dev` 停留在 **yarn** 时代（`yarn.lock` 还在，多出 1214 行），而 master 已经迁到 pnpm；
分叉 2.5 年、落后 46 个提交、涉及 52 个文件 +2407/-183。
→ **结论：S3 / 文件存储要做就参照它的设计重新实现，不要走 merge。**

## 3. 未合并 PR（最值钱的现成资产）

5 个 PR 全部 `MERGEABLE/CLEAN`，作者提交后上游从未合入：

| PR | 内容 | 规模 | 价值判断 |
|---|---|---|---|
| **#130** | **中文 i18n**（zh-CN，含 `assets/i18n/zh.json` + i18n 模块） | +1559/-433，92 文件 | ⭐ 最高：直接给中文界面（对应 issue #57/#124） |
| #129 | SVG 支持（对应 #63） | +600/-83，11 文件 | 高：图床常见需求，改 mimes + 图像处理 + 前端 |
| #128 | 上传后默认格式 PNG（对应 #111） | +55/-19，9 文件 | 高：小改动，**带一个 migration**，可当第一个练手 |
| #115 | API：列出全部图片（无分页） | +89/-0，5 文件 | 中：对脚本/备份友好 |
| #127 | README 加 Zeabur 部署按钮 | +2/-0 | 低：纯文档，可忽略或顺手合 |

⚠️ **冲突提示**：`#130` 与 `#129` 都改 `frontend/angular.json` + `frontend/custom-webpack.config.mjs`，
两个一起合会冲突 → 建议按 **#128 → #115 → #129 → #130** 顺序逐个合、逐个验证。
合之前都要 rebase 到我们 master 并**跑一遍构建 + 冒烟**（上游 CI 不存在）。

## 4. Open issue 分类（35 条）

### A. 真 bug，可修（优先）

| Issue | 内容 | 备注 |
|---|---|---|
| #107 | 输入图片超过像素上限 | 带 `good first issue` 标签，有复现，sharp `limitInputPixels` 相关 |
| #116 | Docker 部署下部分上传在查看 URL 时 500 | 影响最大，需复现定位（可能和 QOI 转换/大图有关） |
| #112 | API key 复制存在问题 | 前端复制逻辑，好定位 |
| #51 | Docker 容器启动失败 | 10 条评论，缺 `more info`，需先补日志 |
| #101 | 分享菜单在不可用时的提示不清晰 | 前端文案/状态判断 |

### B. 信息不足/环境类（需人回帖，不是代码问题）

#60 / #62（登录无反应）、#70（403）、#88（API permission denied）、#91、#125（Unraid）、
#122（JWT 有效期提问）、#123（Typora）、#126（OIDC）、#131（无内容）、#106、#78

### C. 功能增强（按价值）

| 方向 | Issues | 判断 |
|---|---|---|
| 存储后端（S3 / 本地文件） | #4（5 评论） | ⭐ 长期关键：现在图片全存 Postgres，图床规模化必换 |
| 图库/相册/搜索 | #12、#16、#26、#132 | 上游 README 的 TODO（公开图库、相册），一套设计能覆盖 |
| 过期策略 | #74、#102 | 站点级强制过期，改动小 |
| 格式/上传体验 | #63(SVG)、#111(默认PNG)、#92(base64)、#58(URL 上传) | 前两个已有 PR |
| 多语言 | #57、#124 | 已有 PR #130 |
| 其它 | #118 短链、#119 批量删除、#31 Linux uploader、#32 统计图表 | 按需 |

## 5. 依赖 / 安全体检（已实测）

> 环境：本机 Node 20.20.2 + pnpm 9.6.0。
> 坑：本机 npm 源指向 `npmmirror`，其 audit 端点不存在 → 必须
> `pnpm audit --registry=https://registry.npmjs.org` 才有结果。

| 范围 | critical | high | moderate | low | 合计 |
|---|---|---|---|---|---|
| 全部（含 devDeps） | 9 | 148 | 123 | 25 | **305** |
| **生产依赖（对外服务真正暴露的）** | **5** | **64** | 40 | 9 | **118** |

生产依赖里最该先处理的（这一栏直接决定「这个图床挂公网安不安全」）：

| 包 | 严重度 | 问题 | 现状 → 应升到 |
|---|---|---|---|
| `@fastify/middie` | critical | 中间件认证绕过 / 路径绕过 | ≤9.3.1 → ≥9.3.2 |
| `@fastify/reply-from` | critical | Connection 头滥用 → 剥离代理防护 | ≤12.6.1 → ≥12.6.2 |
| `proxy-addr` | critical | IPv4-mapped IPv6 绕过 → IP 伪造（影响限流/信任代理） | <2.0.8 → ≥2.0.8 |
| `tar` / `sha.js` | critical | 解压 DoS / 哈希回滚 | 见 audit json |
| `@fastify/static` | high | **路由守卫绕过（路径穿越）** —— 直接关系图片托管与静态资源 | ≤10.1.0 → ≥10.1.1 |
| `typeorm` | high | SQL 注入（UpdateQueryBuilder / SoftDelete） | <0.3.26 → ≥0.3.26 |
| `sharp` | high | 继承自 libvips 的漏洞（CVE-2026-33327 等） | <0.35.0 → ≥0.35.0 |
| `@fastify/multipart` | high | 上传端点资源无限消耗 | ≤8.3.0 → ≥8.3.1 |
| `fastify` 本体 | high | Content-Type 校验绕过 / X-Forwarded 伪造 | <5.7.2 → ≥5.7.2 |
| `file-type` | moderate | ASF 解析死循环（上传路径） | → ≥21.3.1 |

⚠️ **不能 `pnpm up` 一键平掉**：`sharp`、`typeorm`、`fastify`、NestJS 都是跨大版本
（Fastify 4→5、NestJS 10→11 才拿得到上面这些修复），必须「升级 + 构建 + 冒烟回归」，
是独立任务（见 T0）。

除漏洞外的结构风险（实读代码得到）：

- 后端 `TypeOrmConfigService` 非生产模式开 `synchronize` + 始终 `migrationsRun`
  → 生产必须 `PICSUR_PRODUCTION=true`，否则 schema 被 ORM 直改。
- `sharp@0.33.5` 依赖预编译 libvips；**HEIF/JXL/JP2 只有官方镜像里那套自编译 libvips 才有**
  → 自有镜像必须沿用 vips 编译层（本任务已解决）。
- 上游 `support/picsur-stage2.Dockerfile` 依赖上游私有中间镜像
  `ghcr.io/caramelfur/picsur-alpha-stage1:latest` → **上游 ghcr 一清就构建不了**
  （已用根目录单文件 `Dockerfile` 替代）。
- `PICSUR_VERBOSE=true` 会把 JWT secret 与 DB 口令明文写进日志（实测）；
  遥测默认开着，会去打已停维护的 `metrics.picsur.org`（实测 WARN）。

## 6. 首批可直接开工的候选任务

| # | 候选任务 | 涉及包 | 预估 | 理由 |
|---|---|---|---|---|
| **T0** | **生产依赖安全升级**（fastify 4→5 / NestJS 10→11 / typeorm / sharp，配冒烟回归） | backend, shared | 2–4 天 | ⭐ 5 critical + 64 high 全在生产依赖里，公网暴露前必须先做 |
| T1 | 合入 PR #128（默认 PNG）+ #115（图片列表 API） | backend, shared, frontend | 0.5–1 天 | 现成代码、干净可合，先把「接收别人 PR」的流程跑通 |
| T2 | 修 #107 像素上限 + #112 API key 复制 + 已发现的「删除后仍 200 + 缓存一个月」 | backend / frontend | 0.5–1 天 | 小 bug、收益直接；删除语义这条是我们自己冒烟发现的 |
| T3 | 合入 PR #129 SVG 支持（合完跑构建 + 冒烟） | backend, shared, frontend | 1 天 | 图床高频需求，注意与 #130 的前端文件冲突 |
| T4 | 中文界面：合入 PR #130（i18n） | frontend | 1–2 天 | 自用体验提升最大；体量大，单独一个任务 |
| T5 | 存储后端重做（本地文件 / S3），参照 `dev` 分支设计但重写 | backend, shared, frontend | 3–5 天 | 现在图片全在 Postgres，是最大架构债；长期必做 |

## 7. 未完成项（诚实边界）

- `pnpm outdated` 的逐包版本差（Angular / NestJS 具体差几个大版本）尚未整理成表；本次只做了漏洞维度。
- #116、#51 这类需要复现的 bug：尚未复现，只是从 issue 描述判断「可修」。
- `dev` 分支的 S3 实现细节：只看了提交标题与 diffstat，没有逐行读代码。

## 8. 接手必知（环境与运行，细节见 `research/smoke.md`）

| 事项 | 结论 |
|---|---|
| Node 版本 | **装依赖/构建必须 Node 20**（≥22.16 时 `qoi-img`/`bmp-img`/`posix.js` 的 node-gyp 编译会因 N-API 签名变更失败）；**运行期 Node 22 正常** |
| 前端构建 | 上游 `frontend/custom-webpack.config.js` 在 Node ≥20.19 会炸（`require(esm)` 返回命名空间）→ 本任务已改成 `.cjs` |
| 上传端点 | `POST /api/image/upload`（不是 `/api/image`），multipart 字段名 `file` |
| 删除 | `POST /api/image/delete`，body `{"ids":[...]}`（不是 HTTP DELETE） |
| 取图 | `/i/<uuid>.<ext>`；**不带扩展名拿不到原图**，返回的是品牌占位图 `notfound.png`（不是 `index.html`） |
| 默认存储格式 | QOI（`/i/<id>.qoi` 可验证）；原图能否保留取决于 `keep original` 设置 |
| 状态码 | 所有 POST 默认 201（NestJS 默认行为） |
| 日志安全 | 不要开 `PICSUR_VERBOSE`：会把 JWT secret / DB 口令明文打进日志 |
| 遥测 | 默认开启并请求已停维护的 `metrics.picsur.org`，启动会有 WARN → 设 `PICSUR_TELEMETRY=false` |
| 删除后的图 | `/i/<deleted-id>.png` 仍返回 200，返回的是品牌占位图 `notfound.png` 且带 `Cache-Control: max-age=2592000` → 状态码语义与缓存策略都值得改 |
| JWT secret 存放 | `jwt_secret` 是**系统首选项**（`PICSUR_JWT_SECRET` 只在启动时写入），admin 用 `GET /api/pref/sys` 能明文读出 → 拿到 admin token 等于能伪造任意用户 JWT。属需要评估的凭据暴露面（自用可控，多用户实例要改） |
| 出网遥测 | 默认 `enable_telemetry=true`，会定时向已停维护的 `metrics.picsur.org` 发请求；**env `PICSUR_TELEMETRY` 关不掉它**（只影响一行启动日志），必须改系统首选项。部署时已关 |
| 转换资源限制 | 系统首选项另有 `conversion_memory_limit=512`(MB)、`conversion_time_limit=15s`、`bcrypt_strength=10`、`jwt_expires_in=7d`、`remove_derivatives_after=7d` —— 大图场景要按机器内存调 |
