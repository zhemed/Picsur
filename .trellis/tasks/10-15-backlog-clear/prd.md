# 清空审计遗留待办（四流并行 + Lead 质检）

## 基线

刚才已发布 **0.7.9**（四线审计 + 四流修复已合并，发布镜像 34/34 回归）。本任务处理**剩余待办**。

## 四条流（写范围互斥，各自 worktree + 分支，Lead 集成）

### ① Angular 大版本 + 浏览器侧依赖 —— `i18n-stream`
**为什么必须做**：浏览器侧 59 条告警里 26 条来自 Angular，**修复版要求 19.2.16+**，无同 major 补丁。
- Angular 18.2.10 → 19.x（`@angular/*` 全套 + `@angular/material` + `@angular/cdk`，含 `ng update` 迁移、模板语法、i18n 运行时）；
- 同 major 可修的：`axios` 1.7.7 → ≥1.20、`moment` 2.30.1 → ≥2.31（或换 dayjs）、`uuid` 11.0.2 → ≥11.1.1、`follow-redirects` 1.15.9 → ≥1.16；
- **验收**：三包构建 ✓；`bash support/audit-prod.sh` 浏览器侧条数显著下降且**无 critical/high**（或列出无 patch 的残留）；用 `bw` 做一次浏览器回归（登录、上传、图片列表、预览、下载、语言切换、关于页）。
- 风险：大版本升级可能改样式/行为；**改不动就如实报告并保留分支**，不要硬塞。

### ② 前端工程债 —— `zh-default`
- `pnpm lint` 不可用：ESLint 9 但配置仍是 `.eslintrc.cjs` → 迁移到 flat config（或按 ESLint 9 要求改造），让 `pnpm lint` 真正能跑，并**在 CI 之前先本地跑通**（CI 门禁由 ③ 加）。
- `InfoService.getLoadedSnapshot()` **永不 resolve** 的根因（②线只在调用点兜了超时）：改语义 + 检查所有调用方，避免引入"静默拿到 undefined"。
- 前端范围内其余的审计低危（死方法、`User not logged in` 之类若 ② 已修可跳过）。

### ③ 运维与供应链 —— `installer`
- **CI 加门禁**：push/PR 触发 `pnpm install --frozen-lockfile` + 三包构建 + `support/audit-prod.sh`（不发布）。
- **镜像非 root**：常规镜像加 `USER`（注意 `/picsur` 归属与静态目录；all-in-one 需 root 起 Postgres，用 `su-exec` 降权的现状写清楚）。
- **`install.sh` 双实例互踩**：开跑前用 `docker inspect` 比对目标容器/卷的 `working_dir`/project 标签，冲突就明确报错。
- **Dockerfile 可复现性**：基础镜像锁 digest、`apk` 锁版本、libvips tarball 加 `sha256sum -c`、`node-gyp`/`node-addon-api` 锁版本、actions 锁 SHA、加 Dependabot（docker+npm, weekly）。
- **仓库卫生**：1.7M 审计 JSON 出库（或挪到任务目录并 gitignore）、`sharex-builder.ts` 注释里的上游 ngrok 残留。
- 每项都要给验证命令与结果；`docker compose config`、`bash -n` 之类先自查。

### ④ 后端/API 低危 —— `bugs-stream`
- A-11：SVG 目标格式带变换参数时报"图片损坏" → 改成 `Unsupported conversion`（或忽略参数返回原图）。
- A-12：以主存储格式取回会整份复制进派生表 → 短路，不落库。
- A-15：无效凭证/畸形输入进日志的**长度与转义**（灌日志/终端注入面）。
- D-7：**400 错误响应带 30 天缓存**（`/i/<id>.<不支持扩展名>`）→ 错误不加长缓存；`Successsfully` → `Successfully`。
- 验收：每条给"复现命令 → 修复后"。

## Lead 质检

- 每条流：抽查越界改动、独立复跑其"复现命令"、必要时对其分支构建/回归；
- 集成后：三包构建 + 发布镜像 34 项回归 + 面板升级验证；发 **0.8.0**（Angular 大版本，按语义化版本升 minor）。
- **历史主机名改写**（需 `git filter-repo` + force push）**需用户单独授权**，不在本任务默认范围。

## 验收标准

- [ ] AC1 四流各自交付（分支/commit/验证证据/未修项）。
- [ ] AC2 至少 6 条待办由 Lead 独立复现确认。
- [ ] AC3 三包构建 + 34 项回归全绿；面板升级可用。
- [ ] AC4 未越界；工作区干净；0.8.0 已发布。
