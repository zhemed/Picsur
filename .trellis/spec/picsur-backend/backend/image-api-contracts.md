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
POST   /api/image/list                    # 列出自己的图片（分页）
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
> 走 `pnpm start:prod`/容器入口（pnpm 注入）才是真实版本（**当前 0.6.0**，见根 `package.json`）。

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

- 默认存储格式为 **QOI**（无损）；能否保留原始文件取决于系统设置 `keep original`。

### 3.4 `GET /i/:id` 与 `/i/:id.:ext`

| 请求 | 实测结果 |
|---|---|
| `/i/<存在 id>.png` | 200 `image/png`，**像素与原图一致**（字节不保证：经过 QOI 中转后重新编码） |
| `/i/<存在 id>.qoi` | 200 `image/x-qoi` |
| `/i/<存在 id>.webp/.avif/.jxl/.jp2/.heif` | 200，对应类型（依赖镜像内自编译 libvips） |
| `/i/<存在 id>`（无扩展名） | 200，但返回**品牌占位图** `notfound.png`（512×361），不是原图、也不是 index.html |
| `/i/<不存在 id>`（无扩展名） | 400 JSON 错误 |
| 已删除的 `/i/<id>.<ext>` | 200 + 占位图 + `Cache-Control: max-age=2592000` |

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

---

## 4. Validation & Error Matrix

| 输入 | 结果 |
|---|---|
| 无扩展名的 `/i/<有效 id>` | 200 + 占位图（**静默降级，最容易误判成"图片还在"**） |
| 无扩展名的 `/i/<无效 id>` | 400 |
| 扩展名不在支持列表 | 400（`ImageFullIdPipe` 校验；具体列表见 `shared/src/util/common-regex.ts` / mime 枚举） |
| 无 token 上传 | 201（匿名，落到 guest 用户），前提是 guest 角色有上传权限 |
| 密码错误登录 | `success:false` + 4xx（实测未取具体码，未验证） |
| 超过 `PICSUR_MAX_FILE_SIZE` | 4xx（未验证具体码） |
| 超像素上限的图片 | 失败（对应上游 issue #107，未修） |

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

---

## 7. Wrong vs Correct

```bash
# Wrong —— 直觉得到的路径
curl -X POST localhost:8080/api/image -F file=@a.png        # 404
curl -X DELETE localhost:8080/api/image/<id>                # 404
curl localhost:8080/i/<id>                                  # 200，但拿到的是占位图

# Correct
curl -X POST localhost:8080/api/image/upload -H "Authorization: Bearer $TOKEN" -F "file=@a.png"
curl -X POST localhost:8080/api/image/delete -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"ids":["<id>"]}'
curl -o out.png "localhost:8080/i/<id>.png"
```
