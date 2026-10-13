# 执行计划：T0 生产依赖安全升级

> 前置：用户已授权依赖安装（npm registry）、容器镜像仓库、GitHub 访问。
> 环境契约：装依赖/构建**必须 Node 20**（`export PATH=/root/picsur/.run/node20/bin:$PATH`）+ pnpm 9.6.0。
> 常驻实例隔离：本任务**不得**占用 8080、不得动 `picsur` / `picsur_postgres` 容器。
> **本文件在收尾时按实际执行结果回填。**

## 阶段 0 — 备份与基线 ✅

- [x] 0.1 `docker tag zhemed/picsur:local zhemed/picsur:pre-t0`（回滚点）
- [x] 0.2 基线告警：沿用上一任务实测的 `audit-before.json`（118 条：5 critical / 64 high）
- [x] 0.3 升级前关键版本记录 `research/versions-before.txt`

## 阶段 1 — 版本升级 ✅

- [x] 1.1 `backend/package.json`：Nest 家族 → ^12.1.3、fastify → ^5.12.5、`@fastify/*` 四条线、
      typeorm ^0.3.31、sharp ^0.35.5、**file-type ^21.3.4（原计划 22，实测 22 要求 Node ≥22，已纠偏）**、
      devDeps `@nestjs/cli`/`schematics`/`testing` → ^12
- [x] 1.2 `shared/package.json` 未动（无必要）
- [x] 1.3 `pnpm install` 成功；lockfile 变化约 3.2k 行
- [x] 1.4 未使用 `--no-strict-peer-dependencies`；剩余 2 条 peer 警告都在 devDeps（`@nestjs/cli` 想要更新的
      webpack/ts-loader），不阻塞构建

## 阶段 2 — L1 宿主迭代 ✅

- [x] 2.1 三包构建通过（shared 1.6s / backend 3.0s / frontend 18.8s）
- [x] 2.2 修掉 4 处：sharp `OutputInfo` 具名 import、`sharp.wrapper` 的 `NodeJS.ReadableStream` cast、
      `apikey.strategy` 去掉重复回调、**`serve-static` 补 `fallthrough: true`（SPA 深链真回归）**
- [x] 2.3 dev Postgres 起在宿主 5432
- [x] 2.4 用**既有 dev 库**起后端在 **8081** → 旧库直启、migration 未重跑
- [x] 2.5 冒烟通过（Lead 也独立复跑过一遍）

## 阶段 3 — Dockerfile 与 libvips 升级 ✅

- [x] 3.1 libvips `8.16.0 → 8.18.7`（sharp 0.35 的硬要求）
- [x] 3.2 构建时未新增 apk 依赖（8.18 的依赖集与 8.16 一致）
- [x] 3.3 镜像重建成功
- [x] 3.4 **额外发现并修复**：L2 时容器内 JXL/JP2 500 → 根因是 sharp ≥0.33 只装预编译二进制、
      不再认 `SHARP_FORCE_GLOBAL_LIBVIPS` → Dockerfile 里显式跑一次 `install/build.js` 源码构建

## 阶段 4 — L2 镜像回归 ✅

- [x] 4.1 `docker compose up -d`（容器重建，数据卷不动）
- [x] 4.2 冒烟 + **7 种格式全 200**（png/qoi/webp/avif/jxl/jp2/heif），SPA 深链 4/4 → 200 text/html
- [x] 4.3 `docker compose restart picsur` → 3s 恢复、数据存活
- [x] 4.4 容器内确认 `sharp 0.35.5 / vips 8.18.7 / node v20.20.2`
- [x] 4.5 容器日志 ERROR 行数 0

## 阶段 5 — 残留告警与 overrides ✅

- [x] 5.1 升级后先复测：critical 5→1、high 64→30（残留几乎都在 `node-gyp` 编译链）
- [x] 5.2 加 11 条 override（全部同大版本补丁线；用「版本区间限定」避免误伤 devDeps 的旧大版本）
- [x] 5.3 每个 override 后重跑：`pnpm install` + 构建 + 冒烟（原生模块 `qoi-img`/`bmp-img`/`posix.js` 全部可加载）
- [x] 5.4 产出 `research/audit-after.md`：**生产依赖 118 → 0**；全量口径残留说明（前端构建链 + Angular 运行时，归 T6）
- [x] 5.5 `http-cache-semantics` 那条由 4.3.0 收口（advisory 未标修复版，但 4.3.0 已出受影响区间）

## 阶段 6 — 收尾

- [x] 6.1 自检：`trellis-check` 子代理全量复核（含 overrides 落点、7 格式、SPA、负例、密钥审计）
- [x] 6.2 spec 更新：`build-and-deploy.md` 新增 §8「依赖版本契约」（版本底线 / override 策略 / 五个坑）
- [ ] 6.3 提交（带 `[task:10-13-dep-security-upgrade]` 锚点），**不 push**
- [ ] 6.4 是否推进 T1/T2：向用户报告后决定

## 审查门

| 门 | 条件 | 结果 |
|---|---|---|
| G1 | 三包构建 + 宿主冒烟通过 | ✅ |
| G2 | 镜像构建成功 | ✅（含 sharp 源码构建修复） |
| G3 | 容器内冒烟 + 格式全过 | ✅（7/7） |
| G4 | 无密钥入库、对外契约未变 | 待 check 子代理结论 |
