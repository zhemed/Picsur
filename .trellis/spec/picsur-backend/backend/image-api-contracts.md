# 图像 API 契约（HTTP）

> 来源：任务 `10-13-handover-baseline` 实测（`research/smoke.md`、`research/lead-verification.md`）。
> 只在实测过的地方写具体值；未实测的标 `未验证`。

---

## 1. Scope / Trigger

- Trigger：改图像相关路由、写客户端/SDK、写运维脚本、排查上传/取图问题。
- 为什么需要：picsur 的路由命名与直觉不符（`upload` 不是 `image`、删除是 POST 不是 DELETE、
  取图必须带扩展名），且**所有 POST 都返回 201**。按直觉写必踩。

---

## 2. Signatures

```
GET    /api/info                          # 服务信息（匿名）
POST   /api/user/login                    # {"username","password"}
POST   /api/image/upload                  # multipart, 字段名 file
POST   /api/image/list                    # 列出自己的图片（分页；请求体 {count,page,user_id?}）
POST   /api/image/list/all                # 列出当前用户全部图片（不分页，#115）
POST   /api/image/update
POST   /api/image/delete                  # {"ids":[...]}
POST   /api/image/delete/key
GET    /api/image/delete/:id/:key         # 用 delete_key 匿名删除
GET    /i/:id                             # 原图/占位图（见 §4）
GET    /i/:id.:ext                        # 实时转码到 ext
GET    /i/meta/:id
POST   /api/pref/sys/:key                 # {"value": ...} 改系统首选项（需 admin）
GET    /api/pref/sys  /  /api/pref/sys/:key
```

---

## 3. Contracts

### 3.1 `GET /api/info`

```json
{"success":true,"statusCode":200,"data":{
  "production":true,"demo":false,"version":"0.6.0","tracking":{"state":"detailed"}}}
```

> `version` 取自 `npm_package_version`：**裸跑 `node dist/main.js` 会退化成 `"0.0.0"`**，
> 走 `pnpm start:prod`/容器入口（pnpm 注入）才是真实版本（版本号以根 `package.json` 为准，发版时四处同步）。

### 3.2 `POST /api/user/login`

- 请求：`{"username":"admin","password":"<PICSUR_ADMIN_PASSWORD>"}`
- 响应：`201` + `{"data":{"jwt_token":"<JWT>"}}`（实测长度 188）

### 3.3 `POST /api/image/upload`

- 请求：`multipart/form-data`，字段名 **`file`**；可选 `Authorization: Bearer <jwt>`
- 响应：`201` + `data`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | 图片 id |
| `user_id` | uuid | 匿名上传时为 guest 用户 id |
| `created` | ISO 时间 | — |
| `file_name` | string | 上传文件名的**去扩展名**形式 |
| `expires_at` | ISO 时间 \| null | null = 永不过期 |
| `delete_key` | string \| null | 带权限时返回，用于匿名删除 |
| `source_filetype` | string \| null | **上传时的真实格式**（如 `image:png` / `image:jpeg`），#128 起新增；升级前的旧行为 `null` |

- 默认存储格式为 **QOI**（无损）；能否保留原始文件取决于系统设置 `keep original`。
- ⚠️ `source_filetype` 的用途是让**前端**默认选中「上传时的格式」（#128）：
  **它不改变后端路由行为** —— `/i/<id>`（无扩展名）依然返回品牌占位图，这一点实测确认过。

### 3.4 `GET /i/:id` 与 `/i/:id.:ext`

> 2026-10-13（任务 `10-13-fix-known-bugs`）起，**不存在的图片一律 404 + `Cache-Control: no-store`**，
> 正文仍是品牌占位图。**存在的图片缓存行为未变**（`max-age=2592000`），细节见 §3.7。

| 请求 | 实测结果 |
|---|---|
| `/i/<存在 id>.png` | 200 `image/png` + `Cache-Control: max-age=2592000`，**像素与原图一致**（字节不保证：经过 QOI 中转后重新编码） |
| `/i/<存在 id>.qoi` | 200 `image/x-qoi` |
| `/i/<存在 id>.webp/.avif/.jxl/.jp2/.heif` | 200，对应类型（依赖镜像内自编译 libvips） |
| `/i/<存在 id>`（无扩展名） | **取决于这个 id 有没有"原图"**：有保留原图 → 200 原图；SVG master → 200 净化 SVG + CSP；**没有保留原图的普通图 → 404 + `no-store`**（正文仍是品牌占位图 `notfound.png`）。前端只在 `hasOriginal` 时才提供这种链接，UI 不受影响 |
| `/i/<不存在 id>`（无扩展名） | **404** + 占位图 + `no-store` |
| 已删除的 `/i/<id>.<ext>` | **404** + 占位图 + `no-store`（修复前是 200 + 30 天缓存） |
| 已删除的 `HEAD /i/<id>.<ext>` | **404** + `no-store`（修复前恒为 200，会让 HEAD 探测器误判） |
| `/i/meta/<不存在 id>` | **404** + `no-store` |
| `/i/meta/<存在 id>` | 200 + `no-store`（见 §3.7） |

**SVG（#129 起）**：SVG 按**原始向量**存为 master，不走 sharp 栅格化。

| 请求 | 实测结果 |
|---|---|
| `/i/<SVG id>.svg` | 200 `image/svg+xml` + `Content-Security-Policy: sandbox; default-src 'none'; … script-src 'none'` + `X-Content-Type-Options: nosniff`；正文是**净化后**的 SVG（`<script>`、`onload`、外部 `<use xlink:href>` 引用都会被删） |
| `/i/<栅格图 id>.svg` | 4xx 用法错误（栅格图没有 SVG master，不是内部 500） |
| SVG 上传后取 `.png` 等栅格格式 | 200（librsvg 栅格化，仍受像素/时间上限约束） |

### 3.8 `POST /api/image/list/all`（#115）

- 请求：`{}`（可选 `user_id`，但非 ImageAdmin 会被强制覆盖成调用者自己 → **不能越权列别人的图**）
- 响应：`201` + `{"data":{"results": EImage[], "total": number}}`
- 与分页版 `list` 的差别：不返回 `page`/`pages`，一次给全量
- 匿名调用 → **403**（实测）

### 3.5 `POST /api/image/delete`

```json
// 请求
{"ids":["<uuid>"]}
// 响应 201
{"success":true,"statusCode":201,"data":{"images":[{"id":"<uuid>","user_id":"...","created":"...","file_name":"...","expires_at":null}]}}
```

级联删除：`e_image_backend` / `e_image_derivative_backend` / `e_image_file_backend` 三张表记录一并清掉（实测计数归零）。

### 3.6 通用响应信封

成功：`{success:true, statusCode, timestamp, timeMs, data}`
失败：`{success:false, statusCode, timestamp, time, data:{...错误详情}}`

**所有 `POST` 成功返回 `201`**（NestJS `@Post` 默认），不是 200 —— 客户端判断要用 `2xx`。

### 3.7 缓存契约（别一刀切）

`AppModule` 的 `imageCacheSet` 中间件给**所有** `/i/*` 响应无条件加
`Cache-Control: max-age=2592000`，这是**性能特性**（图片 id 不可变，共享缓存可以长期持有）。
需要覆盖它的只有「图片不存在」这一种情况：

| 路径 | 缓存头 | 为什么 |
|---|---|---|
| `GET/HEAD /i/<存在 id>.*` | `max-age=2592000`（保留） | 图片字节不可变，长缓存是设计 |
| `GET/HEAD /i/<不存在 id>.*` | `no-store` | 删除/过期后必须立刻失效，否则占位图会被当成本体缓存一个月 |
| `GET /i/meta/:id`（存在或不存在的 id） | `no-store` | 前端靠它判断图片是否存在；缓存 30 天会导致刷新 `/view/<id>` 仍渲染出「图片还在」的完整页面（含分享链接） |

改这块时注意：占位图正文 + 长缓存 = 「删了等于没删」，所以状态码、缓存头、正文三者要一起看。

---

## 4. Validation & Error Matrix

| 输入 | 结果 |
|---|---|
| 无扩展名的 `/i/<有效 id>` | 有保留原图 → 200 原图；无原图 → **404 + no-store**（正文仍是占位图）；SVG → 200。**#129 吸收后这条从"恒 200 占位图"变成了"按原图有无分流"**，改前端或文档前先读 §3.4 |
| 无扩展名的 `/i/<无效 id>` | 404 + 占位图 + `no-store` |
| 扩展名不在支持列表 | 400（`ImageFullIdPipe` 校验；具体列表见 `shared/src/util/common-regex.ts` / mime 枚举） |
| 无 token 上传 | 201（匿名，落到 guest 用户），前提是 guest **有**上传权限：非 demo 实例只给 `GuestPermissions`（不能传），`PICSUR_DEMO=true` 的实例通过 `GuestDefaultPermissions(isDemo)` 额外给 `image-upload`（重启生效） |
| 密码错误登录 | `success:false` + 4xx（实测未取具体码，未验证） |
| 超过 `PICSUR_MAX_FILE_SIZE` | 4xx（未验证具体码） |
| 超过像素上限的图片 | **400** `{"type":"usrvalidation","data":{"message":"Image is too large to process: <w>x<h> (<n> pixels) exceeds the maximum of <limit> pixels. Set PICSUR_MAX_IMAGE_PIXELS to raise the limit (0 disables it)."}}`（修复前是 500 `Worker closed`） |
| 图片头读不出（损坏，或当前 libvips 无该格式解码器） | 400 `"Failed to read image metadata: <底层原因>"`；宿主的预编译 sharp 缺 JXL/JP2 解码器，同一文件在自编译 libvips 的镜像里上传正常 |
| `PICSUR_MAX_IMAGE_PIXELS` | 未设 = 268402689（sharp 默认 `0x3FFF^2`）；`0` = 不限制 |

---

## 5. Good / Base / Bad Cases

- **Good**：`upload → 拿 data.id → /i/<id>.png`（带扩展名）→ `delete` 用返回的 `ids` 结构。
- **Base**：只想分享链接 —— 用 `/i/<id>.<原始扩展名>`；前端 `ImageService.GetImageURL()` 就是这么拼的。
- **Bad**：① 拿 `/i/<id>` 当原图链接（拿到占位图）；② 用 `DELETE /api/image/<id>`（404，本项目是 `POST /api/image/delete`）；
  ③ 用 `POST /api/image` 上传（404，正确路径是 `/api/image/upload`）。

---

## 6. Tests Required

| 断言点 | 期望 |
|---|---|
| 冒烟脚本 5 步（见 `build-and-deploy.md` §6） | 全绿 |
| 取回像素一致性 | 解码 `/i/<id>.png` 与原图 raw 像素逐一相等（**不要断言字节相等**） |
| 删除后 DB 计数 | 三张表归零 |
| 所有 POST 的状态码 | 断言落在 `200–299`，不要写死 200 |
| 删除语义 | `GET/HEAD /i/<已删除 id>.<ext>` → **404** 且 `Cache-Control: no-store`；`GET /i/<未删除 id>.<ext>` → 200 且 `max-age=2592000`（两个方向都要断言，防止一刀切砍掉性能特性） |
| 超像素上传 | → 400，且消息里同时出现实际像素数与上限值；之后 `/api/info` 仍 200（服务未崩） |
| 7 种格式转码 | `qoi/webp/avif/jxl/jp2/heif/png` 全部 200；**JXL/JP2 必须在容器/自编译 libvips 环境跑**，宿主预编译 sharp 没有这两个解码器（见 `build-and-deploy.md` §8.3.4） |

### 6.1 可复现的回归脚本（必须自给自足）

仓库内 `support/regression-image-api.sh`（任务 `10-13-fix-known-bugs` 交付，任务
`10-16-revert-verify-fix` 改为自给自足）自带登录与断言，**并自己保证夹具备齐**：

```bash
# 一条命令；夹具缺失时脚本自动调用 make-image-fixtures.cjs 生成
bash support/regression-image-api.sh http://localhost:8080 "$PICSUR_ADMIN_PASSWORD"
# 期望 RESULT: 34 passed, 0 failed
```

夹具由 `support/make-image-fixtures.cjs` 负责（`[fixture-dir]` 默认 `/tmp/bugs-fx`，
可用 `$PICSUR_FIXTURES` 覆盖）：它在本地 sharp 编不出 JXL/JP2 时**自动改用带完整
libvips 的容器**（`PICSUR_FIXTURE_IMAGE`，默认 `ghcr.io/zhemed/picsur:allinone`）生成
并拷回；docker 不可用又编不出来时**直接 FATAL 退出**（exit 2）并给出提示，不会静默
跑出一堆 FAIL。离线机器可用 `PICSUR_FIXTURE_NO_PULL=1` 禁止拉镜像。

**约定：回归必须自给自足。** 任何"验收门"（脚本、CI、手册清单）都必须能在一台
干净检出上从零跑到结论：夹具自己生成、实例地址与口令由参数传入、不依赖某人手里的
临时文件、不依赖人工前置步骤。新加检查项时要把它需要的输入一起脚本化。

宿主（预编译 sharp）跑同一脚本会失败 4 项：`.jxl/.jp2` 的输出转码与源格式上传
—— 这是 `build-and-deploy.md` §8.3.4 记录的已知环境差异，不是回归。用
`PICSUR_FIXTURE_IMAGE` + 容器实例即可 34/34。

---

## 7. Wrong vs Correct

```bash
# Wrong —— 直觉得到的路径
curl -X POST localhost:8080/api/image -F file=@a.png        # 404
curl -X DELETE localhost:8080/api/image/<id>                # 404
curl localhost:8080/i/<id>                                  # 取决于有无原图：200 原图 / 404+占位图（见 §3.4）

# Correct
curl -X POST localhost:8080/api/image/upload -H "Authorization: Bearer $TOKEN" -F "file=@a.png"
curl -X POST localhost:8080/api/image/delete -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"ids":["<id>"]}'
curl -o out.png "localhost:8080/i/<id>.png"
```

## 取图与画质（2026-10-17 实测结案）

| 请求形式 | 服务端实际给什么 | 画质 |
|---|---|---|
| `/i/<id>.png`（显式指定格式） | **原尺寸**的该格式派生图（实测例：2292×1209 ✓、800×600 ✓） | **无损** ✓ —— 解码成 raw 逐字节比对**差异 0**（噪声图 0/1,440,000、渐变图 0/1,440,000） |
| `/i/<id>`（**无扩展名**） | **"下载原图"语义**（`image.controller.ts:93` → `variant:'original'`）；**普通上传（未保留原图）→ 404 + 品牌占位图** `branding/messages/notfound.png`（512×361 / 33,516 B，实测与仓库文件 SHA-256 一致 ✓） | 与"缩图默认值"无关 ✓ |
| 图库缩略图 | 曾拿到 **QOI**（同一图 width=340：142 KB vs WebP 2.2 KB，约 **65×**） | 已由前端改为**显式 WebP** ✓ |

**不存在"不带参数就缩到 512"这种默认值** ✗：`ImageRequestParamsSchema`（`image.dto.ts`）**没有任何 default** ✓，`image-converter.service.ts:111` 只在给了维度时才 resize ✓；`support/regression-image-api.sh:153` 本来就断言"删除后的 `/i/<id>` 无扩展名 → 404" ✓。热链接/分享走 `GetImageURL()` = `/i/<id>.<ext>` 无参数 = **原尺寸** ✓，没有消费者依赖"无扩展名给小图" ✓。
> 纠正记录：Lead 首测漏看 HTTP 状态码 ✗，把 404 占位图误判为"缩小的原图"；由 `prs-stream` 复核（file:line + 字节哈希双重对证）纠正 ✓。

**体积变化不等于画质变化**：PNG 派生图与原图的差别只来自「重新压缩 + 剥离元数据（EXIF/ICC/时间戳块）」（实测 500 KB → 344 KB 而像素零差异 ✓）；元数据剥离对图床属期望行为（顺带抹掉拍摄设备/GPS ✓）。**唯一例外**：原图带 ICC 色彩配置时，剥掉后颜色可能有极轻微变化 ✓。
