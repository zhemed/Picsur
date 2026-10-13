# 构建与部署契约（Build & Deploy）

> 来源：任务 `10-13-handover-baseline`（2026-10-13）实测。所有命令都在本机 `/root/picsur` 验证过。
> 这是**可执行契约**，不是建议：违反其中任一条会直接失败或引入漏洞。

---

## 1. Scope / Trigger

- Trigger：任何要「装依赖 / 构建 / 起服务 / 出镜像 / 改部署」的改动。
- 原因：本项目的工具链有一处**硬性版本约束**（Node 20）、一处**上游构建缺陷**、
  以及**不能依赖上游私有镜像**的镜像约束。不按契约做会直接卡死或把密钥打进镜像。

---

## 2. Signatures（命令契约）

```bash
# 依赖安装（必须 Node 20；用仓库内 corepack 固定 pnpm 9.6.0）
export PATH="/root/picsur/.run/node20/bin:$PATH"     # 本机 Node 20 位置（gitignored）
corepack enable && corepack prepare pnpm@9.6.0 --activate
pnpm install --frozen-lockfile

# 三包构建（顺序不可换：backend / frontend 直接 import picsur-shared/dist/*）
pnpm --filter picsur-shared   build     # -> shared/dist/index.js
pnpm --filter picsur-backend  build     # -> backend/dist/main.js
pnpm --filter picsur-frontend build     # -> frontend/dist/index.html

# 本机开发形态（生产模式起后端，前端由后端托管）
set -a; . ./.env; set +a
node backend/dist/main.js               # 8080

# 常驻部署（仓库根目录，自建镜像）
docker compose up -d --build
docker compose ps
docker compose restart picsur           # 验证重启恢复
```

**镜像契约**：`Dockerfile`（仓库根目录）必须满足

| 约束 | 值 / 原因 |
|---|---|
| JS 构建 stage 基础镜像 | `node:20`（**不能 `-slim`**：`qoi-img`/`bmp-img`/`posix.js` 需 node-gyp 编译，slim 无 python3/gcc） |
| pnpm | 固定 `9.6.0`（与根 `package.json` 的 `packageManager` 一致） |
| libvips | 源码编译 8.16（HEIF/JXL/JP2 编解码只有这层有） |
| 生产依赖 stage | `SHARP_FORCE_GLOBAL_LIBVIPS=1` + `python3/build-base`，在目标平台重新编译 sharp |
| **禁止** | `FROM ghcr.io/caramelfur/picsur-alpha-stage1:*`（上游私有中间镜像，随时可能消失） |
| 构建产物 | 只拷贝 `{frontend,backend,shared}/{dist,package.json}` + 锁文件 + `branding` |
| 运行时 | `PICSUR_PRODUCTION=true`（TypeORM 不 synchronize，只跑 migrations） |

---

## 3. Contracts（环境变量与部署契约）

### 3.1 环境变量（前缀 `PICSUR_`，见 `backend/src/config/config.static.ts`）

| Key | 必填 | 默认 | 说明 |
|---|:--:|---|---|
| `PICSUR_DB_HOST/PORT/USERNAME/PASSWORD/DATABASE` | ✅(生产) | `localhost` / `5432` / `picsur`×3 | compose 内用服务名 `picsur_postgres` |
| `PICSUR_HOST` / `PICSUR_PORT` | — | `0.0.0.0` / `8080` | — |
| `PICSUR_ADMIN_PASSWORD` | ✅ | — | 账号名固定 `admin`，这是初始口令 |
| `PICSUR_JWT_SECRET` | ✅(生产) | 随机 | 不固定会导致每次重启登录态失效 |
| `PICSUR_STATIC_FRONTEND_ROOT` | 镜像内 | `/picsur/frontend/dist` | 前端产物目录 |
| `PICSUR_PRODUCTION` | ✅(生产) | `false` | **不设 = TypeORM `synchronize:true`，会直改 schema** |
| `PICSUR_MAX_FILE_SIZE` | — | `128000000` | 上传字节上限 |
| `PICSUR_VERBOSE` | ❌ 不要开 | `false` | **开了会把 JWT secret 与 DB 口令明文写进日志** |
| `PICSUR_TELEMETRY` | — | `true` | ⚠️ **只影响一行启动日志，关不掉出网遥测**（真开关是系统首选项 `enable_telemetry`） |

**真实遥测开关**（默认 `true`，会定时出网到已停维护的 `metrics.picsur.org`）：

```bash
curl -X POST localhost:8080/api/pref/sys/enable_telemetry \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"value":false}'
```

### 3.2 常驻部署契约

- `docker-compose.yml` 在**仓库根目录**：`.env` 才能被 compose 自动加载（compose 读的是 compose 文件所在目录的 `.env`）。
- 口令类变量用 `${VAR:?}` 守卫：缺失时 compose 直接报错，不允许起出默认口令的实例。
- `restart: unless-stopped`；数据卷 `picsur-data`（Postgres）。
- `.env` 必须在 `.gitignore` 与 `.dockerignore` 里**同时**排除（后者决定密钥会不会进镜像层）。

---

## 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| Node ≥ 22.16 跑 `pnpm install` | ❌ 失败：`qoi-img` 等 C++ 编译报 `node_api_basic_finalize` 签名错。必须 Node 20 |
| 用全局 pnpm 12 装依赖 | ❌ 锁文件 v9 与工具链不匹配；用 corepack 固定 9.6.0 |
| `frontend/custom-webpack.config.js` 保持 `.js` + ESM | ❌ Node ≥20.19 下 `require(esm)` 成功返回命名空间 → webpack `unknown property 'default'`。必须是 `.cjs` + `module.exports` |
| `PICSUR_PRODUCTION` 未设就跑生产 | ❌ TypeORM `synchronize:true` 直改 schema |
| `PICSUR_VERBOSE=true` | ⚠️ JWT secret / DB 口令明文入日志 |
| compose 缺 `PICSUR_ADMIN_PASSWORD` | ❌ compose 启动前直接报错（by design） |
| `.env` 未进 `.dockerignore` | ❌ 密钥进入镜像层（`docker history` 可捞） |
| 请求 `/i/<uuid>`（不带扩展名） | 200 + 品牌占位图 `notfound.png`（**不是原图，也不是 index.html**） |
| 请求不存在的 `/i/<uuid>`（无扩展名） | 400 JSON 错误 |
| 删除后再取 `/i/<uuid>.<ext>` | 200 + 占位图 + `Cache-Control: max-age=2592000`（状态码语义可疑，见改造清单） |

---

## 5. Good / Base / Bad Cases

- **Good**：`docker compose up -d --build` → `docker compose ps` 两个容器 Up →
  `curl /api/info` 200（`version:"0.5.7"`）→ 上传/取回/删除通过 → `docker compose restart picsur` 后
  数据仍在、服务自动恢复。
- **Base**：本机开发形态 —— Postgres 用 `support/dev.docker-compose.yml`，后端 `node backend/dist/main.js`。
  注意该 compose **没有 healthcheck**，就绪判断要用 `docker exec <c> pg_isready -U picsur -d picsur`。
- **Bad**：① 在宿主 Node 22 上 `pnpm install`；② 直接 `FROM` 上游 stage1 镜像；
  ③ 把 Dockerfile 放进 `support/`（会被 `.dockerignore` 的 `support` 一行排除出构建上下文，改放仓库根目录）；
  ④ 用 `PICSUR_TELEMETRY=false` 当作关了遥测。

---

## 6. Tests Required（验收断言点）

| 场景 | 命令 | 断言 |
|---|---|---|
| 构建 | 三包 `pnpm --filter <pkg> build` | `shared/dist/index.js`、`backend/dist/main.js`、`frontend/dist/index.html` 存在；exit 0 |
| 服务 | `curl -s -o /dev/null -w '%{http_code}' localhost:8080/api/info` | `200`，且 body 里 `production:true` |
| 迁移 | `docker exec picsur_postgres psql -U picsur -d picsur -tAc "select count(*) from migrations;"` | `7`（v0.5.7 基线），且 `e_user_backend` 里有 `admin`/`guest` |
| 上传 | `POST /api/image/upload`（multipart 字段 `file`） | `201`，返回 `data.id`（UUID） |
| 取回 | `GET /i/<id>.png` | `200` + `image/png`；与原始图片**像素一致**（字节不保证一致） |
| 转码 | `GET /i/<id>.{qoi,webp,avif,jxl,jp2,heif}` | 全部 `200`（证明镜像里的自编译 libvips 生效） |
| 删除 | `POST /api/image/delete` `{"ids":[...]}` | `201`，且三张表 `e_image_backend`/`e_image_derivative_backend`/`e_image_file_backend` 计数归零 |
| 持久化 | `docker compose restart picsur` 后再取原图 | `200` 且内容一致 |
| 密钥 | `git grep` 扫跟踪范围 | 无真实口令/secret；`.env`、`.run/` 不在 `git status` 视野 |

---

## 7. Wrong vs Correct

### 7.1 本机没有 Node 20 时

```bash
# Wrong —— 直接用宿主 Node 22 装依赖，43s 后编译失败
pnpm install

# Correct —— 下载官方 Node 20 二进制到 gitignored 目录，只在该 shell 生效
cd /root/picsur/.run && curl -sSL -O https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz
mkdir -p node20 && tar -xJf node-v20.20.2-linux-x64.tar.xz -C node20 --strip-components=1
export PATH="/root/picsur/.run/node20/bin:$PATH"
```

> 运行期不需要 Node 20：原生模块是 N-API，v20 编译的产物在 v22 正常加载（实测）。

### 7.2 停服务

```bash
# Wrong —— 会连当前 shell 一起杀掉（命令行含同样字符串）
pkill -f "node backend/dist/main.js"

# Correct
pkill -x node          # 或先 pgrep 拿 PID 再 kill <pid>
```

### 7.3 加环境变量

```bash
# Wrong —— 只更新了 compose，忘了 .env.example 与文档
#         下次别人部署时变量缺失，compose 直接报错

# Correct —— 三处同步：.env.example（占位值）、docker-compose.yml（默认值/守卫）、
#           本 spec 的第 3.1 节（契约表）
```
