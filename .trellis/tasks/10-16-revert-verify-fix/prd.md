# 修复清重建验证发现的问题

## 问题

1. **回归不可复现（最高优先）**：`support/make-image-fixtures.cjs` 在宿主报 `ERR ENOENT`、在容器内也 Node 崩溃；回归脚本假定 `/tmp/bugs-fx` 已有 8 格式夹具，却没有可执行的生成路径 → "34/34" 只能靠某人手里的临时文件。
   目标：**一条命令自给自足**——回归脚本自己生成夹具；宿主缺 JXL/JP2/HEIF 时自动用带完整 libvips 的容器生成；README/手册写成可复制的单行。
2. **路由旧语法**：启动 4 条 `LegacyRouteConverter` 警告，`/i/(.*)` 用的是旧版 path-to-regexp 语法（现被自动改写）。目标：改成新语法，行为完全不变（含 `/i/meta/:id` 优先级、404+no-store 语义）。
3. 文档：回归脚本用法缺 `<admin-password>`（Lead 已修，复核即可）。

## 验收

- [ ] AC1 在**干净机器**上：`bash support/regression-image-api.sh <base-url> <admin-password>` 一条命令跑出 **34/34**（夹具自动就位）。
- [ ] AC2 启动日志不再有 LegacyRouteConverter 警告；`/i/*` 与 `/i/meta/:id` 行为与修前逐条一致。
- [ ] AC3 两条线各自 worktree/分支、不推 master；三包构建通过。
