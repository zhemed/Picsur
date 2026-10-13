# 技术设计：生产依赖安全升级

> 版本数据来源：`research/dependency-upgrade-matrix.md`（本轮 `npm view` 实测，2026-10-13）。

## 1. 升级矩阵（为什么是这些版本）

| 包 | 现在 | 目标 | 依据 |
|---|---|---|---|
| `@nestjs/{core,common,platform-fastify}` | ^10.4.6 | **^12.1.3** | 见 §2：11 也修不掉 middie critical |
| `@nestjs/config` | ^3.3.0 | ^12.0.1 | peer 要求 common ^11/^12 |
| `@nestjs/jwt` / `passport` / `schedule` / `serve-static` / `typeorm` | ^10.x | ^12.x | 跟着主版本走 |
| `@nestjs/throttler` | ^6.2.1 | ^6.7.1 | 6.7.1 已声明支持 Nest ^12，**不用**大版本 |
| `fastify` | ^4.28.1 | **^5.12.5** | Nest 12 的 platform-fastify 内嵌 5.12.5 |
| `@fastify/helmet` | ^11.1.1 | ^13.1.2 | fastify 5 线 |
| `@fastify/multipart` | ^8.3.0 | ^10.1.3 | Nest 12 peer 要求 `^10.1.0` |
| `@fastify/static` | ^7.0.4 | ^10.1.6 | Nest 12 peer 要求 `^10.1.2`；告警要求 ≥10.1.1 |
| `@fastify/reply-from` | ^10.0.0 | ^12.7.1 | 告警要求 ≥12.6.2（无 10.x 修复版） |
| `typeorm` | ^0.3.20 | **^0.3.31** | 告警要求 ≥0.3.26/0.3.29；**不上 1.x**（跨大版本，收益不明） |
| `sharp` | ^0.33.5 | **^0.35.5** | 告警要求 ≥0.35.0 |
| `file-type` | ^19.6.0 | **^22.1.1** | 告警要求 ≥21.3.1；API 仅用 `fileTypeFromBuffer`，ESM 兼容 |
| `zod` | ^3.23.8 | **不动** | 无相关告警；v4 是破坏性升级，属 T6 |
| `@nestjs/cli`（dev） | ^10.4.5 | ^12.0.8 | 构建 Nest 12 用 |

### 2. 为什么直接上 Nest 12 而不是 11

实测 `@nestjs/platform-fastify`：

| 版本 | 内嵌 `@fastify/middie` | 是否修掉 critical（需 ≥9.3.2） |
|---|---|---|
| 11.0.0 | **9.0.3** | ❌ 仍然中招 |
| 12.1.3 | **9.3.5** | ✅ |

## 3. sharp ↔ libvips 的耦合（本任务最容易翻车的地方）

- `sharp@0.35.5` 的 `config.libvips` = **`>=8.18.7`**；`sharp@0.33.5` 是 `>=8.15.3`。
- 我们的 Dockerfile **自己编译 libvips 8.16.0**（为了 HEIF/JXL/JP2）。
  → 升 sharp 必须**同时**把 Dockerfile 里的 libvips 升到 ≥8.18.7，否则镜像构建会在
  `pnpm install --prod`（sharp 源码编译）阶段失败。
- 宿主迭代不涉及：npm 上的 sharp 用自带预编译 libvips，只影响 jpeg/png/webp/avif/tiff/gif/svg。
- **降级预案**（若 8.18.x 在 alpine 上编不出来）：保持 sharp 0.33.5 + libvips 8.16，
  把 `sharp` 的 high 告警作为**唯一**被接受的残留，并在 spec 与报告中写清风险；
  critical 与其他 high 仍然必须清零。

## 4. 传递依赖 overrides 策略

大版本升完先重新 audit，再决定要不要 override：

1. 只对「直达不了、又没有安全版本被间接锁定」的包加 `pnpm.overrides`（例如 `tar`、`lodash`、
   `qs`、`undici`、`brace-expansion`、`form-data`、`node-forge`、`jws` 之类）。
2. **禁止**跨大版本乱顶（如把 `path-to-regexp@0.x` 顶到 8.x）——那会直接改运行时行为。
3. 每个 override 落盘前必须：构建通过 + 冒烟通过；做不到就去掉并记录。
4. 判断顺序：先看能不能靠升级直接依赖解决 → 再看 override → 最后才写「接受残留」。

## 5. 数据与契约兼容

- **不动 schema、不加 migration**。typeorm 0.3.20 → 0.3.31 属补丁线，`migrationsRun` 语义不变；
  既有库的 7 条 migration 不会重跑（以 `migrations` 表为准）。
- `PICSUR_PRODUCTION=true` 时 `synchronize:false`，升级不会改库结构。
- 对外契约（`/api/info`、`/api/user/login`、`/api/image/upload`、`/api/image/delete`、`/i/:id.:ext`）
  是回归验收项，见 `research/` 的接口契约 spec（`image-api-contracts.md`）。

## 6. 验证策略（两级）

| 级别 | 环境 | 目的 | 通过条件 |
|---|---|---|---|
| L1 宿主迭代 | Node 20 + `support/dev.docker-compose.yml` 的 Postgres + 后端跑 **8081** | 快速发现编译错误与 API 变更 | 三包构建 + 冒烟 |
| L2 镜像回归 | 根 `Dockerfile` 重建 → `docker compose up -d --build` | 验证 libvips 升级与真实运行形态 | 冒烟 + 7 种格式 + 重启恢复 |

**常驻实例隔离**：L1 不得占用 8080、不得动 `picsur` / `picsur_postgres` 容器。

## 7. 回滚

- 代码：`git checkout -- backend/package.json shared/package.json pnpm-lock.yaml`（+ Dockerfile）。
- 运行：升级前先 `docker tag zhemed/picsur:local zhemed/picsur:pre-t0`，
  回滚即 `docker tag zhemed/picsur:pre-t0 zhemed/picsur:local && docker compose up -d`。
- 数据：本任务不改 schema，**无数据回滚需求**。

## 8. 残留风险（事先写清，避免事后辩解）

- **前端 Angular 18 的浏览器端告警**（XSS/XSRF 类）不在 `--prod` 口径里但真实存在于产物中 → 归 T6。
- `zod@3` 不动；若将来升 4 需全量回归。
- `pnpm audit` 口径基于 npm advisory 数据库，不等于「没有漏洞」；本任务的目标是清零已知告警。
