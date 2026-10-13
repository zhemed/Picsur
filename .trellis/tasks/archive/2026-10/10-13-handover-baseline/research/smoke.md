# Picsur 本地基线冒烟记录（阶段 0–4）

> 本文件由 `trellis-implement` 子代理在任务 `10-13-handover-baseline` 的阶段 0–4 执行时产出。
> **所有口令 / JWT / delete_key 一律 `REDACTED`**；真实值只在 gitignored 的 `/root/picsur/.env`。
> 执行时间：2026-10-13 03:44–03:53 UTC（本机）。

---

## 0. 结论速览

| 阶段 | 结果 | 说明 |
|---|---|---|
| 0 环境准备 | ✅ | corepack + pnpm 9.6.0；`.gitignore` 追加 `.env` `.run/` `*.log` |
| 1 依赖安装 | ⚠️→✅ | **Node 22 装不上**（3 个原生模块编译失败）；换 **Node 20.20.2** 后 6.9s 全绿 |
| 2 三包构建 | ⚠️→✅ | shared 1.7s / backend 3.2s / frontend 19.0s；需 1 处最小修复（见 2.4） |
| 3 本地实例 | ✅ | postgres:17-alpine + `node backend/dist/main.js`（**Node 22 可用**），migration 7 条全过 |
| 4 冒烟 5 步 | ✅ | 全部通过；删除后 URL 仍 200 是**品牌占位图设计**，非 bug（见 4.6） |
| 5–7 | — | 按分工由 Lead 处理，本次未执行 |

**两个必须记住的坑**：

1. **Node 22 无法 `pnpm install`**：`qoi-img@2.2.0` / `bmp-img@1.3.0` / `posix.js@0.1.2` 用 node-gyp 源码编译，
   Node ≥22.16 的 `node_api_basic_finalize` 签名变更导致 C++ 编译失败。`.nvmrc` 的 `v20` 不是可选项。
2. **`version` 返回 `0.0.0`**：`HostConfigService.getVersion()` 读的是 `npm_package_version`，
   裸跑 `node dist/main.js` 时该变量不存在 → 落到默认值。见 4.1。

---

## 1. 环境（阶段 0）

```
$ corepack enable && corepack prepare pnpm@9.6.0 --activate
$ corepack pnpm -v
9.6.0                      # 全局 pnpm 是 12.9.1，corepack shim 后仓库内固定 9.6.0
$ node -v                  # /usr/bin/node（宿主）
v22.23.2
$ docker --version && docker compose version
Docker version 29.7.2, build a7dcaa6
Docker Compose version v5.4.0
$ ss -lntp | grep -E ':(8080|5432)\b'
（空）                      # 两端口均空闲；halodb 容器的 5432 只在容器网络内，不占宿主
```

`.gitignore` 追加（已用 `git check-ignore -v` 验证三条生效）：

```
# Local runtime (never commit)
.env          -> .gitignore:18
.run/         -> .gitignore:19
*.log         -> .gitignore:20
```

### 1.1 Node 版本结论（重要接手知识）

| 用途 | Node 版本 | 结论 |
|---|---|---|
| `pnpm install`（原生模块编译） | **必须 v20** | v22 下 `qoi-img` 编译失败，install 直接 exit 1 |
| 三包 `tsc` / `ng build` | v20 验证通过 | 未单独用 v22 试构建 |
| 运行 `node backend/dist/main.js` | **v22 可用** | 原生模块是 N-API，v20 编译的产物在 v22 正常加载（见 3.3） |

装法（本次实际做法，无 nvm 依赖）：下载官方二进制到 gitignored 目录

```
$ cd /root/picsur/.run && curl -sSL -O https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz
$ mkdir -p node20 && tar -xJf node-v20.20.2-linux-x64.tar.xz -C node20 --strip-components=1
$ export PATH="/root/picsur/.run/node20/bin:$PATH"   # 之后 corepack/pnpm/tsc 全走 v20
```

> 该目录在 `.run/`（已 gitignore），不会入库；本机也没有 nvm，`/usr/bin/node` 仍是 v22。

---

## 2. 依赖安装（阶段 1）

### 2.1 Node 22 的失败原文（保留证据）

命令：`pnpm install`（corepack 固定 9.6.0），43s 后失败于原生模块编译：

```
.../qoi-img@2.2.0/node_modules/qoi-img install: ../lib/qoi.cpp:213:47: error:
  invalid conversion from 'void (*)(const napi_env__*, void*, void*)'
  to 'node_api_basic_finalize' {aka 'void (*)(napi_env__*, void*, void*)'} [-fpermissive]
.../qoi-img@2.2.0/node_modules/qoi-img install: ../lib/qoi.cpp:259:47: error: (同上)
.../qoi-img@2.2.0/node_modules/qoi-img install: gyp ERR! stack Error: `make` failed with exit code: 2
.../qoi-img@2.2.0/node_modules/qoi-img install: gyp ERR! node -v v22.23.2
ELIFECYCLE  Command failed with exit code 1.
```

触发编译脚本的模块（4 个）：`posix.js@0.1.2`、`qoi-img@2.2.0`、`sharp@0.33.5`（跑 `node install/check`）、
`bmp-img@1.3.0`。pnpm 在 `qoi-img` 首个失败即中止，故 `bmp-img` / `posix.js` 在 v22 下未跑到。

### 2.2 Node 20 下成功

```
$ export PATH="/root/picsur/.run/node20/bin:$PATH"
$ pnpm install --reporter=append-only
Packages: +1166
.../qoi-img@2.2.0/... install: gyp info ok
.../bmp-img@1.3.0/... install: gyp info ok
.../posix.js@0.1.2/... install: gyp info ok
Done in 6.8s        # real 0m6.921s
```

### 2.3 锁文件与验证

```
$ git status --short pnpm-lock.yaml
（空 —— lockfile 零改动）
$ git diff --stat pnpm-lock.yaml
（空）
```

**AC1 达成**：`Lockfile is up to date, resolution step is skipped`，1166 个包按 lockfile v9 精确安装，无破坏性改动。

`sharp@0.33.5` 用的是**预编译 libvips**，不需要源码编译：

```
$ node -e "const s=require('sharp'); console.log(s.versions.vips)"
8.15.3
```

（`sharp` 的 `node install/check` 只是校验，预编译二进制来自 npm registry，Node 20/22 都能加载。）

---

## 3. 三包构建（阶段 2）

### 3.1 产物与耗时

| 包 | 命令 | 产物 | 耗时 | 内存 |
|---|---|---|---|---|
| shared | `pnpm --filter picsur-shared build` | `shared/dist/index.js` (44 B) | **1.7s** | — |
| backend | `pnpm --filter picsur-backend build` | `backend/dist/main.js` (1997 B) | **3.2s** | — |
| frontend | `pnpm --filter picsur-frontend build` | `frontend/dist/index.html` (64598 B) | **19.0s** | 未触发 OOM |

```
$ ls -la shared/dist/index.js backend/dist/main.js frontend/dist/index.html
-rw-r--r-- 1 root root  1997 ... backend/dist/main.js
-rw-r--r-- 1 root root 64598 ... frontend/dist/index.html
-rw-r--r-- 1 root root    44 ... shared/dist/index.js
```

> 顺序必须 shared → backend → frontend：后两者 `import 'picsur-shared/dist/*'`。
> 内存：本机 7.8G，Angular 用 `NODE_OPTIONS=--max-old-space-size=3072` 未 OOM，构建峰值平稳。
> **注意**：`.run/build-node20.sh` 里 `NODE_OPTIONS` 会被环境已有的 `--max-old-space-size=4096` 覆盖，
> 实际生效值是 4096 —— 仍无 OOM，说明 7.8G 内存够用。

### 3.2 frontend 构建告警（不阻塞）

```
Initial total 1.13 MB (Estimated transfer size 237.56 kB)
Warning: bundle initial exceeded maximum budget. Budget 1.05 MB was not met by 81.39 kB
```

budget 超限只是警告，exit 0。后续若要消警，可调 `frontend/angular.json` 的 budgets。

### 3.3 构建被阻塞时的最小修复（逐条列出）

React 到 implement.md 2.4「只做最小修复」，本次 **2 个文件**：

| # | 文件 | 改动 | 为什么必须改 | 是否改业务逻辑 |
|---|---|---|---|---|
| 1 | `frontend/custom-webpack.config.js` → `.cjs`（`git mv`） | 仅改扩展名 | 见下方根因 | 否 |
| 2 | `frontend/custom-webpack.config.cjs` | `import webpack from 'webpack'` + `export default {...}` → `const webpack = require('webpack')` + `module.exports = {...}` | `.cjs` 强制 CommonJS，ESM 语法会报 `Cannot use import statement outside a module` | 否（语义等价） |
| 3 | `frontend/angular.json` | `customWebpackConfig.path: "./custom-webpack.config.js"` → `".cjs"` | 跟随改名 | 否 |

**根因（值得记入 spec）**：`@angular-builders/custom-webpack@18.0.0` 经 `@angular-builders/common@2.0.0`
的 `loadModule()` 加载配置，`default` 分支逻辑是：

```js
try { return require(modulePath); }                     // ← 先把 require 的成功当作最终结果
catch (e) { if (e.code === 'ERR_REQUIRE_ESM') { ...loadEsmModule(path).default } }
```

- Node 18：`require()` 一个 ESM `.js` 抛 `ERR_REQUIRE_ESM` → 走 fallback → 返回 `.default` → **正常**。
  上游 CI/开发机当年就是这个路径，所以上游没暴露该问题。
- Node 20.19+ / 22：`require(esm)` 已被支持（supports-require-esm），`require()` **成功**返回 ESM 命名空间对象
  `{__esModule, default: {...}}` → webpack 拿到带 `default` 键的非法配置 → `unknown property 'default'`。

实测证据：

```
$ node -e "import('./custom-webpack.config.js').then(m=>console.log(Object.keys(m)))"
[ 'default' ]                       # ESM 命名空间，真正的配置在 m.default 里

$ /usr/bin/node -e "require('/root/picsur/frontend/custom-webpack.config.js')"
keys: [ '__esModule', 'default' ]   # Node 22 的 require(esm) 成功返回命名空间 -> 触发 bug

$ node -e "require('./probe-tmp.cjs')"   # 改 .cjs 后
keys: plugins,module | plugins is array? true   # 正确形态
```

**结论**：这是 **Node 版本升级暴露的上游兼容性缺陷**，不是本机环境问题。
`frontend/package.json` 有 `"type": "module"`，所以 `.js` 被当 ESM；`.cjs` 是显式 CJS，跨 Node 版本行为稳定。
**未采用的替代方案**：删掉 `customWebpackConfig`（会丢失 moment 只打包 en locale 的优化）；改 `"type"`（影响面太大）。

### 3.4 构建阶段的意外发现（未改，仅记录）

仓库工作区里出现了 `.env.example`、`Dockerfile`、`support/own.docker-compose.yml`（untracked），
是**阶段 6 的产物**（按 implement.md 6.1/6.2 描述），非本子代理所为，本报告未触碰它们。

---

## 4. 本地实例 + 冒烟（阶段 3–4）

### 4.1 起数据库与配置

```
$ docker compose -f support/dev.docker-compose.yml up -d
 Container support-devdb-1  Started
$ docker compose -f support/dev.docker-compose.yml ps
NAME              IMAGE               STATUS         PORTS
support-devdb-1   postgres:17-alpine  Up 3 seconds   0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp
$ docker exec support-devdb-1 pg_isready -U picsur -d picsur
/var/run/postgresql:5432 - accepting connections
```

> `support/dev.docker-compose.yml` **没有定义 healthcheck**，所以 `docker compose ps` 不会显示 `(healthy)`；
> 判断就绪要用 `pg_isready`（上面这条），不要等 healthy。

`.env` 写入 `/root/picsur/.env`（`chmod 600`，gitignored）。非密字段：

```
PICSUR_DB_HOST=127.0.0.1     PICSUR_HOST=0.0.0.0        PICSUR_VERBOSE=false
PICSUR_DB_PORT=5432          PICSUR_PORT=8080           PICSUR_PRODUCTION=true
PICSUR_DB_USERNAME=picsur    PICSUR_STATIC_FRONTEND_ROOT=/root/picsur/frontend/dist
PICSUR_DB_PASSWORD=picsur
PICSUR_DB_DATABASE=picsur
PICSUR_ADMIN_PASSWORD=REDACTED   # 32 字符，crypto.randomBytes(24).toString('base64url')
PICSUR_JWT_SECRET=REDACTED       # 64 字符，crypto.randomBytes(48).toString('base64url')
```

> **踩坑**：变量名是 `PICSUR_VERBOSE=true`，**没有** `PICSUR_LOG_LEVEL`
> （`PICSUR_` 前缀见 `backend/src/config/config.static.ts`）。
> **且 verbose 有泄密副作用**：开 verbose 时启动日志会明文打印
> `VERBOSE [JwtConfigService] JWT secret: ...` 和 `VERBOSE [TypeOrmConfigService] DB password: ...`。
> 本次首轮启动确实把 JWT secret 打进了 `.run/backend.log`，已立即关 verbose 重启并清空日志；
> 最终 `.run/backend.log` 中凭据行数为 **0**。**接手时别在共享 verbose 日志里留凭据。**

### 4.2 起后端（生产形态 = 真实 migration 路径）

```
$ cd /root/picsur && mkdir -p .run
$ set -a; . ./.env; set +a
$ nohup /usr/bin/node backend/dist/main.js > .run/backend.log 2>&1 &
```

`PICSUR_PRODUCTION=true` → TypeORM `synchronize: false`、`migrationsRun: true`（`type-orm.config.service.ts`）。

**migration 结果：无失败**。日志中 `error|fail|exception` 匹配数为 0（唯一一条 WARN 是 usage 遥测，见 5.2）。

数据库实查（证明 migration 真的跑了，不是 synchronize 兜的）：

```
$ docker exec support-devdb-1 psql -U picsur -d picsur -c "select count(*) from migrations;"
 7
$ docker exec support-devdb-1 psql -U picsur -d picsur -c "select name from migrations order by id;"
 V030A1661692206479, V032A1662029904716, V040A1662314197741, V040B1662485374471,
 V040C1662535484200, V040D1662728275448, V050A1672154027079
$ docker exec support-devdb-1 psql -U picsur -d picsur -c "\dt"
 e_api_key_backend, e_image_backend, e_image_derivative_backend, e_image_file_backend,
 e_role_backend, e_sys_preference_backend, e_system_state_backend, e_user_backend,
 e_usr_preference_backend, migrations          # 共 10 张表
```

种子数据（`Ensuring user "admin" exists` / `Ensuring user "guest" exists` 生效）：

```
$ psql -c "select username from e_user_backend order by username;"   -> admin, guest
$ psql -c "select name from e_role_backend order by name;"           -> admin, guest, user
```

启动耗时：**约 2 秒**到 `Nest application successfully started` 且 `/api/info` 返回 200。

### 4.3 冒烟 Step 1 — `GET /api/info`

```
$ curl -s -w '\nHTTP_STATUS=%{http_code}\nCONTENT_TYPE=%{content_type}\n' http://localhost:8080/api/info
{"success":true,"statusCode":200,"timestamp":"2026-10-13T03:50:27.146Z","timeMs":14,
 "data":{"production":true,"demo":false,"version":"0.0.0","tracking":{"state":"detailed"}}}
HTTP_STATUS=200
CONTENT_TYPE=application/json; charset=utf-8
```

✅ 200 + JSON。**`version` 为 `0.0.0` 的解释**：
`HostConfigService.getVersion()` = `ParseString(configService.get('npm_package_version'), '0.0.0')`。
裸跑 `node backend/dist/main.js` 没有 npm 注入的环境变量 → 落到默认 `0.0.0`。
真实版本在根 `package.json` 是 `0.5.7`；若需要正确展示，起服务时显式加
`npm_package_version=0.5.7`（或经 `pnpm start:prod` 启动）。**不影响功能，前端页脚同样显示 V0.0.0。**

### 4.4 冒烟 Step 2 — admin 登录

```
# 口令从 .env 读取，不落盘不回显
$ curl -s -w '\nHTTP_STATUS=%{http_code}' -X POST http://localhost:8080/api/user/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"REDACTED"}'
{"success":true,"statusCode":201,"timestamp":"2026-10-13T03:50:34.272Z","timeMs":456,
 "data":{"jwt_token":"<JWT REDACTED>"}}
HTTP_STATUS=201
token_length=188
```

✅ 201 + `jwt_token`（188 字符）。`timeMs: 456` 含 bcrypt 校验（首次较慢属正常）。
`POST /api/user/login` 返回 **201 而非 200**，是 NestJS `@Post` 默认；后续所有 `POST` API 同理。

### 4.5 冒烟 Step 3 — 上传 PNG

本地生成 32×32 PNG（用仓库自带的 sharp，无网络）：

```
$ node -e "require('sharp')({create:{width:32,height:32,channels:3,background:{r:220,g:40,b:90}}}).png().toFile('.run/smoke.png')"
{"format":"png","width":32,"height":32,"channels":3,"premultiplied":false,"size":125}
$ file .run/smoke.png
PNG image data, 32 x 32, 8-bit/color RGB, non-interlaced   (125 字节)
```

上传（**端点是 `/api/image/upload`，不是 `/api/image`**；multipart 字段名 `file`）：

```
$ TOKEN=$(cat .run/token.txt)
$ curl -s -w '\nHTTP_STATUS=%{http_code}' -X POST http://localhost:8080/api/image/upload \
    -H "Authorization: Bearer $TOKEN" -F "file=@.run/smoke.png;type=image/png"
{"success":true,"statusCode":201,"timestamp":"2026-10-13T03:50:39.363Z","timeMs":74,
 "data":{"id":"f3db9c7a-ecec-4bbe-93af-9e0bbc9d7a17",
         "user_id":"308dfa79-0b77-4afc-a9b8-22a19c5019ae",
         "created":"2026-10-13T03:50:39.358Z",
         "file_name":"smoke","expires_at":null,
         "delete_key":"REDACTED"}}
HTTP_STATUS=201
```

✅ 201 + `id`（UUID）。`file_name` 是**上传文件名的去扩展名形式**；`expires_at: null` = 永不过期。
带 `Authorization` 时回调里会附带 `delete_key`（`Permission.ImageDeleteKey` 对 admin 为真）。

### 4.6 冒烟 Step 4 — 取回图片（含格式策略）

URL 形态由 `ImageFullIdPipe` 决定：`/i/<uuid>` = **原图**；`/i/<uuid>.<ext>` = **实时转码**。
四种请求实测：

| 请求 | 状态 | Content-Type | 字节数 | 说明 |
|---|---|---|---|---|
| `/i/<id>` | 200 | `image/png` | 33516 | **不是原图**！`ImageController` 捕获 `FT.NotFound` 后回品牌占位图（512×361），状态码仍是 200 |
| `/i/<id>.png` | 200 | `image/png` | 125 | 与原图**像素一致**（本组恰好字节也一致，但不能当保证，见 `lead-verification.md` §2.2） |
| `/i/<id>.qoi` | 200 | `image/x-qoi` | 43 | 实时转 QOI（QOI 是 Picsur 的默认轻量格式） |
| `/i/<id>.webp` | 200 | `image/webp` | 76 | 实时转 WebP |

字节一致性验证：

```
$ curl -s -o .run/fetch.png "http://localhost:8080/i/$ID.png"
$ sha256sum .run/smoke.png .run/fetch.png
daae5591c507f128d5901133aa87ced5b1e5fa70b0e8ca3e7a54e0ef67973944  .run/smoke.png
daae5591c507f128d5901133aa87ced5b1e5fa70b0e8ca3e7a54e0ef67973944  .run/fetch.png
$ cmp -s .run/smoke.png .run/fetch.png && echo IDENTICAL
IDENTICAL
```

> ⚠️ **这组"字节相同"是巧合，不要当契约**：取回 `.png` 是「QOI 中转后重新编码」的结果。
> Lead 与 check 各自复测都出现字节不同（75 B→96 B、125 B→120 B、188 B→206 B），但**像素逐一相同**。
> 断言请写在**像素**上（见 `lead-verification.md` §2.2）。

> **接手必知**：`/i/<uuid>`（不带扩展名）**拿不到原图** —— 返回的是 512×361 的品牌占位图
> `frontend/dist/assets/branding/messages/notfound.png`（Lead 复验确认与占位图 sha256 相同；
> 注意**不是** `index.html`，SPA fallback 只对非 `/i/` 路径生效）。要拿原图必须 `/i/<uuid>.png`
> （用原始扩展名），或 `/i/<uuid>.<目标格式>` 让后端转码。前端 `ImageService.GetImageURL()` 正是拼 `.<ext>`，
> 所以正常 UI 流程不受影响，但**手工 curl / 写文档时极易踩这个坑**。

前端静态托管同时验证：

```
$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:8080/
200 text/html; charset=UTF-8
$ curl -s http://localhost:8080/ | grep -oE '<title>[^<]*</title>'
<title>Picsur</title>
```

浏览器实测（本机常驻 Chromium，真实渲染）：

```
$ bw open http://localhost:8080/ --wait=3500
HTTP 200   页: http://localhost:8080/upload   标题: Picsur
正文: LOGIN / Please log in / You do not yet have permission to upload / V0.0.0
```

截图见 `.run/shots/01-landing.png`（未登录）与 `.run/shots/02-logged-in.png`（登录后 Upload 页）；
用 `.env` 的 admin 口令在真实表单里登录成功，页面出现 "Login successful" 并跳转 `/upload`。

### 4.7 冒烟 Step 5 — 删除

```
$ curl -s -w '\nHTTP_STATUS=%{http_code}' -X POST http://localhost:8080/api/image/delete \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"ids":["f3db9c7a-ecec-4bbe-93af-9e0bbc9d7a17"]}'
{"success":true,"statusCode":201,"timestamp":"2026-10-13T03:51:10.196Z","timeMs":6,
 "data":{"images":[{"id":"f3db9c7a-ecec-4bbe-93af-9e0bbc9d7a17",
                    "user_id":"308dfa79-0b77-4afc-a9b8-22a19c5019ae",
                    "created":"2026-10-13T03:50:39.358Z","file_name":"smoke","expires_at":null}]}}
HTTP_STATUS=201
```

✅ 201 + 返回被删记录。删除是 `POST /api/image/delete` + body `{"ids":[...]}`（**不是** `DELETE` 方法）。

**删除后复检有个容易误判的现象**：

```
$ curl -o /dev/null -w '%{http_code}\n' "http://localhost:8080/i/<id>.png"
200                     # ← 看起来「没删掉」？
$ curl -s -D - -o .run/after-delete.png "http://localhost:8080/i/<id>.png"
Cache-Control: max-age=2592000
content-type: image/png
content-length: 33516
$ file .run/after-delete.png
PNG image data, 512 x 361, 8-bit/color RGBA
$ sha256sum .run/after-delete.png            # 23995390147dee5c...
$ cmp .run/after-delete.png frontend/dist/assets/branding/messages/notfound.png && echo SAME
SAME
```

**这是设计行为，不是缓存泄漏**：`ImageController.getImage()` 捕获 `FT.NotFound` 后返回品牌占位图，
HTTP 状态仍是 200（`res.type()` + `return message.data`，未改状态码）。
那个 33516 字节的文件与 `frontend/dist/assets/branding/messages/notfound.png` **逐字节相同**，
且 `Cache-Control: max-age=2592000` 是 `/i/*` 路由的全局设置（`app.module.ts` `imageCacheSet`），
意味着**浏览器/CDN 可能把占位图缓存一个月**。

数据库侧确认真删了：

```
$ docker exec support-devdb-1 psql -U picsur -d picsur -tAc "select count(*) from e_image_backend;"
0
$ ... "select count(*) from e_image_derivative_backend;"
0
$ ... "select count(*) from e_image_file_backend;"
0
```

✅ 三张表全部归零，级联删除正常。

### 4.8 冒烟 5 步总表

| # | 操作 | 结果 | 关键字段 |
|---|---|---|---|
| 1 | `GET /api/info` | **200** | `production:true`, `demo:false`, `version:"0.0.0"`(见 4.3) |
| 2 | `POST /api/user/login` | **201** | `jwt_token` 188 字符 |
| 3 | `POST /api/image/upload` | **201** | `id` UUID, `file_name:"smoke"`, `expires_at:null` |
| 4 | `GET /i/<id>.png` | **200** | `image/png`, 125 B, sha256 与原图一致 |
| 4' | `GET /i/<id>.qoi` | **200** | `image/x-qoi`, 43 B（默认转码格式） |
| 4'' | `GET /i/<id>.webp` | **200** | `image/webp`, 76 B |
| 5 | `POST /api/image/delete` | **201** | 返回被删记录；三张表计数归零 |

**AC4 / AC5 达成**。

---

## 5. Node 22 运行期兼容性专项（重要）

阶段 1 被迫用 Node 20 装依赖，那么**运行期能不能用宿主 Node 22**？本次实例**全程用 `/usr/bin/node`（v22.23.2）**跑，
所有原生模块实测可加载：

```
$ /usr/bin/node -e "require.resolve('qoi-img',{paths:['/root/picsur/backend']})" ...
qoi-img    OK QOIDecoder,QOIEncoder,QOIencode,QOIdecode,IsQOI,QOIColorSpace
bmp-img    OK BMPChannels,BMPencode,BMPdecode
posix.js   OK getgid,getuid,setgid,setuid,getegid,geteuid
sharp      OK vips 8.15.3
```

说明：node-gyp 默认用 **N-API**（`node-addon-api`），编译产物是 ABI 稳定的，v20 编译 → v22 加载没问题；
**编译期**才会撞上 v22 头文件签名变更。

**因此本地/镜像的分工建议**：`pnpm install` + 构建用 Node 20，运行期可继续 Node 22（但统一到 20 最省心）。

### 5.1 遗留：遥测 WARN（非阻塞）

启动约 3 秒后日志出现一次（关闭 verbose 后仍会有）：

```
WARN [UsageManagerModule] SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

这是 `UsageManagerModule` 向 `https://metrics.picsur.org`（`config.static.ts` 的 `ReportUrl`）发遥测，
上游站点已停维护、返回 HTML 而非 JSON。**不影响任何功能**；若要消除，设 `PICSUR_TELEMETRY=false`。
注意这属于**出网请求**，接手时若要关闭请一并说明。

---

## 6. 复现清单（从零到冒烟通过）

```bash
cd /root/picsur

# --- 依赖（必须 Node 20）---
export PATH="/root/picsur/.run/node20/bin:$PATH"
corepack enable && corepack prepare pnpm@9.6.0 --activate
pnpm install --reporter=append-only          # 6.8s，lockfile 不变

# --- 构建（顺序不可换）---
pnpm --filter picsur-shared  build            # -> shared/dist/index.js
pnpm --filter picsur-backend build            # -> backend/dist/main.js
NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter picsur-frontend build   # -> frontend/dist/index.html

# --- 数据库 ---
docker compose -f support/dev.docker-compose.yml up -d
docker exec support-devdb-1 pg_isready -U picsur -d picsur   # 无 healthcheck，用这个判就绪

# --- 后端（就地取材 .env；运行期 Node 20 或 22 均可）---
mkdir -p .run
set -a; . ./.env; set +a
nohup node backend/dist/main.js > .run/backend.log 2>&1 &
# 等待： curl -s -o /dev/null -w '%{http_code}' localhost:8080/api/info   -> 200

# --- 冒烟 ---
curl -s localhost:8080/api/info
TOKEN=$(curl -s -X POST localhost:8080/api/user/login -H 'Content-Type: application/json' \
        -d "{\"username\":\"admin\",\"password\":\"$PICSUR_ADMIN_PASSWORD\"}" \
        | sed -E 's/.*"jwt_token":"([^"]+)".*/\1/')
curl -s -X POST localhost:8080/api/image/upload -H "Authorization: Bearer $TOKEN" \
     -F "file=@.run/smoke.png;type=image/png"
curl -sI "localhost:8080/i/<id>.png"        # 原图（不要用不带扩展名的 URL）
curl -s -X POST localhost:8080/api/image/delete -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"ids":["<id>"]}'

# --- 收尾 ---
pkill -x node            # 或 kill <pid>；注意 pkill -f 会匹配到当前 shell 自身
docker compose -f support/dev.docker-compose.yml down      # 保留卷；加 -v 清库
```

> **`pkill` 坑**：`pkill -f "node backend/dist/main.js"` 会连**当前 shell** 一起杀掉
> （bash 命令行里含同样字符串）。本次就中过一次 SIGTERM。用 `pkill -x node` 或先 `pgrep` 拿 PID 再 kill。

---

## 7. 未验证 / 遗留项

| 项 | 状态 | 说明 |
|---|---|---|
| Node 22 下跑 `pnpm install` | ❌ 确认失败 | 见 2.1，硬阻塞，不是配置问题 |
| Node 22 下跑 `tsc` / `ng build` | 未单独验证 | 本次构建全在 Node 20 |
| Docker 镜像内构建（阶段 6） | 未做 | 按分工由 Lead 处理 |
| 上游 `dev` 分支盘点（阶段 5） | 未做 | 按分工由 Lead 处理 |
| `version` 显示 0.0.0 | 未修 | 属功能显示问题，非构建阻塞；修法见 4.3 |
| 删除后 `/i/*` 返回 200 占位图 | 未改 | 设计如此，但**状态码语义可疑 + 被缓存 1 个月**，建议列入改造清单 |
| 遥测出网 WARN | 未改 | 见 5.1 |
| 前端 bundle 超 budget 81 KB | 未改 | 仅警告 |

---

## 8. 本次产生的文件（除本文件外）

| 路径 | 说明 | 是否入库 |
|---|---|---|
| `.env` | 本地运行配置（含随机 admin 口令 / JWT secret，`chmod 600`） | ❌ gitignored |
| `.run/` | 日志、构建脚本、冒烟中间产物、截图、Node 20 运行时 | ❌ gitignored |
| `.run/backend.log` | 后端启动日志（已确认 0 行凭据） | ❌ gitignored |
| `.run/shots/*.png` | 真实渲染截图 | ❌ gitignored |

> 本文件（`research/smoke.md`）**不含任何口令、JWT、delete_key**，可安全入库。
