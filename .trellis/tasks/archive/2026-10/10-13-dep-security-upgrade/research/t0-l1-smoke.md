# T0 阶段 1 + 阶段 2 报告：版本升级与 L1 宿主冒烟

> 范围：`implement.md` 阶段 1（版本升级）+ 阶段 2（L1 宿主迭代）。
> 阶段 0 由 Lead 完成；阶段 3–6 由 Lead 接手。
> 环境：Node **20.20.2**（`/root/picsur/.run/node20/bin`）+ corepack pnpm **9.6.0**。
> 实例：`PICSUR_PORT=8081`（未占用 8080，未动 `picsur` / `picsur_postgres` 容器）。
> 所有口令 / JWT / API key 一律 `REDACTED`。

---

## 1. 版本改动（`backend/package.json`）

`shared/package.json` **未改动**（无 peer 强制：shared 只依赖 `ms` + `zod`）。

### dependencies

| 包 | 旧 | 新 | 落盘实际 |
|---|---|---|---|
| `@fastify/helmet` | `^11.1.1` | `^13.1.2` | 13.1.2 |
| `@fastify/multipart` | `^8.3.0` | `^10.1.3` | 10.1.3 |
| `@fastify/reply-from` | `^10.0.0` | `^12.7.1` | 12.7.1 |
| `@fastify/static` | `^7.0.4` | `^10.1.6` | 10.1.6 |
| `@nestjs/common` | `^10.4.6` | `^12.1.3` | 12.1.3 |
| `@nestjs/config` | `^3.3.0` | `^12.0.1` | 12.0.1 |
| `@nestjs/core` | `^10.4.6` | `^12.1.3` | 12.1.3 |
| `@nestjs/jwt` | `^10.2.0` | `^12.0.3` | 12.0.3 |
| `@nestjs/passport` | `^10.0.3` | `^12.0.0` | 12.0.0 |
| `@nestjs/platform-fastify` | `^10.4.6` | `^12.1.3` | 12.1.3 |
| `@nestjs/schedule` | `^4.1.1` | `^12.0.2` | 12.0.2 |
| `@nestjs/serve-static` | `^4.0.2` | `^12.0.0` | 12.0.0 |
| `@nestjs/throttler` | `^6.2.1` | `^6.7.1` | 6.7.1 |
| `@nestjs/typeorm` | `^10.0.2` | `^12.0.2` | 12.0.2 |
| `fastify` | `^4.28.1` | `^5.12.5` | 5.12.5 |
| `file-type` | `^19.6.0` | `^22.1.1` → **`^21.3.4`**（Lead 收尾纠偏） | 21.3.4 |
| `sharp` | `^0.33.5` | `^0.35.5` | 0.35.5 |
| `typeorm` | `^0.3.20` | `^0.3.31` | 0.3.31 |
| `zod` | `^3.23.8` | **不动** | 3.23.8 |

### devDependencies

| 包 | 旧 | 新 | 落盘实际 |
|---|---|---|---|
| `@nestjs/cli` | `^10.4.5` | `^12.0.8` | 12.0.8 |
| `@nestjs/schematics` | `^10.2.3` | `^12.0.7` | 12.0.7 |
| `@nestjs/testing` | `^10.4.6` | `^12.1.3` | 12.1.3 |

> `@nestjs/testing` 不在指定清单里，但它是 Nest 主版本家族成员，留在 10.x 会与应用内的
> 12.x DI 容器不匹配，故同步到 `^12.1.3`。

### 安装

- `pnpm install --registry=https://registry.npmjs.org` **一次成功**，17.2s。
- **未使用** `--no-strict-peer-dependencies` 等绕过手段。
- 剩余 peer 警告仅 2 条，且都在 **devDeps** 上（`@nestjs/cli@12.0.8` 想要
  `webpack@^5.105.4`，树里是 5.95.0；想要 `ts-loader@^9.5.4`，树里是 9.5.1）。
  这两条不阻塞构建（`nest build` 用 tsc，不用 webpack），保留未动。
- lockfile：`git diff --stat pnpm-lock.yaml` = **1622 insertions / 1213 deletions（2835 行变更）**
  —— 这是**加 overrides 之前**的中间态；阶段 5 补 11 条 override 后最终为 **1909 / 1314（3223 行）**。
  `sha256 before a3c2a70c…` → `after d7f0f381…`。
- ⚠️ 纠偏说明：本报告写于「`file-type` 还是 `^22.1.1`」的阶段。`file-type@22` 的 engines 是 `node >= 22`，
  与我们的 Node 20 冲突，**Lead 收尾时已改回 `^21.3.4`**（21.3.1+ 已修掉对应告警）。

---

## 2. 构建结果

| 包 | 命令 | 结果 | 耗时 |
|---|---|---|---|
| shared | `pnpm --filter picsur-shared build` | ✅ | 1.6s |
| backend | `pnpm --filter picsur-backend build` | ✅（修 4 处后） | 3.0s |
| frontend | `pnpm --filter picsur-frontend build` | ✅ | 18.8s |

> frontend 未在本任务范围，但它依赖 `picsur-shared`，因此顺带构建验证升级没有波及它。
> 仅有一条既有的 bundle 预算告警（1.13 MB / 1.05 MB），与本次升级无关。

---

## 3. 为修编译/运行错误所做的**每一处**代码改动

共 **4 处**（3 处编译 + 1 处运行期回归）。

### 3.1 `backend/src/workers/sharp/universal-sharp.ts`（编译错误）

```diff
-import sharp, { Sharp, SharpOptions } from 'sharp';
+import sharp, { OutputInfo, Sharp, SharpOptions } from 'sharp';
 export interface SharpResult {
   data: Buffer;
-  info: sharp.OutputInfo;
+  info: OutputInfo;
 }
```

- 错误：`TS2503: Cannot find namespace 'sharp'`。
- 原因：`sharp@0.35` 改了类型产物 —— 声明文件是 `dist/index.d.mts`/`index.d.cts`，
  **不再把命名空间和默认导出绑在一起**（旧版 `sharp@0.33` 的 `sharp.OutputInfo` 写法失效）。
- 修法：`OutputInfo` 现在是具名导出的 interface，直接 import。

### 3.2 `backend/src/workers/sharp.wrapper.ts`（编译错误，**根因不在 sharp**）

```diff
-    this.worker.stdout?.on('data', (data) => {
+    // NOTE: we cannot call `.on(...)` on the fork() stdio streams directly.
+    // `@fastify/busboy` (pulled in by `@fastify/multipart` >= 10) ships a broken
+    // module augmentation of the bare `'stream'` module, which collapses the
+    // `Readable` interface down to a single `'limit'` overload. Widening to
+    // `NodeJS.ReadableStream` restores the normal event signatures.
+    const stdout = this.worker.stdout as NodeJS.ReadableStream | null;
+    const stderr = this.worker.stderr as NodeJS.ReadableStream | null;
+
+    stdout?.on('data', (data: Buffer) => {
       this.logger.verbose(`Worker log: ${data}`);
     });
-    this.worker.stderr?.on('data', (data) => {
+    stderr?.on('data', (data: Buffer) => {
       this.logger.warn(`Worker error: ${data}`);
     });
```

- 错误：`TS2345: Argument of type '"data"' is not assignable to parameter of type '"limit"'`
  （两处），外加 `TS7006` implicit any。
- **根因（重点，Lead 阶段 3–5 会遇到同一个坑）**：
  `@fastify/multipart@10` → `@fastify/busboy@3.2.3`，而 busboy 的
  `types/index.d.ts` 第 9 行是：

  ```ts
  import { Readable, Writable } from 'node:stream'
  declare module 'stream' {        // ← 裸模块名
    interface Readable {
      on(event: 'limit', listener: () => void): this;   // ← 只加了这一个重载
      ...
    }
  }
  ```

  它**增补的是裸 `'stream'` 模块，却从 `'node:stream'` 引入 `Readable`**。在
  `moduleResolution: NodeNext` 下 `'stream'` 与 `'node:stream'` 是两个声明作用域，
  于是这套重载没有合并进 `node:stream` 的 `Readable`，反而把裸 `'stream'` 这一侧
  压成了「只有 `'limit'`」的坏接口。任何从裸 `'child_process'` / `'stream'` 取得的流，
  其 `.on('data', …)` 都变成类型错误。加 `node:` 前缀也**不管用**（实测），
  因为 `@types/node` 自身的 `child_process.d.ts` 走的就是裸 `'stream'`。
- 修法：只在这两处把流**拓宽**到 `NodeJS.ReadableStream`（该接口在全局命名空间，
  未被污染）。**运行时对象仍是 `Readable`，行为零变化**；属于纯类型层面的 workaround。
- 影响面：全仓只有这一处受影响（`grep` 过 `src/`，只有 `sharp.wrapper.ts` 碰 fork 的 stdio）。
- ⚠️ 这是**上游 busboy 的类型缺陷**，不是我们的升级引入的逻辑问题。将来
  `@fastify/busboy` 若修好（或改用 `node:stream` 增补），这两行 cast 可以删掉。

### 3.3 `backend/src/managers/auth/guards/apikey.strategy.ts`（编译错误 + 同步修正运行期语义）

```diff
   constructor(private readonly apikeyDB: ApiKeyDbService) {
+    // @nestjs/passport >= 11 wraps the strategy and appends its own verify
+    // callback itself (it calls `super(...args, callback)` and drives
+    // `this.validate(...)`). Passing a third argument here is therefore both
+    // rejected by the mixin's types and wrong at runtime.
     super(
       { header: 'Authorization', prefix: 'Api-Key ' },
       false,
-      (apikey, verified) => { this.validate(apikey).then(...).catch(...); },
     );
   }
```

- 错误：`TS2554: Expected 2 arguments, but got 3`。
- **根因**：`@nestjs/passport@12` 的 `PassportStrategy` mixin 源码是
  `super(...args, callback)` —— 它**自己**在末尾追加 verify 回调，并用
  `this.validate(...)` 驱动它。类型层用 `WithoutCallback<AllConstructorParameters<T>>`
  把「最后一个回调参数」**从构造签名里剥掉**了，所以合法的传参就是 2 个。
- 这不是类型误报：**回调和 mixin 的回调会同时存在**，第三个参数在运行期是重复的。
  按新的两参形式传，mixin 的回调会调用 `this.validate(apikey)`，走的就是本类原有的
  `validate()`，语义与旧代码完全一致（`false` → 认证失败）。
- 验证：实测 API key 认证路径 —— 见 §4.2。

### 3.4 `backend/src/config/early/serve-static.config.service.ts`（**运行期回归，冒烟发现**）

```diff
       {
         rootPath: this.getStaticDirectory(),
+        serveStaticOptions: {
+          fallthrough: true,
+        },
       },
```

- **症状**：升级后 SPA 深链全部 404 JSON。实测对比：

  | 路径 | 旧镜像（容器 :8080） | 升级后（宿主 :8081，未修） | 修复后 |
  |---|---|---|---|
  | `/` | 200 `text/html` | 200 `text/html` | 200 |
  | `/some/spa/route` | **200 `text/html`** | **404 `application/json`** | **200 `text/html`** |
  | `/images` | 200 | 404 | 200 |
  | `/settings` | 200 | 404 | 200 |

- **根因**：`@nestjs/serve-static@12` 的 Fastify loader 把 SPA fallback 改成**可选**：

  ```js
  const renderFn = (req, res) => {
      if (!options.serveStaticOptions?.fallthrough) {   // ← v4 没有这个判断
          const error = new NotFoundException();
          res.status(error.getStatus()).send(error.getResponse());
          return;
      }
      fs.stat(indexFilePath, ...);   // 命中才回 index.html
  };
  ```

  对比 `@nestjs/serve-static@4.0.2` 的同一个文件：它**无条件**返回 index.html。
  即：**不显式打开 `fallthrough`，前端单页应用的所有非根路径都会 404（返回 JSON，
  不是 HTML）** —— 这正是 PRD AC6「对外契约不变」会挂掉的地方，而且是**冒烟里最容易漏掉它**
  的（`/api/info` + 上传/取回/删除全过，只有浏览器深链会炸）。
- 修法：显式 `serveStaticOptions: { fallthrough: true }`，恢复升级前行为。
  值 `true` 只对「静态目录里不存在的路径」生效，语义与旧版一致。
- 验证：见 §4.3，修复后 4 条 SPA 路径全部 200 `text/html`。

### 未改动（确认无需改）

`main.ts` 的三处 `register(xxx as any)`、`postfile.pipe.ts` / `postfiles.pipe.ts`
（`request.file()` / `request.files()` / `Multipart` / `MultipartFile`）、
`app.module.ts` 的 `ServeStaticModule.forRootAsync` / `ScheduleModule.forRoot`、
`PicsurLayers.module.ts` 的 `ThrottlerModule.forRoot`、`image.service.ts` 的
`fileTypeFromBuffer` / `FileTypeResult` —— **全部原样编译通过、运行通过**。

---

## 4. L1 冒烟结果（逐步，脱敏）

实例：`PICSUR_PORT=8081 PICSUR_DB_HOST=127.0.0.1 PICSUR_PRODUCTION=true`，
日志 `.run/t0-backend.log`。**`PICSUR_VERBOSE` 保持 false**（未开启，日志无密钥）。

### 4.1 主链路 5 步（全绿）

| # | 步骤 | 命令要点 | 结果 |
|---|---|---|---|
| 1 | 服务信息 | `GET /api/info` | **200**，`data = {"production":true,"demo":false,"version":"0.0.0","tracking":{"state":"detailed"}}` |
| 2 | admin 登录 | `POST /api/user/login` `{"username":"admin","password":REDACTED}` | **201**，`data.jwt_token`（长度 188，与 spec §3.2 一致） |
| 3 | 上传 | `POST /api/image/upload` multipart 字段 `file` | **201**，`data.id` = UUID，`data.file_name="smoke"`，`delete_key` 非空 |
| 4 | 带扩展名取回 | `GET /i/<id>.{png,qoi,webp,avif}` | **200** ×4，`image/png` / `image/x-qoi` / `image/webp` / `image/avif` |
| 5 | 删除 | `POST /api/image/delete` `{"ids":["<id>"]}` | **201**，级联删除后三表计数全 **0** |

补充断言：

- **像素一致性**：取回的 `.png` 与上传原图 `sharp(...).raw()` 逐字节比对 → `pixels equal: true`（32×32×3）。
- **无扩展名** `/i/<id>` → **200** `image/png`（品牌占位图，与 spec §3.4 一致，非原图）。
- **无效 id** `/i/<uuid 全 0>` → **400**（与 spec 一致）。
- **删除后再取** `/i/<id>.png` → **200** + 占位图（与 spec 记录的既有可疑语义一致，未回归）。
- **宿主 sharp 实际用的 libvips**：`sharp 0.35.5 / vips 8.18.7`
  —— 注意这是 **npm 预编译自带的 libvips**，不是 Dockerfile 自编译的那份；
  仍然印证了 design.md §3 里「sharp 0.35.5 要求 libvips **≥8.18.7**」这个门槛。

### 4.2 我改动过的两处代码的定向验证

**API key 认证（对应 §3.3 的构造器改写）**

| 场景 | 结果 |
|---|---|
| 建 key `POST /api/apikeys/create` | 201，返回 `key`（REDACTED） |
| 用 key 访问 `GET /api/user/me`（`Authorization: Api-Key <key>`） | **200**，`success:true`，`data` 含 `token` + `user` |
| 用伪造 key 访问同一端点 | **403**（鉴权失败，符合预期） |
| 清理 | `POST /api/apikeys/delete` 201，`/api/apikeys/list` 归 **0** |

→ mixin 追加回调试运行期验证通过，改写没有破坏 API key 链路。

**CORS 路由排除（`app.module.ts` 的 `i/(.*)` legacy 通配符）**

| 请求 | 结果 |
|---|---|
| `GET /i/<id>.png` + `Origin: https://evil.example` | `Access-Control-Allow-Origin: *`（**镜像路由自己的** imageCorsConfig） |
| `GET /api/info` + `Origin: https://evil.example` | `Access-Control-Allow-Origin: <origin>`（mainCorsConfig 生效） |

→ 排除关系仍然正确：`/i/*` 走 image CORS，其余走 main CORS，与升级前一致。

**Throttler / Helmet**

- `GET /api/info` 响应头：`x-ratelimit-limit: 60` / `x-ratelimit-remaining: 59` / `x-ratelimit-reset: 1`
  → `ThrottlerModule.forRoot({ throttlers: [{ limit: 60, ttl: 60 }] })` 仍生效。
- Helmet 头齐全：`Content-Security-Policy` / `Referrer-Policy: no-referrer` /
  `Strict-Transport-Security` / `X-Content-Type-Options: nosniff` / `X-Frame-Options: SAMEORIGIN`。

### 4.3 SPA 静态托管（对应 §3.4 的回归修复）

| 路径 | 修复前 | 修复后 |
|---|---|---|
| `/` | 200 `text/html` | 200 `text/html; charset=utf-8` |
| `/some/spa/route` | 404 JSON | **200 `text/html`** |
| `/images` | 404 JSON | **200 `text/html`** |
| `/settings` | 404 JSON | **200 `text/html`** |

### 4.4 日志卫生

- `PICSUR_VERBOSE` 全程 **false**，日志中**无** JWT secret / DB 口令 / API key 明文。
- `grep -iE "error|exception"` 只剩 2 条，均已确认**非本次升级引入**：
  1. `WARN [UsageManagerModule] SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
     —— 上游 `metrics.picsur.org` 已停维护、返回 HTML，是**既有**的遥测出网失败。
  2. `WARN [MainExceptionFilter] … UsrvalidationFailure: Invalid image identifier`
     —— 我故意打的「无效 id」负例请求。

---

## 5. 既有数据库启动结论

**结论：既有库（升级前建的）直接可用，migration 未重跑，无需任何手工干预。** ✅

- 使用的是 `support/dev.docker-compose.yml` 的**既有卷** `support_db-data`
  （升级前已存在，非新建）：起容器时复用的就是原来的数据目录。
- 启动前实测库状态：`migrations` 表 **7 条**（`V030A…V050A`），`e_user_backend` 有
  `admin` / `guest`，`e_image_backend` 为 0。
- 升级后启动：**migration 日志 0 条**（`grep -i migration` 只匹配到
  `LegacyRouteConverter` 里出现的 "migration guide" 字样，不是 migration 执行）；
  启动后 `migrations` 表仍为 **7 条且 id/timestamp/name 与启动前逐条一致**。
- `PICSUR_PRODUCTION=true` → `synchronize:false`，未改库结构。

---

## 6. 越界 / 隔离自查

- ✅ 未占用 8080；宿主实例仅 `PICSUR_PORT=8081`。
- ✅ 未 `docker compose down` 根 compose；未动 `picsur` / `picsur_postgres` 容器
  （仅**只读**地 curl 过 `localhost:8080` 做行为对照）。
- ✅ 未改 `Dockerfile`（`git status` 里 Dockerfile 是 ` M`，**那是 Lead 在阶段 3 改的，不是我**）。
- ✅ 未执行 `git commit` / `push` / `reset` / `checkout` / `stash`。
- ✅ 未修改 `.trellis/**` 下既有文件（Lead 负责），只新增本文件与 `t0-deviations.md` 两个 research 文件。
- ✅ 未开 `PICSUR_VERBOSE`；报告内所有口令 / JWT / key 一律 `REDACTED`。
- ⚠️ 测试数据已自行清理：smoke 上传的图已删除（三表归零），smoke API key 已删除（0 条），
  `.run/t0-token.txt` 已 `chmod 600`。

---

## 7. 关于 8081 实例的当前状态（交接说明）

读者注意：报告写成时，宿主的 8081 实例**仍在运行**（PID 267687，`node backend/dist/main.js`），
供 Lead 直接复验或对照 L2。

> ✅ **Lead 收尾已核实并更正**：下文提到的 PID 261263 **就是 `picsur` 容器自己的主进程**，
> 不是「空转进程」——`docker inspect -f '{{.State.Pid}}' picsur` = **261167**（容器 init，即
> `pnpm --filter picsur-backend start:prod`），而 261263 是它的子进程（`node dist/main`），
> `/proc/261263/cgroup` 也确认在容器 cgroup 内。它「不监听端口」是因为容器有自己的 netns，
> 宿主 `ss` 看不到容器内的监听 socket。**无需清理，也不要 kill。**
> 8081 实例（含 check 子代理后来起的那份）已在收尾时清理。
