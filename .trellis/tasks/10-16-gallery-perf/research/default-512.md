# `/i/<id>`（无扩展名）那个「512」的事实记录

> 调查时间：2026-10-16 · 代码基线 `master` @ `1d00ac0` · **只读调查，未改任何代码/测试**
> 起因：Lead 实测 `800×600 PNG` → `/i/<id>.png` 得 800×600，`/i/<id>` 得 **512×361**，
> 推断为「不带参数时有一个 512 的默认缩放值」。**本文件记录查证结果。**

---

## 结论（先说结果）

**不存在「默认缩到 512」这个默认值。** 512×361 是 **404 品牌占位图**
`branding/messages/notfound.png` 的尺寸 —— `/i/<id>`（无扩展名）对普通图片返回的是
**404 + 占位图**，不是被缩小的原图。

缺省参数的真实语义是：**不缩放**（原尺寸）。

---

## 1. 「512」的唯一来源：品牌占位图

| 事实 | 证据 |
|---|---|
| `branding/messages/notfound.png` 的尺寸是 **512×361**（33,516 字节） | 直接读 PNG IHDR：`width=512, height=361` |
| 任何 `/i/*` 的 404 都返回这个文件当正文 | `backend/src/util/branding.ts` — `GetBrandMessage()` 读 `<BrandingPath>/messages/<name>.png` |
| 实测：`GET /i/<不存在的 uuid>` → **404**、`image/png`、**33516 字节** | 请求实际发出，字节数与 `notfound.png` 完全一致 |

`800×600 → 512×361` 的「体积约 7%」也与此吻合：占位图只有 33 KB。
**两者尺寸不成比例（512/800=0.64，361/600=0.60），本来就不是同一张图的缩放结果。**

## 2. 路由如何分流（`file:line`）

1. `backend/src/routes/image/image.controller.ts:93` — `@Get(':id')` → `getImage()`
2. `backend/src/decorators/image-id/image-full-id.pipe.ts:15-27` — 按 `.` 切分 id：
   - **1 段**（`/i/<id>`）→ `{ variant: 'original' }`
   - **2 段**（`/i/<id>.png`）→ `{ variant: 'normal', filetype }`
3. `image.controller.ts:102-110` — `variant === ORIGINAL` → `getOriginalDownload()`；
   否则走 `imagesService.getConverted(id, filetype, params)`（派生图路径）
4. `image.controller.ts:190-202` — `getOriginalDownload()`：
   取「保留的原图」（`getOriginal`）；没有就取 master，**只有 SVG master 才回退**，
   普通图**原样返回那个 NotFound**（`if (master.filetype !== SVG) return original;`）
5. `image.controller.ts:123-137` — 捕获 NotFound → `setNotFoundHeaders()`
   （`image.controller.ts:147-150`：`res.status(404)` + `Cache-Control: no-store`）
   + `GetBrandMessage(NotFound)` 作为正文

**所以「无扩展名」这条路是「下载原图」语义，不是「缩略图」语义**；
没有保留原图的普通上传 → 404 + 占位图。

## 3. 真正的默认值：没有默认

- `shared/src/dto/api/image.dto.ts:8-24` — `ImageRequestParamsSchema` 全部字段可选
  （末尾 `.partial()`），**没有任何 `.default()`**；`width`/`height` 未给时是 `undefined`。
- `backend/src/managers/image/image.service.ts:185-186` — `editOptions` 为空即 `{}`，
  `wantsEdits=false`。
- `backend/src/managers/image/image-converter.service.ts:111` — `if (options.height || options.width)`
  才执行 resize；**两者都缺 ⇒ 完全不缩放 ⇒ 输出 master 原尺寸**。
- **没有任何 env / 系统偏好 / 配置项**承载尺寸默认值：
  `backend/src/config/config.static.ts` 里没有 width/height 相关键。
  （`SysPreference.ConversionMemoryLimit=512` 是 **MB 内存上限**，与本问题无关 —— 容易被字符串搜到而误认。）

**宽高与 `shrinkonly`、等比缩放的交互**（`image-converter.service.ts:111-130`）：
- 只给一个维度 → `fit: 'inside'`（等比）
- 两个都给 → `fit: 'fill'`（**拉伸，不保比例**）
- `withoutEnlargement: options.shrinkonly`（`shrinkonly=yes` 时不放大）
- 都不给 → 不缩放，`shrinkonly` 无意义

## 4. 谁依赖它（消费者清单）

| 消费者 | 位置 | 用的 URL | 是否依赖「无扩展名 404」 |
|---|---|---|---|
| 图库缩略图 | `frontend/src/app/routes/images/images.component.ts:269` | `/i/<id>.qoi?width=N&shrinkonly=yes` | 否（显式带参） |
| view 页预览 | `frontend/src/app/routes/view/view.component.ts:100` | `/i/<id>.<ext>?width=<屏宽×DPR>&shrinkonly=yes` | 否 |
| **分享/嵌入链接**（Markdown/HTML/BBCode） | `frontend/src/app/services/api/image.service.ts:245-251` → `GetImageURL()` | `/i/<id>.<ext>`（**无参数**） | 否（但**拿的是原尺寸**） |
| 下载 / 系统分享 | `frontend/src/app/routes/view/view-speeddial/view-speeddial.component.ts:100,108` | `/i/<id>.<ext>`（无参数） | 否 |
| 自定义尺寸对话框 | `frontend/src/app/routes/view/customize-dialog/customize-dialog.component.ts:62` | `GetImageURLCustomized(...)` | 否 |
| 外部热链接 / `<img>` | 第三方 | `/i/<id>.<ext>` | 否 |

**关键事实**：分享与下载走的都是 `GetImageURL()` = `/i/<id>.<ext>` **不带参数**，
而按 §3 这**就是原尺寸**。前端没有一个地方依赖「无扩展名返回小图」。
UI 里「无扩展名」这种链接只在 `hasOriginal` 时才提供。

## 5. 已存在的依赖 / 会受影响的地方（事实，非建议）

- **回归脚本**：`support/regression-image-api.sh:153` 断言
  `deleted /i/<id> (no ext) -> 404`。改「无扩展名」的行为会影响这条。
- **spec 已文档化**（同一份文件里有两处，措辞一致）：
  - `.trellis/spec/picsur-backend/backend/image-api-contracts.md:69` —
    「`/i/<id>`（无扩展名）依然返回品牌占位图，这一点实测确认过」
  - 同文件 §3.4 表格 — 「有保留原图 → 200 原图；SVG master → 200 净化 SVG；
    **没有保留原图的普通图 → 404 + no-store（正文仍是品牌占位图 `notfound.png`）**」
- 无任何测试/断言依赖「无扩展名返回缩略图」（因为它本来就不返回图片）。

## 6. ⚠️ 与 `1d00ac0` 新写入 spec 的冲突（必须修）

`1d00ac0 docs(spec): record what the image routes actually return` 在
`image-api-contracts.md` 末尾新增了「取图与画质（2026-10-17 实测结案）」表，其中一行写：

> `/i/<id>`（**不带参数/扩展名**） | 默认会**缩到 512 宽**（例：800×600 → 512×361，体积约 7%）

**这一行与事实不符，且与同一文件 §3.4 的既有正确描述自相矛盾：**
- 不存在这个默认值（§1、§3 的 `file:line` 证据）；
- 512×361 是 404 占位图的尺寸；
- §3.4 早就写对了：「没有保留原图的普通图 → 404 + 正文是品牌占位图」。

建议把该行改成「**无扩展名 = 下载原图语义；无保留原图时 404 + 占位图（512×361）**，
与尺寸默认值无关」，否则后续会话会去「优化」一个并不存在的默认值。
（**本文件只做记录，未改动 spec 与任何代码。**）

## 7. 实测记录（本次）

```
GET /i/00000000-0000-4000-8000-000000000000   → 404  image/png  33516 bytes
branding/messages/notfound.png                → 512×361, 33516 bytes（PNG IHDR 直读）
```

> 未再复跑 Lead 的 800×600 上传用例（收到「不用再深挖」指示后停止）；
> 但占位图尺寸（512×361）与字节数（33516）双双吻合，加上 §2 的代码路径，
> 足以判定 Lead 观测到的 512×361 就是这个 404 占位图。
