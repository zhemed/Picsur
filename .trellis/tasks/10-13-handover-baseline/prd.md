# 接手 Picsur：可构建可运行基线 + 改造清单

## 背景

- 上游 `CaramelFur/Picsur` 已停止维护：最后一次真实代码提交 2024-11-13（v0.5.7），
  2025-10-12 仅改 README 声明不维护；40 个 open issue 挂着。作者在 README 里明确欢迎别人接手。
- 本仓为 fork：`zhemed/Picsur`（公开，用户已确认），克隆在 `/root/picsur`，
  保留 `upstream` remote 指向上游以便对照。
- 本机环境：x86_64 / node v22.23.2 / pnpm 12.9.1（上游锁 `pnpm@9.6.0`）/ docker 29 + compose v5 /
  7.8G 内存 / 209G 可用磁盘。

## 目标

1. **可构建**：`shared` / `backend` / `frontend` 三个包在本机能独立构建通过，构建阻塞项清零。
2. **可运行**：本机拉起一套实例（PostgreSQL + backend，前端静态资源由 backend 托管），
   完成「登录 → 上传 → 查看 → 删除」冒烟。
3. **可交接**：产出改造清单（open issue 分类取舍 + 依赖/安全体检 + 上游分支盘点 +
   首批可直接开工的候选任务），作为后续任务的输入。

## 范围

**In**

- pnpm / Node 版本对齐（解决 `packageManager: pnpm@9.6.0` 与本机 pnpm 12 的差异）。
- 依赖安装、三包构建；只修**阻塞构建**的问题，不改业务行为。
- 本地 PostgreSQL（docker）+ backend 运行；前端按生产形态构建后由 backend 托管。
- API 冒烟：`/api/info`、admin 登录、上传、取回、删除。
- 改造清单落盘到本任务 `research/`。
- **验证通过后转常驻**：把同一套实例变成 `restart: unless-stopped` 的常驻服务（端口 8080）。
  因为官方 `picsur-stage2.Dockerfile` 依赖上游私有镜像 `ghcr.io/caramelfur/picsur-alpha-stage1:latest`，
  需产出**我们自己的单文件多阶段 Dockerfile**（不依赖上游 ghcr）。

**Out**

- 不新增业务功能（白模式 / 公开图库 / 相册等留给后续任务）。
- 不做域名、反代、TLS、备份策略（另开任务）；不改 8080 之外的端口规划。
- 不构建/推送自有镜像，不 push 到任何远端（push 需单独授权）。
- 不做 Angular 大版本升级、不全局改代码风格、不碰上游历史。

## 约束

- 仓库许可为 **AGPL-3.0**（`backend`/`frontend` 的 package.json 写 GPL-3.0，与根 LICENSE 不一致，
  以根 LICENSE 为准）：对外提供网络服务需提供对应源码。
- 网络动作只允许到 npm registry、容器镜像仓库、GitHub（需用户当轮授权）。
- 任何密钥/口令不得写入仓库；本地验证用 `.env`（必须进 `.gitignore`）。
- 构建产物 (`dist/`, `node_modules/`) 不入库。

## 验收标准

- [ ] AC1 `pnpm install` 在三包维度成功，锁文件无破坏性改动；若有改动，记录原因与影响。
- [ ] AC2 `backend` 构建产出 `backend/dist/main.js`。
- [ ] AC3 `frontend` 构建产出 `frontend/dist/index.html` 及其资源。
- [ ] AC4 实例起来：`GET /api/info` 返回服务信息；admin 用 `PICSUR_ADMIN_PASSWORD` 登录拿到 token。
- [ ] AC5 冒烟通过：上传 1 张图片返回 id；用返回的直链能取回；删除成功。
- [ ] AC6 `research/` 下有改造清单，含 ≥3 个「下一步可直接开工」的候选任务（附理由与工作量判断）。
- [ ] AC7 本任务改动形成本地提交（**不 push**），并按 Trellis 3.3/3.4 更新 spec 与留痕。
- [ ] AC8 常驻服务起来了：自有 Dockerfile 构建出本镜像，`docker compose ps` 显示 running /
  `restart: unless-stopped`，8080 可访问且重启容器后服务自动恢复。

## 风险

- pnpm 12 与 lockfile(v9) 不兼容 → 用 corepack 固定到 `pnpm@9.6.0`，不动 package.json。
- `sharp@0.33.5` 在 Node 22 上需要预编译二进制（安装期联网）。
- Angular 18 构建内存占用高，本机 7.8G 内存可能吃紧 → 必要时限制并行度。
- 上游 `dev` 分支可能有未发布的改进，需盘点后再定基线分支。
