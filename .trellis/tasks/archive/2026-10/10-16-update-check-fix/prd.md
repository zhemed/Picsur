# 检查更新缓存与提示文案

## 现象与证据

- 远端已有 git tag `v0.8.2`；容器内 wget `api.github.com/repos/zhemed/picsur/tags` 第一条就是 `v0.8.2`；
- 但实例 `POST /api/system/update/check`（**普通**与 **`{"force":true}`**）都返回 `latest=0.8.1`、`updateAvailable=false`。
- 结论：服务端缓存（约 1 小时）未被显式检查绕过 → 每次发版后面板最多 1 小时仍说"已是最新版本"。
- 另一处：升级提示文案仍写 `docker compose pull && docker compose up -d` / 重新运行 `install.sh`，而这两条路径已从仓库移除。

## 要求

1. **后端**：显式检查（面板「检查更新」/`force`）必须真正刷新（可绕过 TTL），发版后立即可见；自动轮询仍可保留缓存以省额度；把该语义写进 spec。
2. **前端**：提示文案改为"先 `docker pull ghcr.io/zhemed/picsur:allinone`，再用同一条 docker run 重建"（不再提 compose/install.sh）；i18n 中英同步。

## 验收

- [ ] AC1 发布后的实例点「检查更新」→ `latest` 立刻等于最新 tag（用真机实测，贴出前后对比）。
- [ ] AC2 文案不再出现 compose/install.sh；中英一致。
- [ ] AC3 三包构建；两条线各自分支/不推 master。
