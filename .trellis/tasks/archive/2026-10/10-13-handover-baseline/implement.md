# 执行计划：可构建可运行基线

> 前置：用户已授权（本轮）访问 npm registry / 容器镜像仓库 / GitHub；运行形态 = design.md 的 B 方案
> （本地验证通过后转常驻）。
> **本文件在任务收尾时按实际执行结果回填**：勾选状态、命令与路径均已校正为实测值。

## 阶段 0 — 环境准备（本地，无网络）✅

- [x] 0.1 `corepack enable` + `corepack prepare pnpm@9.6.0 --activate`
- [x] 0.2 记录工具链：pnpm 9.6.0（corepack）/ Node 20.20.2（装进 `.run/node20/`）/ Docker 29 + Compose v5
- [x] 0.3 确认端口空闲：8080、5432 均空（`halodb` 的 5432 只在容器网络内）
- [x] 0.4 `.gitignore` 追加 `.env` / `.run/` / `*.log`

**实测偏差**：宿主 Node 22 装不了依赖（见阶段 1），阶段 0 需要额外准备 Node 20。

## 阶段 1 — 依赖安装（网络）✅

- [x] 1.1 `pnpm install`：**Node 22 失败**（`qoi-img`/`bmp-img`/`posix.js` 的 node-gyp 编译撞 N-API 签名变更）
      → 换 Node 20.20.2 后 **6.8s** 成功
- [x] 1.2 `git diff pnpm-lock.yaml` 为空：**lockfile 零改动**（AC1）
- [x] 1.3 `sharp@0.33.5` 走预编译 libvips（vips 8.15.3），未失败

## 阶段 2 — 构建三包 ✅

- [x] 2.1 shared → `shared/dist/index.js`（1.7s）
- [x] 2.2 backend → `backend/dist/main.js`（3.2s）
- [x] 2.3 frontend → `frontend/dist/index.html`（19.0s，1 条 bundle budget 警告，exit 0）
- [x] 2.4 最小修复一处（`frontend/custom-webpack.config.js` → `.cjs` + CJS 语法 + `angular.json` 路径）：
      Node ≥20.19 的 `require(esm)` 会让 `@angular-builders/custom-webpack@18` 拿到带 `default` 键的非法配置

## 阶段 3 — 本地实例 ✅

- [x] 3.1 `docker compose -f support/dev.docker-compose.yml up -d`（postgres:17-alpine）
      —— 该 compose **无 healthcheck**，就绪判断用 `pg_isready`
- [x] 3.2 写 `/root/picsur/.env`（`chmod 600`、gitignored，含随机 admin 口令 / JWT secret）
- [x] 3.3 `set -a; . ./.env; set +a; node backend/dist/main.js`（生产模式，跑真实 migration）
- [x] 3.4 migration 7 条全过，种子用户 admin/guest 就位

## 阶段 4 — 冒烟（AC4/AC5）✅

> 注意：计划里最初猜的端点/方法是错的，以下为**实测**端点。

- [x] 4.1 `GET /api/info` → 200（裸 node 起时 `version:"0.0.0"`，容器/`pnpm start:prod` 起才是 `0.5.7`）
- [x] 4.2 `POST /api/user/login`（admin）→ **201** + `jwt_token`
- [x] 4.3 `POST /api/image/upload`（multipart 字段 `file`）→ 201 + `id`
- [x] 4.4 `GET /i/<id>.<ext>` → 200（**必须带扩展名**；不带扩展名拿到的是品牌占位图）
- [x] 4.5 `POST /api/image/delete` + `{"ids":[...]}` → 201，三张表计数归零
- [x] 4.6 可复现 curl 序列 + 全部结论写入 `research/smoke.md`、`research/lead-verification.md`

## 阶段 5 — 改造清单（AC6）✅

- [x] 5.1 上游分支盘点：`dev` 停在 2023-03-15（yarn 时代、落后 master 46 提交）→ 不能 merge
- [x] 5.2 依赖体检：`pnpm audit`（本机源 npmmirror 无 audit 端点，须 `--registry=https://registry.npmjs.org`）
      → 生产依赖 **118 条**（5 critical / 64 high）
- [x] 5.3 issue 分类：35 条 open issue 分 A/B/C 类 + 5 个未合并 PR 盘点
- [x] 5.4 产出 `research/handover-backlog.md`（T0–T5 候选任务）

## 阶段 6 — 转常驻（AC8）✅

- [x] 6.1 新增**根目录 `Dockerfile`**（单文件多阶段）：`node:20`（**不是 slim**，原生模块要编译工具链）
      → libvips 8.16 源码编译 → vips 运行时 → 生产依赖（`SHARP_FORCE_GLOBAL_LIBVIPS=1`）。
      **零依赖上游私有中间镜像**。放根目录而非 `support/`：`.dockerignore` 里有 `support` 一行。
- [x] 6.2 新增**根目录 `docker-compose.yml`**（不是 `support/`，这样 compose 才会自动读根 `.env`）：
      `picsur` + `picsur_postgres`、8080、命名卷、`restart: unless-stopped`、
      口令用 `${VAR:?}` 守卫、附带 `PICSUR_TELEMETRY/VERBOSE=false`
- [x] 6.3 `docker build -t zhemed/picsur:local .`（首次含 libvips 编译，成功；镜像 609 MB）
- [x] 6.4 `docker compose up -d` → 两容器 Up；`/api/info` 200 (`version 0.5.7`)；
      `docker compose restart picsur` 后 ~3s 恢复且数据/登录态存活
- [x] 6.5 镜像与格式支持已记录：容器内 `.png/.qoi/.webp/.avif/.jxl/.jp2/.heif` 取回**全部 200**
      （宿主环境拿不到 HEIF/JXL/JP2，这是自有镜像的关键收益）

**降级方案**（未触发）：若 libvips 编译失败/过慢，退回 `node:22-bookworm-slim` + sharp 预编译二进制。

**回滚**：`docker compose down`（保留卷）或 `down -v`（清库）。

## 阶段 7 — 收尾

- [x] 7.1 质量检查：`trellis-check` 子代理全量复核（AC1–AC6/AC8 实测通过，密钥审计干净，自修 4 处）
- [x] 7.2 3.3 更新 spec：`spec/picsur-backend/backend/build-and-deploy.md`、`image-api-contracts.md` +
      两处索引 + `guides/index.md` 思考触发项
- [x] 7.3 3.4 提交：5 个分组提交（前端 webpack 修复 / 部署产物 / 文档 / Trellis 引导 / 改名收尾），
      均带 `[task:10-13-handover-baseline]` 锚点；已按用户授权 **push 到 origin**（`f47df7f..d103d32`）
- [x] 7.4 3.5 已在交付汇报里提醒用户 `/finish-work`（本文件随后随归档提交一起落库）
- [x] 7.5 提交后**用已提交的树重建镜像**并复跑最终验收：7 种格式全 200、重启 3s 恢复、
      旧 token 存活、遥测仍为关闭（证据 `.run/final-verify.log`）

## 审查门

| 门 | 条件 | 结果 |
|---|---|---|
| G1 | 阶段 2 三包构建全绿 | ✅ 通过 |
| G2 | 阶段 4 冒烟全过 | ✅ 通过（Lead 与 check 各自独立复跑） |
| G3 | 无密钥/口令进入 git 跟踪范围 | ✅ 通过（含镜像内扫描） |

## 遗留决策（用户定）

- `docker-compose.yml` 的端口映射当前是 `0.0.0.0:8080`（与上游示例一致），是否收窄到 `127.0.0.1:8080` 待定。
- `support/` 里上游那套构建脚本（会 push 到上游 registry）保留作对照，已加废弃横幅，是否删除待定。
