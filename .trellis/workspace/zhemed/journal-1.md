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
