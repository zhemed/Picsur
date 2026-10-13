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
| libvips | 源码编译 **8.18.7**（sharp 0.35 的硬要求；HEIF/JXL/JP2 编解码只有这层有） |
| 生产依赖 stage | `SHARP_FORCE_GLOBAL_LIBVIPS=1` + `python3/build-base`，**并且必须显式跑一次 sharp 源码构建**（见 §8.3 第 5 条） |
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
| `PICSUR_TELEMETRY` | — | `true` | **纯装饰**：只影响启动日志里的一行提示，不控制是否出网 |

**遥测为什么出不了网（2026-10-13 起）**：`ReportUrl` 在 `config.static.ts` 里是**空字符串**
（编译期常量，运行期改不了），`UsageService.execute()` 两道守卫：

```ts
if (!(await this.usageConfig.getMetricsEnabled())) return;   // ① DB 首选项（现在已纯装饰）
if (!(await this.usageConfig.getMetricsUrl())) return;       // ② 端点为空 → 直接跳过（真正的断链）
```

②是为了「将来有人把 URL 改回某个地址、却忘了重置首选项」这种情形留的兜底。
要接**自己的**统计后端，只需把 `ReportUrl` 改成自己的 URL（并让首选项为 true）。

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
  `curl /api/info` 200（`version` 与根 `package.json` 一致，当前 `"0.6.0"`）→ 上传/取回/删除通过 → `docker compose restart picsur` 后
  数据仍在、服务自动恢复。
- **Base**：本机开发形态 —— Postgres 用 `support/dev.docker-compose.yml`，后端 `node backend/dist/main.js`。
  注意该 compose **没有 healthcheck**，就绪判断要用 `docker exec <c> pg_isready -U picsur -d picsur`。
- **Bad**：① 在宿主 Node 22 上 `pnpm install`；② 直接 `FROM` 上游 stage1 镜像；
  ③ 把 Dockerfile 放进 `support/`（会被 `.dockerignore` 的 `support` 一行排除出构建上下文，改放仓库根目录）；
  ④ 以为 `PICSUR_TELEMETRY=false` 关掉了遥测（它只影响一行日志；真正的断链是 `ReportUrl` 为空）。

---

## 6. Tests Required（验收断言点）

| 场景 | 命令 | 断言 |
|---|---|---|
| 构建 | 三包 `pnpm --filter <pkg> build` | `shared/dist/index.js`、`backend/dist/main.js`、`frontend/dist/index.html` 存在；exit 0 |
| 服务 | `curl -s -o /dev/null -w '%{http_code}' localhost:8080/api/info` | `200`，且 body 里 `production:true` |
| 迁移 | `docker exec picsur_postgres psql -U picsur -d picsur -tAc "select count(*) from migrations;"` | `7`（v0.5.x 起就固定的 migration 条数，与版本号无关），且 `e_user_backend` 里有 `admin`/`guest` |
| 上传 | `POST /api/image/upload`（multipart 字段 `file`） | `201`，返回 `data.id`（UUID） |
| 取回 | `GET /i/<id>.png` | `200` + `image/png`；与原始图片**像素一致**（字节不保证一致） |
| 转码 | `GET /i/<id>.{qoi,webp,avif,jxl,jp2,heif}` | 全部 `200`（证明镜像里的自编译 libvips **并且** sharp 是源码构建的） |
| SPA 深链 | `curl -o /dev/null -w '%{http_code} %{content_type}' localhost:8080/some/spa/route` | `200 text/html` —— `@nestjs/serve-static` ≥11 的 `fallthrough` 回归只有这条能抓到 |
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

---

## 8. 依赖版本契约（2026-10-13 安全升级后）

### 8.1 版本底线（低于这些会重新引入已知漏洞，或直接跑不起来）

| 包 | 契约版本 | 为什么不能低 |
|---|---|---|
| Node | **20 用于装依赖/构建**；运行期不强制 | 安装：≥22.16 时 `qoi-img`/`bmp-img`/`posix.js` 编译失败。运行：N-API 产物在 v22 可正常加载（见 §7.1） |
| pnpm | **9.6.0**（corepack 固定） | 与 lockfileVersion 9 对齐 |
| `@nestjs/*` | **^12** | Nest 11 内嵌 `@fastify/middie@9.0.3`，**修不掉那条 critical**（需 ≥9.3.2；Nest 12 = 9.3.5） |
| `fastify` | **^5** | Fastify 4 线上没有 `@fastify/reply-from`/`static` 的修复版 |
| `@fastify/static` | **≥10.1.2** | 低于它有路由守卫绕过/路径穿越 |
| `typeorm` | **^0.3.31** | <0.3.26 有 SQL 注入；不上 1.x（跨大版本） |
| `sharp` | **^0.35.5** | 继承的 libvips CVE |
| **libvips（镜像内自编译）** | **≥8.18.7** | sharp 0.35 的 `config.libvips` 硬要求；低于它镜像构建会在 `pnpm install --prod` 阶段失败 |
| `file-type`（**我们自己的直接依赖**） | **^21.3.4，不能用 22** | `file-type@22` 的 `engines` 是 `node >= 22`。⚠️ 注意：`@nestjs/common@12.1.3` 自己依赖 `file-type@22.1.1`（Nest 的 `FileTypeValidator` 用 `import()` 懒加载，**本项目未启用该功能**）——它确实在生产树里，但不会被加载 |
| `zod` | ^3（暂不动） | v4 是破坏性升级，属 T6 |

### 8.2 `pnpm.overrides` 策略（根 `package.json`）

- **只允许同一大版本内的补丁线**，禁止跨大版本顶（如把 `path-to-regexp@0.x` 顶到 8.x）。
- **优先用「版本区间限定」** `"pkg@<受影响区间>": "<修复版本>"`，避免误伤 devDeps 里的旧大版本
  （裸 `minimatch: ^9` 会把 eslint 的 minimatch@3 顶掉，直接搞坏构建链）。
- 每个 override 落地前必须：`pnpm install` + 三包构建 + 冒烟；不过就撤掉并记入残留说明。
- 当前清单与逐条理由见任务 `10-13-dep-security-upgrade` 的 `research/audit-after.md`。
- **已批准的跨大版本例外（就一条）**：`node-gyp: ^11`（10→11）。它一次带走 `tar` / `glob` / `minimatch` /
  `brace-expansion` / `ip-address` / `http-cache-semantics` 一大片**编译链**告警；三个原生模块
  （`qoi-img` / `bmp-img` / `posix.js`）在容器里实测可编译、可加载。
  **不要**改成「只顶 `tar`」——那会造出「node-gyp@10 + tar 7.x」的混搭，风险更高。
  这是有意为之的例外，不是规则被破坏。

### 8.3 升级时最容易踩的五个坑（都是实测踩过的）

1. **`@nestjs/serve-static` ≥11 的 SPA fallback**：不设 `serveStaticOptions.fallthrough: true` 时，
   未匹配路由返回 **JSON 404** 而不是 `index.html` —— `/api/*` 全绿也发现不了，只有前端深链会炸。
   冒烟必须包含 `curl -o /dev/null -w '%{http_code} %{content_type}' localhost:8080/some/spa/route`，期望 `200 text/html`。
2. **`@nestjs/passport` ≥11 的 verify 回调**：mixin 自己 `super(...args, callback)` 并驱动 `this.validate()`，
   Strategy 构造函数里**不要再传第三个回调**（运行期重复）。
3. **`@fastify/multipart` ≥10 → `@fastify/busboy@3.2.3` 的类型增补有缺陷**：它从 `'node:stream'` 引入 `Readable`
   却 `declare module 'stream'`（裸名），NodeNext 下把裸 `stream` 的 `Readable` 压成只有 `'limit'` 一个重载。
   需要时用 `as NodeJS.ReadableStream` 拓宽（纯类型补丁，运行时无变化）。
4. **宿主环境不支持 JXL/JP2 编码**：sharp 的**预编译** libvips 没有这两个编码器，`/i/<id>.jxl|.jp2` 在宿主
   会 500（`jxlsave_buffer not found` / `JP2 output requires OpenJPEG`）。**只有自编译 libvips 才有**，
   所以格式验证必须在**容器里**做，不能在宿主做。

5. ⚠️ **sharp ≥0.33 默认不会用你的自编译 libvips**（2026-10-13 实际踩到，镜像里 JXL/JP2 全 500）：
   - sharp 的 `install` 只装预编译 `@img/sharp-*`（自带一份精简 libvips，**不含 JXL/JP2**）；
   - **`SHARP_FORCE_GLOBAL_LIBVIPS=1 pnpm install` 已经不起作用** —— 0.35 的 `install/check` 不再读这个变量；
   - 必须**显式跑一次源码构建**：
     ```dockerfile
     RUN cd /picsur/backend/node_modules/sharp \
      && SHARP_FORCE_GLOBAL_LIBVIPS=1 NODE_PATH=/usr/local/lib/node_modules node install/build.js
     ```
     （`node-addon-api` / `node-gyp` 要在 NODE_PATH 里能解析，sharp 自己的 node_modules 是空的）
   - **验证方法**（别只看镜像能起来）：
     ```bash
     docker exec -w /picsur/backend picsur node -e \
       "const s=require('sharp');console.log(!!s.format.jp2?.output?.buffer, !!s.format.jxl?.output?.buffer)"
     # 期望 true true；false false 说明用的是预编译 libvips
     ```
   - 症状特征：容器里 `vips -l | grep jxlsave` **有**（CLI 用的是自编译 libvips），但 sharp 进程里没有
     —— 两个进程用的是不同的 libvips。

### 8.4 残留风险（本任务明确未覆盖，别当成已解决）
- **前端 Angular 18 的浏览器端告警**：Angular 的运行时包（`@angular/core|common|router` 等）被放在
  `frontend` 的 `devDependencies` 里，因此 `pnpm audit --prod` **看不见**它们，但它们**确实会打进浏览器产物**。
  这部分（XSS / XSRF 类）**未修**，归属 **T6（Angular 大版本升级）**。
- **全量口径**（含 devDeps）升级后仍有 critical 6 / high 92 / moderate 81 / low 16，几乎全在前端构建链
  （Angular CLI / webpack / eslint / pacote 等）。
- `zod` 仍是 v3；升 v4 属破坏性变更，需全量回归，暂不动。
- `pnpm audit` 只反映「已知 advisory 的命中情况」，**不等于**「没有漏洞」。

---

## 9. 仓库来源与发布口径（2026-10-13 起生效）

| 项 | 约定 |
|---|---|
| 仓库 | `https://github.com/zhemed/picsur`，**非 fork**（原 fork 已改名 `zhemed/Picsur-fork-archive` 留档） |
| 上游关系 | **无**：不设 `upstream` remote，不依赖上游镜像 / 二进制 / 服务。上游代码只作为历史来源 |
| 遥测出网 | **已断链**：`ReportUrl` 编译期为空（`backend/src/config/config.static.ts`），`UsageService.execute()` 见端点为空即跳过。`enable_telemetry` 首选项与 `PICSUR_TELEMETRY` 现在都**不控制**出网；要接自己的统计后端才需要改 `ReportUrl` |
| 版本线 | 自有版本线，从 **`0.6.0`** 起；四个 `package.json` 同步，`/api/info` 与前端页脚都读它 |
| 许可 | AGPL-3.0（`LICENSE` 不动）。README 保留上游出处声明 —— 这是**合规声明**，不是依赖 |
| 发布 | 提交默认 push 到 `origin`（见 `AGENTS.md`）；镜像 tag 自定，不推上游 registry |
| 允许出现上游字样的位置 | 仅 `LICENSE`、README 的出处声明、`.trellis/**` 历史记录；**其余一律清空** |

> 检查命令（用 `git grep` 跟着 `.gitignore` 走，避免扫到 `.run/` 里的历史产物造成假阳性；
> 白名单之外应为空）：
> ```bash
> git grep -ni "picsur\.org\|caramelfur\|discord\.gg" -- . \
>   ':!LICENSE' ':!README.md' ':!.trellis'
> ```
