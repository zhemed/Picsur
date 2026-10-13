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
