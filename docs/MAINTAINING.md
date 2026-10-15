# 维护手册（Picsur 自维护版）

> 面向"自己维护这套东西"的人：怎么构建、怎么发版、怎么部署/备份/回滚/轮换凭据。
> README 只讲怎么把它跑起来，细节都在这里。可执行契约（环境变量、镜像、迁移、API）在
> [`.trellis/spec/picsur-backend/backend/build-and-deploy.md`](../.trellis/spec/picsur-backend/backend/build-and-deploy.md)。

- 仓库：<https://github.com/zhemed/picsur>（非 fork；上游 [Picsur](https://github.com/CaramelFur/Picsur) 已于 2024 年停止维护）
- 版本线：`0.7.x`（具体版本见根 `package.json`，发版时四处同步）；许可 AGPL-3.0
- 组成：`shared`（DTO/实体）→ `backend`（NestJS 12 + Fastify 5 + TypeORM + Postgres）→ `frontend`（Angular 18，产物由后端托管）

## 1. 构建

装依赖与构建**必须 Node 20 + pnpm 9.6.0**（`qoi-img` / `bmp-img` / `posix.js` 在 Node ≥ 22.16 编不过；
构建产物本身可以在更高版本 Node 上运行）：

```bash
corepack enable && corepack prepare pnpm@9.6.0 --activate
pnpm install
pnpm build                              # = shared → backend → frontend
pnpm --filter picsur-backend start:prod # 直接跑（需要 .env）
```

本地镜像（与 CI 发布的是同一个 Dockerfile）：

```bash
docker build -t ghcr.io/zhemed/picsur:latest .
docker build -t zhemed/picsur:local . # 想另起名字也行，用 PICSUR_IMAGE 指定
```

> 镜像里自编译 libvips（HEIF / JXL / JP2 才有），整链约 2 分钟。宿主预编译的 `sharp` > **没有** JXL/JP2 解码器，所以格式相关验证必须在容器里做。
>
> **可复现性（2026-10-15 起）**：基础镜像锁 digest、apk 包锁版本、libvips 源码包校验 sha256、
> 全局 `node-gyp`/`node-addon-api` 锁版本；CI 的 action 也锁了 commit SHA，Dependabot 每周提更新。
> Alpine 一旦发新的 `-rN` 修订，`docker build` 会因为锁的版本消失而**明确失败** —— 这时跑
> `bash support/apk-versions.sh` 重新解析，把打印出的版本同步进 `Dockerfile` / `Dockerfile.allinone` 即可。

## 2. 发版

1. **版本号同步**：四处 `package.json`（根 / `shared` / `backend` / `frontend`）改成同一版本；
   `support/setversion.sh` 可批量改。`/api/info` 与前端页脚都读它（容器内由 pnpm 注入
   `npm_package_version`；裸跑 `node dist/main.js` 会显示 `0.0.0`，这是已知行为）。
2. **提交 + 打 tag**：版本号提交后推 `v<版本>` tag（下面第 3 步的脚本会自动打并推，不用手打）：
   ```bash
   git commit -am "chore(release): <新版本> [task:<任务名>]"
   ```
3. **发布镜像（默认走本地）**：`bash support/release-local.sh` —— 构建并推送
   `ghcr.io/zhemed/picsur:<版本>`、`:v<版本>`、`:<主.次>`、`:latest`、`:allinone`，
   最后自动创建并推送 `v<版本>` git tag（tag 已存在则跳过）。热缓存约 2 分钟，
   比 GitHub runner（7+ 分钟）快得多。脚本会拒绝脏工作树/未推送提交（除非 `--allow-dirty`），
   并在版本早于远端最新 tag 时拒绝发布（防止 `:latest` 回退）。
   `.github/workflows/release-image.yml` 是**备用/可复现路径**：推 `v*` tag 会自动跑，
   或在 Actions 里手动 `workflow_dispatch`（**选分支触发只构建、不推送**；选 tag 才会发布）。
   两者都用内置 `GITHUB_TOKEN`（`packages: write`），不需要额外 secret。
4. **验证发布的镜像**（别只信 CI 绿）：一条脚本搞定——拉发布镜像、用**隔离的** compose 项目/端口
   （默认 8099）/独立卷起一套、查版本与迁移条数、跑 34 项回归、再拆干净，全程不碰常驻栈：
   ```bash
   bash support/verify-published-image.sh latest # 或传版本号：... v0.7.8 / 0.7.8
   ```
   脚本跑完会打印"常驻栈未受影响"的探活结果；期望 `通过 8 / 失败 0`（迁移条数从仓库里的
   migration 文件数推出，不再写死）。

## 3. 部署

```bash
git clone https://github.com/zhemed/picsur && cd picsur
cp .env.example .env # 改 PICSUR_ADMIN_PASSWORD / PICSUR_JWT_SECRET
docker compose pull && docker compose up -d
```

- 应用监听 `0.0.0.0:8080`（有意发布给同网段，便于图片直链被外部引用；要收窄就改 compose 里的
  `ports` 为 `127.0.0.1:8080:8080` 并交给反代）。
- **应用以非 root 运行**（常规镜像 `USER node`，uid 1000；all-in-one 例外，见 §3.1 与 `Dockerfile.allinone` 注释）。
  数据全在 Postgres 里（图片行、用户、首选项），命名卷 `picsur-data`。
  应用容器**额外挂载了宿主 `/var/run/docker.sock`**（`docker-compose.yml` 默认挂，用于面板内一键升级）——
  等于把宿主 docker 的控制权交给面板，只应在完全信任管理员的机器上开；不要就删掉那个挂载并设
  `PICSUR_ALLOW_SELF_UPDATE=false`（面板退化为只显示可复制的升级命令）。
  因为进程不是 root，**还要把宿主 docker 组的 GID 加进容器**，socket 才真的可用：
  `PICSUR_DOCKER_GID=$(stat -c %g /var/run/docker.sock)`（install.sh 会自动探测并写进受管 override；
  手工部署就把它写进 `.env`，或直接在 compose 的 picsur 服务下加 `group_add: ['<那个 GID>']`）。
- 升级：`git pull && docker compose pull && docker compose up -d`。数据库迁移随容器启动自动执行，
  只前进不回退。

### 3.1 两种部署形态

**all-in-one（单容器，一条 `docker run`）** —— 镜像 `ghcr.io/zhemed/picsur:allinone`，容器内自带
PostgreSQL 17，数据全在 `-v ./data:/data`：

```bash
docker run -d --name picsur --restart always -p 8080:8080 -v ./data:/data ghcr.io/zhemed/picsur:allinone
```

- 首启自动 initdb + 建库，并**自动生成**管理员口令与 JWT secret（打印在 `docker logs`，
  也落盘在 `./data/allinone.env`，权限 600）；用 `-e PICSUR_ADMIN_PASSWORD=... -e PICSUR_JWT_SECRET=...` 可覆盖。
- 升级：`docker rm -f picsur` → 用新 tag 跑同一条命令（同 `/data`），迁移自动执行；**先备份**。
- 备份：`docker stop picsur && tar czf picsur-backup.tgz -C ./data .`（含 `allinone.env`，别丢）。
- 局限：单机自用定位；**不支持多副本**（一个 `/data` 只能一个 postmaster）；必须 root 运行；
  Postgres 用默认参数。要更大规模请走下面的 compose 路径。

**compose + install.sh（多容器，生产口径）** —— 独立 Postgres 容器，脚本自动生成密钥并部署：

```bash
curl -fsSL https://raw.githubusercontent.com/zhemed/picsur/master/install.sh | bash
```

脚本是**幂等**的（重复执行=升级，不覆盖已有 `.env`、不重建数据卷），支持 `--dir/--port/--version/--admin-password`；
无 docker、端口被占用、`.env` 缺变量等都会明确报错并非零退出。

## 4. 备份与恢复

**备份**（全量就是数据库。**写到仓库外**，别写进工作区 —— dump 里有全部图片行、用户与口令哈希）：

```bash
mkdir -p ~/picsur-backups
docker compose exec -T picsur_postgres pg_dump -U picsur -d picsur -Fc \
  > ~/picsur-backups/picsur-$(date +%F).sqlc
```

**恢复**（先停应用，避免写入竞争）：

```bash
docker compose stop picsur
docker compose exec -T picsur_postgres pg_restore -U picsur -d picsur --clean --if-exists \
  < ~/picsur-backups/picsur-2026-10-13.sqlc
docker compose start picsur
```

## 5. 回滚

- **只回滚应用**：改镜像 tag 再起（数据库不动）：
  `PICSUR_IMAGE=ghcr.io/zhemed/picsur:0.6.0 docker compose up -d`
- **注意**：数据库迁移只前进。若新版本带了 migration，回滚镜像**不会**撤销 schema 变更；
  旧版本对新增列/表通常无感（本仓库的 `AddImageSourceFiletype` 就是加可空列），但涉及删列/改语义时
  必须先用备份恢复。回滚前**先做一次备份**。

## 5.1 面板内升级（0.7.0 起）

- **默认**：设置 →「关于」显示当前/最新版本，可点「检查更新」（只读 GitHub tags，缓存 1 小时，可用
  `PICSUR_UPDATE_CHECK=false` 关闭）；「立即升级」禁用，但会给出**可复制的升级命令**。
- **一键自升级默认就开**：只要给容器挂了 docker socket 即可（0.7.7 起应用默认 `PICSUR_ALLOW_SELF_UPDATE=true`；旧版本需显式设该变量）：

  ```bash
  docker run -d --name picsur --restart always -p 8080:8080 -v ./data:/data \
    -v /var/run/docker.sock:/var/run/docker.sock -e PICSUR_ALLOW_SELF_UPDATE=true \
    ghcr.io/zhemed/picsur:allinone
  ```

  ⚠️ **安全前提**：挂 `docker.sock` 等于把宿主 docker 的 root 权限交给面板，任何管理员都能借此起特权容器。
  只应给完全信任管理员的单机自部署。关闭 = 去掉挂载与该变量（检测功能仍可用）。

- **它怎么升级**：拉取新镜像 → 用原配置建替换容器 → 旧容器改名并停止 → 新容器用回原名启动 →
  在新容器内探测 `/api/info` → 成功后删除旧容器；**探测失败会回滚**（删新容器、原名重启旧容器），
  并把失败原因写进「关于」页。并发升级会被拒绝（409）。

## 6. 凭据轮换

`PICSUR_ADMIN_PASSWORD` 与 `PICSUR_JWT_SECRET` 的轮换有**三个反直觉的坑**（改环境变量不等于改数据库里的值；
`docker compose` 优先用 shell 环境变量而不是 `.env`）。完整步骤、验证口径与坑的说明见
[`build-and-deploy.md` §11](../.trellis/spec/picsur-backend/backend/build-and-deploy.md)。

要点：轮换后必须比对 `.env` / 容器 `printenv` / 数据库三处的 `sha256` 一致，并跑一遍回归脚本。

## 7. 自检与排障

```bash
bash support/regression-image-api.sh http://localhost:8080 "<admin口令>"                                                                               # 34 项：上传/取回/7格式/删除语义/像素上限
docker exec -w /picsur/backend picsur node -e "const s=require('sharp');console.log(!!s.format.jxl?.output?.buffer, !!s.format.jp2?.output?.buffer)" # 期望 true true
bash support/audit-prod.sh                                                                                                                           # 后端/共享口径必须 0；浏览器侧已知告警只提示
pnpm audit --prod --registry https://registry.npmjs.org/                                                                                             # 原始命令（含浏览器侧，当前非 0，见下）
```

常见坑：

| 现象                                   | 原因 / 处理                                                            |
| -------------------------------------- | ---------------------------------------------------------------------- |
| 宿主跑起来 JXL/JP2 报错                | 宿主预编译 `sharp` 没这些解码器，**在容器里验**                        |
| 前端 rebuild 后页面卡 Loading          | `@nestjs/serve-static` 缓存了旧目录，**重启后端**                      |
| `/i/<id>`（无扩展名）返回 404 + 占位图 | 该图没有保留原图（有原图才 200），见 API 契约 §3.4                     |
| 日志里出现明文密钥                     | 你开了 `PICSUR_VERBOSE`，关掉它                                        |
| `pnpm audit` 报 endpoint 不存在        | 本机默认源没有 audit 端点，加 `--registry https://registry.npmjs.org/` |

## 8. 规范与流程

- 提交必须带任务锚点 `[task:<任务目录名>]`（见 `AGENTS.md`）；默认 push 到 `origin`。
- 代码规范与环境契约：`.trellis/spec/picsur-backend/backend/`（构建部署、API 契约、质量准则）。
- 任务与决策留痕：`.trellis/tasks/`（含归档）、`.trellis/workspace/`（会话记录）。
