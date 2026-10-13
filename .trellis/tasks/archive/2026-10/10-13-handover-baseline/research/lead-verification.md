# Lead 独立复验（阶段 4 结论的交叉验证）

> 由 Lead（主会话）在 `trellis-implement` 子代理交付后**独立重跑**，不依赖子代理的自述。
> 时间：2026-10-13 03:56–04:00 UTC。全部在 `127.0.0.1:8080` 本地实例上完成。

## 1. 复验结论

| 项 | 子代理结论 | 我的复验 | 判定 |
|---|---|---|---|
| `GET /api/info` | 200 | 200，`production:true`、`version:"0.0.0"` | ✅ 一致 |
| admin 登录 | 201 + token(188) | 201 + token(188) | ✅ 一致 |
| 上传 | 201 + id | 201 + id + `delete_key` | ✅ 一致 |
| 删除 | 201 + 记录 + 三表归零 | 201 + 记录 | ✅ 一致 |
| 删除后 `/i/<id>.png` | 200 + 占位图 + `max-age=2592000` | 200 + `notfound.png`（sha256 相同）+ 同缓存头 | ✅ 一致 |
| `/i/<id>` 无扩展名返回什么 | 「SPA fallback 交给 `index.html`」 | **仍是品牌占位图 `notfound.png`（33516 B），不是 index.html** | ⚠️ 解释错误，结论方向一致 |
| `/i/<id>.png` 与原图「逐字节相同」 | 声称相同 | 我这组**字节不同**（75 B → 96 B），但**像素完全一致** | ⚠️ 表述过强 |

## 2. 两处更正（都要写进 spec / 清单）

### 2.1 无扩展名 `/i/<uuid>` 返回的是占位图，不是 index.html

```
$ curl -s -o v-noext.bin -w 'http=%{http_code} size=%{size_download} type=%{content_type}\n' \
    "http://127.0.0.1:8080/i/<已存在 id>"
http=200 size=33516 type=image/png
$ sha256sum v-noext.bin frontend/dist/assets/branding/messages/notfound.png
23995390147dee5c…  v-noext.bin
23995390147dee5c…  frontend/dist/assets/branding/messages/notfound.png     # 同一个文件
```

对照：真正的 SPA 路由 `/upload` 才返回 `index.html`（200 / `text/html` / 64598 B）。
→ 正确表述：**`/i/<uuid>` 缺少扩展名时拿不到原图，拿到的是品牌占位图**；
不要写成「SPA fallback 返回 index.html」。（SPA fallback 只对非 `/i/` 路径生效。）

### 2.2 「原图取回是否逐字节一致」取决于原图是谁生成的

同一张图分别验证：

| 原图 | 原始字节 | `/i/<id>.png` 取回 | 像素 |
|---|---|---|---|
| 子代理用 sharp 生成 32×32 PNG | 125 B | 125 B（sha 相同） | 相同 |
| 我用 python zlib 生成 8×8 PNG | 75 B | **96 B（sha 不同）** | **完全相同**（sharp 解码 raw 192 B 逐一相等） |

→ 正确表述：Picsur 默认把图片存成 **QOI**（无损），取回 `.png` 是**重新编码**的结果；
**像素无损，但不保证字节级一致**（自身由 sharp 生成的图可能恰好一致，不能当保证）。

## 3. 复验用的其余观测（补充证据）

- 上传返回体含 `delete_key`（匿名/带 token 删除用）：`{"id":…,"delete_key":"…"}`（已脱敏）。
- `.qoi` / `.webp` 实时转码可用（子代理已记，我未重复测体积）。
- 删除接口只吃 `POST /api/image/delete` + `{"ids":[...]}`，用 HTTP `DELETE` 方法会 404。
- 关键响应头（图片路由）：`Cross-Origin-Resource-Policy: cross-origin`、
  `Strict-Transport-Security: max-age=15552000`、`Cache-Control: max-age=2592000`。

## 4. 对结论的影响

AC4 / AC5 判定不变（**通过**），两处更正只影响「接手知识」的准确度，
已同步更新 `research/handover-backlog.md` §8 与 `.trellis/spec/`（阶段 3.3）。
