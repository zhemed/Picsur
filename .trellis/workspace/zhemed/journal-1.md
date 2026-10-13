# Journal - zhemed (Part 1)

> AI development session journal
> Started: 2026-10-13

---



## Session 1: 接手 Picsur：可构建可运行基线 + 改造清单
<!-- trellis-session: v=2 fp=fe45535b28501f3c -->

**Date**: 2026-10-13
**Task**: 接手 Picsur：可构建可运行基线 + 改造清单
**Package**: picsur-shared
**Branch**: `master`

### Summary

从零接手 fork zhemed/Picsur：启用 Trellis；装依赖+三包构建（Node 22 装不上，锁定 Node 20 + pnpm 9.6.0）；修 frontend custom-webpack 在 Node>=20.19 的 require(esm) 缺陷；自有 Dockerfile（不依赖上游私有中间镜像）+ 常驻 compose 上线，7 种格式转码可用；产出改造清单（生产依赖 118 条漏洞、5 个未合并 PR、35 条 issue、dev 分支不可 merge）；spec 落 build-and-deploy 与 image-api-contracts。

### Git Commits

| Hash | Message |
|------|---------|
| `d103d32` | chore(frontend): drop the old .js webpack config (renamed to .cjs) |

### Status

[OK] **Completed**


## Session 2: T0 生产依赖安全升级（Nest 12 / Fastify 5 / TypeORM / sharp）
<!-- trellis-session: v=2 fp=8d25d2215f02ebed -->

**Date**: 2026-10-13
**Task**: T0 生产依赖安全升级（Nest 12 / Fastify 5 / TypeORM / sharp）
**Package**: picsur-shared
**Branch**: `master`

### Summary

生产依赖告警 118→0（critical 5→0、high 64→0）：Nest 10→12 + Fastify 4→5 + @fastify 四条线 + typeorm 0.3.31 + sharp 0.35.5 + file-type 21.3.4 + 11 条同大版本 override；修掉 4 处升级引入的编译/运行问题（其中 serve-static fallthrough 的 SPA 深链回归只有深链冒烟能抓到）；镜像内 libvips 8.16→8.18.7 并补上 sharp 源码构建（sharp>=0.33 不再认 SHARP_FORCE_GLOBAL_LIBVIPS，否则 JXL/JP2 静默消失）。验证：三包构建、既有库零 migration 重跑、容器内 7/7 格式、SPA 深链、5 条负例、重启恢复、与 pre-t0 镜像 A/B 契约一致。已 push 到 origin。

### Git Commits

| Hash | Message |
|------|---------|
| `050eaeb` | chore(deps): upgrade Nest 12 / Fastify 5 / TypeORM / sharp; prod audit 118 -> 0 |

### Status

[OK] **Completed**


## Session 3: 脱离上游（一）：仓库切换 + 去上游化改造
<!-- trellis-session: v=2 fp=d0aa80b3d1a61535 -->

**Date**: 2026-10-13
**Task**: 脱离上游（一）：仓库切换 + 去上游化改造
**Package**: picsur-shared
**Branch**: `master`

### Summary

把项目从上游彻底摘出来：① 仓库层面——原 fork 改名 zhemed/Picsur-fork-archive 并归档（只读），新建非 fork 仓库 zhemed/picsur，origin 切过去、upstream remote 删除、全历史推送；② 运行时——遥测断链（ReportUrl 编译期置空 + UsageService 端点为空即跳过），DB 首选项置 true 也不出网（tcpdump 0 包验证）；③ 元数据——四个 package.json 换到自有版本线 0.6.0、repository/author 指向新仓库；④ 品牌保留 Picsur，只去掉上游指向（页脚、og 标签、README 重写、删上游 FUNDING.yml）。验证：三包构建、容器 7 格式全 200、SPA 深链、/api/info version=0.6.0、密钥零入库、白名单外零上游字样。

### Git Commits

| Hash | Message |
|------|---------|
| `8dbf5f0` | chore: reword comments that still carried upstream coordinates |

### Status

[OK] **Completed**


## Session 4: 团队三线并行：吸收上游 PR + 修 bug + 中文界面，并集成验收
<!-- trellis-session: v=2 fp=706e6721daa067fe -->

**Date**: 2026-10-13
**Task**: 团队三线并行：吸收上游 PR + 修 bug + 中文界面，并集成验收
**Package**: picsur-shared
**Branch**: `master`

### Summary

三条战线并行（各自 worktree/分支/库/端口）：prs 吸收 #128 默认PNG（带 migration）/ #115 list-all / #129 SVG（含净化+CSP）；bugs 修 #107 超像素400 / #112 剪贴板降级 / 删除语义改 404+no-store / meta no-store；i18n 吸收 #130 中文界面（自研 I18nService，无新依赖）。Lead 集成：4 处冲突手工解（headImage 双能力、view 的 SVG/i18n 分支、剪贴板结构化+文案、词典补 key），新增 jsdom/dompurify/svgo/is-svg 后又用 3 条 override 把生产告警压回 0；复核子代理抓出并修掉一个真安全洞（SVG 净化只查 <use>，外链可绕过）与一处漏翻；最终镜像重建后 34 项回归 + 21 项端到端全绿，容器内 7 格式可用，SVG 外链/script/javascript 全删。

### Git Commits

| Hash | Message |
|------|---------|
| `ef1c89e` | docs: record the absorbed capabilities and the no-extension contract |

### Status

[OK] **Completed**


## Session 5: 轮换开发实例凭据（admin 口令 + JWT secret）
<!-- trellis-session: v=2 fp=d459947d00fea257 -->

**Date**: 2026-10-13
**Task**: 轮换开发实例凭据（admin 口令 + JWT secret）
**Package**: picsur-shared
**Branch**: `master`

### Summary

按用户选择就地轮换：新随机口令（32 字符）与新 JWT secret（64 hex）。踩到三个坑并全部写进 spec §11：① ensureUserExists 只创建不更新（改 .env 不改已有 admin 口令）；② jwt_secret 运行期读数据库首选项，.env 只在首选项缺失时生效；③ docker compose 优先用 shell 环境变量而非 .env——第一次轮换因此'假成功'（库改了值、容器还是旧的），用 sha256 比对 .env/容器/数据库三处才发现。兜底路径：用应用自带 bcrypt-ts 直接写 hashed_password（口令走 stdin，脚本放 backend 目录解析 node_modules，用完删）。验证：新口令 201、错口令被拒、旧 token 失效、34 项回归全过、中文界面正常、图片行数不变。

### Git Commits

(No commits - planning session)

### Status

[OK] **Completed**
