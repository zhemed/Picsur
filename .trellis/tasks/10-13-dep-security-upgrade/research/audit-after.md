# 依赖安全升级：前后对比与残留说明（阶段 5 产出）

> 数据：`pnpm audit --registry=https://registry.npmjs.org`（本机 npm 源是 npmmirror，没有 audit 端点，
> 必须显式指定官方 registry）。JSON 原始证据：`audit-before.json`、`audit-after-overrides.json`、`audit-after-all.json`。

## 1. 生产依赖（`--prod`）前后对比

| 级别 | 升级前 | 升级后 | 变化 |
|---|---:|---:|---|
| critical | 5 | **0** | −5 |
| high | 64 | **0** | −64 |
| moderate | 40 | **0** | −40 |
| low | 9 | **0** | −9 |
| **合计** | **118** | **0** | **−118** |

## 2. 靠什么清掉的

### 2.1 直接依赖大版本升级（主体）

NestJS 10→12、Fastify 4→5、`@fastify/*` 四条线、TypeORM 0.3.20→0.3.31、sharp 0.33.5→0.35.5、
file-type 19→21.3.4。其中：

- `@fastify/middie`（critical）随 Nest 12 从 9.0.3 → **9.3.5**（Nest 11 也修不掉，这是选 12 的原因）
- `@fastify/static`（路由守卫绕过）、`@fastify/multipart`、`fastify` 本体、`typeorm`、`sharp`、
  `file-type` 均随版本升级进入已修区间
- `proxy-addr`（critical）→ fastify 5 换成了 `@fastify/proxy-addr`；`sha.js`（critical）→ typeorm 0.3.31 带 `^2.4.12`

### 2.2 `pnpm.overrides`（补刀，全部限定在**同大版本补丁线**内）

| override | 目标 | 清掉的告警 | 风险与验证 |
|---|---|---|---|
| `node-gyp: ^11.4.2` | 换掉 `bmp-img`/`qoi-img` 拖进来的 node-gyp@10 | `tar`(critical)、`glob`、`minimatch`、`brace-expansion`、`ip-address`、`http-cache-semantics`、`sprintf-js` 等一大片 | ⚠️ 中：会影响原生模块编译。**已验证**：`qoi-img`/`bmp-img`/`posix.js` 三个原生模块升级后仍能加载，backend 构建通过，上传/转码冒烟通过 |
| `fast-uri: ^3.1.8` | fastify 路由/schema 编译链 | `fast-uri`（high ×7） | ⚠️ 运行时热路径 → 已回归路由/上传/取反例 |
| `jsonwebtoken: ^9.0.3` | passport-jwt 链 | `jws`（high） | ⚠️ 运行时（JWT 验签）→ 已回归 admin 登录 + API key |
| `lodash: ^4.18.1` | `passport-headerapikey` | `lodash`（high/moderate） | 低：该包只用 `_.get`/`_.startsWith` → 已回归 API key |
| `brace-expansion@>=2.0.0 <2.1.2: ^2.1.2` | node-gyp 链 | high/low | 低：只命中 2.x 受影响区间，**不动** eslint 用的 1.x |
| `minimatch@>=9.0.0 <9.0.6: ^9.0.7` | node-gyp 链 | high | 低：只命中 9.x 受影响区间，不动 devDeps 的 3.x |
| `cross-spawn@>=7.0.0 <7.0.5: ^7.0.5` | 同上 | high | 低（同大版本） |
| `ip-address@<=10.3.0: ^10.3.1` | 同上 | high/moderate | 低 |
| `ajv@>=7.0.0 <8.18.0: ^8.18.0` | fastify 校验链 | moderate | 低（8.x 内补丁） |
| `diff@>=4.0.0 <4.0.4: ^4.0.4` | 同上 | low | 低 |
| `http-cache-semantics@<=4.2.0: ^4.3.0` | node-gyp → make-fetch-happen → cacache | high（最后 1 条） | 低：`cacache` 要求 `^4.1.1`，4.3.0 同大版本；advisory 的 `patched_versions` 写成 `<0.0.0`（上游没标修复版），但 4.3.0 已不在受影响区间内 |

**为什么用「版本区间限定」而不是裸覆盖**：裸 `minimatch: ^9.0.7` 会把 eslint 依赖的 minimatch@3 一起顶掉，
直接搞坏构建工具链。限定区间只命中真正受影响的那一档。

## 3. 残留（诚实边界）

### 3.1 生产依赖：无残留

`pnpm audit --prod` 现在 **0 条**。

### 3.2 全量口径（含 devDeps）仍有告警，**属明确的范围外**

`pnpm audit`（不加 `--prod`）现在是：critical 6 / high 92 / moderate 81 / low 16。
它们几乎全在**前端构建工具链**（Angular CLI / webpack / eslint / pacote 等）里。

⚠️ **但有一条必须说清楚**：前端把 Angular 的**运行时**包（`@angular/core|common|router` 等）
放在 `devDependencies` 里，所以 `--prod` 口径看不见它们，而它们**确实会打进浏览器产物**。
这部分（XSS/XSRF 类告警）**未修**，是本任务 PRD 里写明的残留风险，归属 **T6（Angular 大版本升级）**。

### 3.3 口径声明

`pnpm audit` 只能说明「已知 advisory 的命中情况」，**不等于**「没有漏洞」。
本任务的目标（PRD AC2）是生产依赖口径清零，已达成。

## 4. L2 阶段发现并修复的回归：镜像里 JXL / JP2 消失

**症状**：升级后重建镜像，容器里 `.jxl` / `.jp2` 从 **200 变 500**（旧镜像这两个是好的）：
`VipsOperation: class "jxlsave_buffer" not found`、`JP2 output requires libopenjp2`。

**排查过程**（值得记住，很容易误判）：

| 观察 | 结论 |
|---|---|
| libvips 构建摘要 `JXL: YES (dynamic module)` / `JPEG2000: YES` | 我们的 vips 本身没问题 |
| 容器里 `vips -l \| grep jxlsave` **有**，`ls /usr/local/lib/vips-modules-8.18/` 有 `vips-jxl.so` | OS 层的 vips 完全正常 |
| 但 sharp 进程里 `sharp.format.jxl.output.buffer === false` | 问题在 **sharp 用的不是这个 vips** |
| 镜像里有 `@img/sharp-linuxmusl-x64@0.35.5` + `@img/sharp-libvips-linuxmusl-x64@1.3.4` | sharp 装的是**预编译**绑定 |
| sharp 0.35.5 的 `package.json` **没有 `install` 脚本**，只有 `"build": "node install/build.js"` | **安装流程根本不会从源码构建** |

**根因**：`sharp ≥0.33` 的安装只装预编译的 `@img/sharp-*`（自带一份精简 libvips，**不含 JXL/JP2**）。
上游 Dockerfile 里的 `SHARP_FORCE_GLOBAL_LIBVIPS=1 pnpm install` 在 **sharp 0.33 时代有效**，
到 **0.35 已经失效**（`install/check` 不再读这个变量）。pre-T0 镜像之所以有 JXL/JP2，是因为 0.33.5 的安装流程还认那个变量。

**修复**（`Dockerfile` 的 `prod_deps` 阶段末尾显式构建一次）：

```dockerfile
RUN cd /picsur/backend/node_modules/sharp \
 && SHARP_FORCE_GLOBAL_LIBVIPS=1 NODE_PATH=/usr/local/lib/node_modules node install/build.js
```

（`node-addon-api` / `node-gyp` 改为全局安装并用 `NODE_PATH` 给它解析——sharp 自己的 `node_modules` 是空的。）

**修复后实测**：容器内 `sharp 0.35.5 / vips 8.18.7`，
`format.jp2.output.buffer=true`、`format.jxl.output.buffer=true`，
`/i/<id>.{png,qoi,webp,avif,jxl,jp2,heif}` **7 种全部 200**。

**教训**：升级后「镜像能起 + `/api/*` 冒烟绿」**不足以**证明能力没退化 ——
格式/编解码这类能力必须**逐项在容器里验证**，且要意识到「CLI 有的能力 ≠ sharp 进程有的能力」。
