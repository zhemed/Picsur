# 对齐 Komari 的部署体验与说明文件密度

## 背景

用户拿自己另一个项目 `zhemed/komari` 的 README 作参照（"我感觉很舒服"）：一句话定位 + 版本线、
一条 `docker run` 拉现成镜像、数据目录、升级方式、自检脚本，其余全部甩给 `docs/MAINTAINING.md`。
本项目目前必须 `git clone` 后本地 `--build`，且 README 塞满配置表与构建细节。

## 目标（用户选定「全都做」）

1. 发布预构建镜像到 `ghcr.io/zhemed/picsur`，部署变成"一条命令拉现成镜像"。
2. README 压到 Komari 同款密度。
3. 运维细节挪进 `docs/MAINTAINING.md`。

## 范围

**In**：`.github/workflows/release-image.yml`（构建 + 推 ghcr）、`docker-compose.yml` 支持"用发布镜像"、
`docs/MAINTAINING.md`（新建）、`README.md`（重写）。
**Out**：不做面板内一键自升级（需把 docker socket 交给 Web 应用，安全面不划算）；
不改存储引擎（不为了 `-v ./data` 把 Postgres 换掉）。

## 约束

- 镜像发布**只用内置 `GITHUB_TOKEN` + `packages: write`**，不引入任何新凭据/secret。
- 不改运行时行为：镜像内容、compose 服务定义、端口（`0.0.0.0:8080` 保持）都不变，
  只是多一条"拉现成镜像"的路径与一份更短的 README。
- README 里每条命令必须**当场跑过**；不许写没验证的命令。
- 本地开发路径（`--build`）必须仍然可用。

## 验收标准

- [ ] AC1 工作流存在且**在 GitHub 上跑成功**（`gh run list` 可见 success），产出
      `ghcr.io/zhemed/picsur:latest` 与版本 tag。
- [ ] AC2 干净拉取验证：`docker pull ghcr.io/zhemed/picsur:latest` → 用**拉下来的镜像**起栈 →
      `/api/info` 返回 `0.6.0` → `support/regression-image-api.sh` **34 项全过**。
- [ ] AC3 `docker compose up -d --build`（本地构建路径）仍然可用（不被新写法破坏）。
- [ ] AC4 `README.md` ≤ 35 行，结构 = 一句话定位+版本线 / 部署 / 自检 / 指针；中文。
- [ ] AC5 `docs/MAINTAINING.md` 覆盖：构建、发版、部署口径、备份与恢复、回滚、
      凭据轮换、自检、规范指针（且与 `.trellis/spec/` 不冲突、互相指路）。
- [ ] AC6 提交带 `[task:10-13-align-komari-style]` 锚点并 push；工作树干净。

## 风险

| 风险 | 应对 |
|---|---|
| CI 里编 libvips 慢/失败（本地 1m45s，CI 更慢） | 用 `type=gha` 层缓存；失败就看日志修（网络/依赖差异） |
| ghcr 包权限 | 用内置 `GITHUB_TOKEN` + `packages: write`；包默认私有，需要时在仓库页设 public |
| 改 compose 影响现有常驻实例 | 保留 `build:` 与本地 tag 能力；验证时用单独容器名/端口起验证栈，不拆常驻栈 |
