# 仓库精简（第一批）

## 已做

- 删除 `install.sh`（compose 部署方式已按要求移除）
- 删除 `.github/workflows/release-image.yml`（发布只走 `support/release-local.sh`）
- 手册里的 install.sh 引导替换为"唯一 docker run 命令"

## 下一批候选（待用户勾选）

1. `docker-compose.yml`（本机验证也改为 all-in-one 形态）
2. `.trellis/` 历史归档与 journal（保留 spec 与当前任务）
3. `support/` 里不再需要的脚本
