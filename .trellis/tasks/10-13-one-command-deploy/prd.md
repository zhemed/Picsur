# 真正一键部署：all-in-one 镜像 + 一键安装脚本

## 背景

用户（见 `directive.md`）要求：README 去掉 logo 图；把"三行命令"的部署变成**真正一条命令**；
并**点名让团队**找方案。参照物是 Komari 的一行：
`docker run -d --name komari --restart always -v ./data:/app/data ghcr.io/zhemed/komari:latest`
—— 它能一行是因为数据在 sqlite；我们数据全在 Postgres。

## 两条并行战线

### 战线 A：all-in-one 镜像（真·一条 `docker run`）
同一镜像内跑 **Postgres 17 + 应用**，数据落 `-v ./data`，对外仍是 8080。

- 交付：`Dockerfile.allinone`（或同 Dockerfile 的 `--target`）+ `support/allinone-entrypoint.sh`
- 语义：
  - `/data` 空 → 初始化 PGDATA、建库建用户；非空 → 直接启动（**幂等**）
  - 首次启动自动生成 `PICSUR_ADMIN_PASSWORD` / `PICSUR_JWT_SECRET` 并**打印到日志**
    （或允许用 `-e` 覆盖）；未显式提供时也要能跑，否则就不叫一键
  - 收到 SIGTERM 要**先停 Postgres 再退**，不能留半写状态
  - 端口、镜像内路径、迁移行为与常规定义**完全一致**（同一套 backend dist + 同一个 migration 流程）
- 不做：把 `:latest` 直接改成 all-in-one（常规镜像必须保持不变，两者并存）。

### 战线 B：`install.sh` 一键脚本（多容器正式路径）
`curl -fsSL https://raw.githubusercontent.com/zhemed/picsur/master/install.sh | bash`
- 自动：生成 `.env`（随机口令与 secret）、拉取/写入 compose、`docker compose pull && up -d`、
  等待就绪、**打印访问地址与管理员口令**（只打印一次）
- 幂等：重复执行 = 升级（保留已有 `.env` 与数据）
- 参数：`--dir`、`--port`、`--version`、`--admin-password`；无 docker 时给出明确提示

## 约束

- **不得改动现有东西的行为**：常规镜像、`docker-compose.yml` 默认路径、`0.0.0.0:8080` 端口、
  迁移、API 契约都不变；新增能力必须并存。
- 两条战线各自 worktree（`.worktrees/allinone` / `.worktrees/installer`），互不碰、也不碰主工作区。
- 构建/装依赖必须 Node 20 + pnpm 9.6.0。
- 验证端口：A 用 **8091**，B 用 **8092**；不得占用 8080（常驻栈）。
- 提交带 `[task:10-13-one-command-deploy]` 锚点；不 push（Lead 统一集成推送）。

## 验收标准

- [ ] AC1 all-in-one：`docker run -d --name picsur-aio -p 8091:8080 -v <空目录>:/data ghcr.io/zhemed/picsur:allinone`
      → 就绪后 `/api/info` = 0.6.0，`/i/<id>` 可用，**34 项回归全过**（含 7 格式，说明 libvips 仍完整）。
- [ ] AC2 all-in-one 数据持久化：`docker rm -f` 后用**同一个 `/data`** 再起 → 图片/用户/迁移都还在（不重新 initdb）。
- [ ] AC3 all-in-one 升级路径：`docker rm -f` + 用新 tag 起、同 `/data` → 数据在、迁移只前进。
- [ ] AC4 all-in-one `docker stop` 优雅：退出码 0，日志无 Postgres 异常关闭字样。
- [ ] AC5 install.sh：在干净目录一条命令跑完 → 起来、`/api/info` 200、打印出口令；
      **重复跑**不破坏数据（幂等）；`--port` 生效。
- [ ] AC6 两条战线的产物都不影响常驻栈（8080 全程 200）。
- [ ] AC7 README：去掉 logo 图；部署段落换成**一条命令**（A 或 B 的实际形态，以验证过的为准）。

## 风险

| 风险 | 应对 |
|---|---|
| alpine 里 Postgres 版本/包名不确定 | 先 `apk search` / 实测，失败就换 `postgres:17-alpine` 的二进制或改 Debian 基底（后者代价大，先试 alpine） |
| 双进程容器（init/信号/僵尸进程） | entrypoint 用 `exec` + `trap`，必要时上 `tini` |
| 镜像体积变大 | 可接受（一次性），但要量出来并写进文档 |
| all-in-one 让人误用于生产 | README/手册里写清适用场景（单机自用），并保留 compose 作为正式路径 |
