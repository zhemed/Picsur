# T0 阶段 1–2：残留告警与需要 Lead 接手的事项

> 配套文件：`t0-l1-smoke.md`（冒烟详情与代码改动逐条说明）。
> 本文件只写**结论 + 交给 Lead 的动作项**，阶段 3–6 不在我的范围内。

---

## 1. `pnpm audit --prod` 现状（升级后，实测 2026-10-13）

`pnpm audit --prod --registry=https://registry.npmjs.org --json` 原始输出存
`.run/t0-audit-after.json`（未入库，gitignored）。

| 级别 | 升级前 | 升级后 |
|---|---|---|
| critical | 5 | **1** |
| high | 64 | **30** |
| moderate | 40 | 14 |
| low | 9 | 2 |
| 合计 | 118 | **47** |

### 1.1 剩下这 1 条 critical

`tar <=7.5.18`（`GHSA` node-tar 解压 DoS），修复版本 `>=7.5.19`。
**它的路径全部来自 `node-gyp`**，而 `node-gyp` 是 `bmp-img` / `qoi-img` 的**硬依赖**：

```
backend > bmp-img@1.3.0 > node-gyp@10.2.0 > tar@6.2.1
backend > qoi-img@2.2.0 > node-gyp@10.2.0 > tar@6.2.1
backend > {bmp-img,qoi-img} > node-gyp > make-fetch-happen > cacache > tar@6.2.1
```

**判断**：`node-gyp` / `tar` 是**编译期**才用的（`node-gyp rebuild` 编译原生插件），
生产运行时不会被 `require`。但它确实躺在 `--prod` 依赖树里（因为
`bmp-img` / `qoi-img` 把 `node-gyp` 写在 `dependencies` 而非 `devDependencies`）。
→ **适合用 `pnpm.overrides` 顶掉**，见 §2。

### 1.2 剩下 high 的分布（30 条，去重后只有 6 个包）

| 包 | 修复版本 | 路径来源 | 是否运行时 |
|---|---|---|---|
| `tar` | `>=7.5.7` 起多档，最新 `>=7.5.21` | `bmp-img`/`qoi-img` → `node-gyp` | ❌ 编译期 |
| `brace-expansion` | `>=2.1.2` 起多档，最高 `>=2.1.6` | `node-gyp`→`glob`/`minimatch`；`typeorm`→`ts-node` | ❌ 编译期 |
| `minimatch` | `>=9.0.6` / `>=9.0.7` | 同上（`glob` 链） | ❌ 编译期 |
| `glob` | `>=10.5.0` | 同上（`node-gyp` 链） | ❌ 编译期 |
| `fast-uri` | `>=3.1.4` 起多档，最高 `>=3.1.7` | `@nestjs/platform-fastify` / `@nestjs/serve-static` → `ajv`/`fast-json-stringify`/`fastify` | ⚠️ **运行时**（fastify 的 schema 编译器） |
| `jws` | `>=3.2.3` | `passport-jwt` → `jsonwebtoken` | ⚠️ **运行时**（JWT 校验） |
| `lodash` | `>=4.18.0`（实测 npm 上 `latest=4.18.1`，4.17.x 全线受影响） | `passport-headerapikey` | ⚠️ **运行时**（但它只用了 `_.get` / `_.startsWith`） |
| `ip-address` / `http-cache-semantics` / `sprintf-js` | 见 audit JSON | `bmp-img`/`qoi-img` → `node-gyp` 链 | ❌ 编译期 |

**分类结论**：30 条 high 里，**绝大多数（`tar`/`glob`/`minimatch`/`brace-expansion`/
`ip-address`/`http-cache-semantics`/`sprintf-js`）都挂在 `node-gyp` 编译链上**，
顶掉 `node-gyp` 或顶掉这几个传递包即可一次清掉一大片。
真正落在**运行时热路径**上的只有 **`fast-uri`（fastify 路由/schema）、`jws`（JWT）、
`lodash`（apikey 策略）** 三个。

> 说明：`pnpm audit` 的口径是「包的依赖树里存在该版本」，不区分运行时/编译期。
> AC2 要求 critical=0 且 high=0，若要以 `override` 达成，请按 §2 的顺序做，并且
> **每个 override 之后都要重跑构建 + 冒烟**（design.md §4.3 的硬要求）。

---

## 2. 建议的 override 清单（**尚未执行**，交给 Lead 阶段 5 决策）

按 design.md §4 的判断顺序（先升级 → 再 override → 最后才接受残留），
残余项**已经无法靠升级直接依赖解决**（都是间接传递），所以进 override 阶段。

**原则**：全部走**同一大版本内的补丁线**，不跨大版本（design.md §4.2 的禁令）。

| # | override | 目标 | 理由 | 风险 |
|---|---|---|---|---|
| 1 | `node-gyp@^11 || ^13` | 换掉 `bmp-img`/`qoi-img` 拖进来的 `node-gyp@10.2.0` | 一次性带走 `tar`/`glob`/`minimatch`/`brace-expansion`/`ip-address`/`http-cache-semantics` 的大半 | ⚠️ 中：`node-gyp` 大版本变化会影响本机/镜像里 **`qoi-img`、`bmp-img`、`posix.js` 的原生编译**。必须验证 `pnpm install` 能编过 + 上传 QOI/BMP 转码可用 |
| 2 | `tar@^7.5.22` | 仅剩的 critical | 若 #1 不做或做不干净，至少把 critical 压掉 | 低（编译期） |
| 3 | `brace-expansion@^2.1.7` | high/mod | 补丁线内 | 低 |
| 4 | `minimatch@^9.0.7` | high | 9.x 补丁线内 | 低 |
| 5 | `glob@^10.5.0` | high | 10.x 补丁线内 | 低 |
| 6 | `fast-uri@^3.1.8` | high ×7 / mod | **运行时热路径**，3.x 补丁线内 | ⚠️ 中：fastify 用它做 schema 编译/URI 解析，改完必须重点回归路由 + 上传 + 400 负例 |
| 7 | `jws@^3.2.3` | high | **运行时**（JWT 验签） | ⚠️ 中：`jsonwebtoken@9` 的依赖，改完必须回归 admin 登录 + JWT 鉴权 + API key |
| 8 | `lodash@^4.18.1` | high/mod | `passport-headerapikey` 只用 `_.get`/`_.startsWith`，API 面窄 | 低-中（4.18 是次要版本跳跃，需回归 API key 认证） |

**建议顺序**：先做 2–5（编译期、低风险、一次能清 20+ 条），复测；再单独做 6/7/8
（运行时，逐个测）；最后评估 1（收益最大但风险最高，如果 2–5 已经让
`node-gyp` 链上的告警全清，就不要碰 `node-gyp` 本身）。

**若某个 override 跑不通过**：按 design.md §4.3 直接回退该条，并在
`research/audit-after.md` 记为「接受残留 + 原因 + 缓解」，不要硬留。

---

## 3. 交给 Lead 的其他事项

### 3.1 ⚠️ Dockerfile 里的 libvips 必须 ≥8.18.7（阶段 3）

宿主侧实测 sharp 0.35.5 自带的 libvips 就是 **8.18.7**；`sharp@0.35.5` 的
`config.libvips = '>=8.18.7'`。而 Dockerfile 是**源码编译 8.16.0**，
`SHARP_FORCE_GLOBAL_LIBVIPS=1` 下编译会直接卡在版本检查。
→ 阶段 3 的 `8.16.0 → ≥8.18.7` 是**必须**，不是可选。

### 3.2 ⚠️ Nest 12 的 legacy 通配符告警（**我未改，留给 Lead 决定**）

启动日志有 **4 条** `LegacyRouteConverter` 警告，全部来自
`backend/src/app.module.ts` 的同一个写法：

```
consumer.apply(mainCorsConfig).exclude('i/(.*)').forRoutes('*');       // L80
consumer.apply(imageCorsConfig, …).forRoutes('i/(.*)');                // L83
```

`path-to-regexp@8`（Nest 12 内嵌）不再接受 `(.*)`，Nest 会**自动转换**成 `/i/{*path}`
并且功能**实测正常**（见 `t0-l1-smoke.md` §4.2 的 CORS 验证）。
所以它**不是 bug**，只是噪音。我没有动它，因为：

- 改它属于「改对外路由/中间件挂载方式」，超出「修编译/运行错误」的最小改动边界；
- 而且 `exclude('i/(.*)')` 在 Nest 12 下走的是同一套 converter，改成 `{*path}` 语法
  反而需要重新验证 `exclude` 的语义是否逐字一致（`forRoutes('*')` 也需要测试）。

**建议**：若 Lead 想消掉噪音，把两处改成 `'i/{*path}'` / 让 `forRoutes` 用隐式全匹配，
但**必须重跑 §4.2 的 CORS 对照**（`/i/*` 不该带 mainCorsConfig 的 `<origin>`）。

### 3.3 残留进程（**已由 Lead 核实：误判，无需处理**）

> ✅ **更正**：PID 261263 就是 `picsur` 容器自己的主进程 —— `docker inspect` 显示容器 PID = **261167**
> （`pnpm --filter picsur-backend start:prod`），261263 是它的子进程 `node dist/main`，
> `/proc/261263/cgroup` 确认在容器 cgroup 内。它「不监听端口」是因为容器有独立 netns，宿主看不到。
> **不是空转进程，不要 kill。**（下方原文保留作为排查过程记录。）

原文：PID **261263** = `node dist/main`（cwd `backend/`），环境
`PICSUR_PORT=8080` + `PICSUR_DB_HOST=picsur_postgres` + `PICSUR_PRODUCTION=true`，
起于 04:37:27。它**不监听任何 TCP 端口**（8080 已被 `picsur` 容器的 docker-proxy 占住），
属于抢端口失败的**空转进程**，但持有指向 `picsur_postgres`（生产库）的连接池。
父进程 PID 261167 是 `pnpm --filter picsur-backend start:prod`。
**我没有 kill 它**（不在授权范围）。建议 Lead 确认来源后清理。

我自己的 8081 实例：PID **267687**，`node backend/dist/main.js`，
日志 `.run/t0-backend.log`，报告写成时仍在跑，供 Lead 复验。

### 3.4 已确认无需改动的点（省得 Lead 重查）

以下「已知会碰到的代码点」实测**原样通过**，升级后没有改动一行：

- `backend/src/main.ts` 的 `register(multipart as any)` / `register(fastifyHelmet as any, …)` /
  `register(fastifyReplyFrom as any)` —— 有 `as any`，类型不受影响，运行正常。
- `decorators/multipart/postfile.pipe.ts` / `postfiles.pipe.ts` ——
  `request.file()` / `request.files()` / `Multipart` / `MultipartFile` 类型与运行都没变
  （上传 201 已验证）。
- `managers/image/image.service.ts` 的 `fileTypeFromBuffer` / `FileTypeResult` —— 编译通过，
  运行通过（file-type 22 的 ESM 产物被正确加载）。
- `app.module.ts` 的 `ServeStaticModule.forRootAsync` / `ScheduleModule.forRoot` —— 无需改
  （真正要改的是它注入的 `ServeStaticConfigService`，见 §3.5）。
- `layers/PicsurLayers.module.ts` 的 `ThrottlerModule.forRoot` —— 无需改
  （`x-ratelimit-*` 头实测仍在）。

### 3.5 最容易漏的一条：SPA fallback（**已修，但请 Lead 在 L2 回归里保住**）

`@nestjs/serve-static@12` 把 SPA fallback 改成 `fallthrough` 开关控制，
**默认不返回 index.html 而是 JSON 404**。`/api/*` 全绿也发现不了它，
只有浏览器深链（`/images`、`/settings`…）会炸。
修法与验证见 `t0-l1-smoke.md` §3.4 / §4.3。
**阶段 4 的 L2 冒烟清单里建议加一条**：`curl -s -o /dev/null -w '%{http_code} %{content_type}' localhost:8080/some/spa/route`
期望 `200 text/html`。

---

## 4. 「改了但没验证到」的部分（诚实边界）

1. **multipart 的边界行为**没有做穷举：超大文件（> `PICSUR_MAX_FILE_SIZE=128000000`）、
   多文件上传（`files: 1` 限制）、空字段清理 —— 都没测。正常路径（单文件上传 + 取回）已测。
2. **`@fastify/reply-from@12`** 的实际代码路径没有被冒烟覆盖到（它服务的是转发/代理类路由，
   本次 5 步冒烟不经过）。仅验证了「能注册、应用能起来」。
3. **`@fastify/helmet@13`** 只验证了响应头存在（CSP/HSTS 等），没有逐条对比升级前的头部差异。
4. **`@nestjs/config@12`** 只验证了既有 env 全部被正确读到（host/port/db/static/production 日志全对），
   没有测动态配置（`ConfigModule` 的 watch/cache 类特性本项目未用）。
5. **`typeorm@0.3.31`** 只验证了「既有库可启动 + migration 不重跑 + CRUD 正常」，
   没有覆盖 migration **生成**（`pnpm migrate`）路径 —— 本任务不改 schema，故未测。
6. **`file-type@22`** 只验证了 PNG 上传（以及 QOI/WEBP/AVIF **输出**），
   没有逐个测 22 个输入格式的识别。
7. **`node:worker_threads` / fork 的 sharp worker** 是否受 §3.2 的类型 workaround 之外的
   运行期影响 —— 转码路径实测可用（png/qoi/webp/avif 全 200），说明 worker fork + 通信正常。
