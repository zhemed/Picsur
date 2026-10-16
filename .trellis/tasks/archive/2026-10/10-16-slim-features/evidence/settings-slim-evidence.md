# ③ 系统设置精简 —— 实施与验证证据（2026-10-16）

分支 `feat/slim-features`，实施者 upgrade-panel。页面：`/settings/system`（8080 常驻实例未参与，验证跑在 8095）。

## 1. 结果：12 项 → 5 项

保留（继续在界面暴露）：`host_override`、`remove_derivatives_after`、`allow_editing`、`tracking_url`、`tracking_id`
（`shared/src/dto/sys-preferences.enum.ts` 的 `SysPreferenceExposedList`，前端 `sys-pref.i18n.ts` 只映射这 5 个）。

截图：`settings-zh.png` / `settings-en.png`（各 3 组、5 个输入框，页首一句"由环境变量管理"的说明）。

## 2. 固定为默认值、从界面撤掉（保留枚举/默认值，API 拒绝读写）

`jwt_secret`(env 或随机)、`jwt_expires_in`(7d 或 env)、`bcrypt_strength`(10)、
`conversion_time_limit`(15s)、`conversion_memory_limit`(512)。

```
GET  /api/pref/sys                     → total: 5（不再包含 jwt_secret，密钥不再回显）
GET  /api/pref/sys/jwt_secret          → 400 'jwt_secret' is fixed and can not be changed from the panel. Set PICSUR_JWT_SECRET instead
POST /api/pref/sys/jwt_secret          → 400（同上）
POST /api/pref/sys/bcrypt_strength 42  → 400 'bcrypt_strength' is fixed ... Change it through the environment or the database
```

## 3. 删除 2 项（枚举/默认值/校验器/i18n 全清）

`enable_tracking`（没有任何读取点）、`enable_telemetry`（上报端点为空）。
`POST /api/pref/sys/enable_tracking|enable_telemetry` → 400 `Invalid preference key`；`usage.*` 里删掉了 `getMetricsEnabled()`，
上报口径只剩 `ReportUrl` 是否为空。

## 4. 顺手修

- `Ackee trackign website ID` → `Ackee tracking website ID`（en.json；zh 本来就是对的）。
- `allow_editing=false` 时页面在该项下方显示琥珀色明确提示（`settings-en-allow-editing-off.png`），
  说明"带参数的取图请求会被静默按原图返回、第三方工具看起来没反应"。
- i18n：en/zh 同步、无孤儿 key（脚本核对：`systemPreferences` 14 条→全部被引用；en/zh 键集一致）。
- BCryptStrength 不再有入口 ⇒ 按用户要求无需加校验上限。

## 5. 五项"改了确实生效"实测（8095 实例，独立库 picsur_slim）

| 项 | 操作 | 观察 |
|---|---|---|
| `host_override` | POST `https://example.com` | `GET /api/info` → `host_override=https://example.com`（立即生效） |
| `allow_editing` | true → false → true，各上传一张 800×600 新图后取 `/i/<id>.png?height=10` | 13×10（真转换）→ **800×600（原图，静默忽略）** → 13×10 |
| `remove_derivatives_after` | 设 `1m`，生成 6 个 derivative | 60s cron：`[ImageManagerModule] Cleaned up 6 derivatives`，`e_image_derivative_backend` 行数 6 → 0 |

## 6. 对比度探针（`support/visual-contrast-probe.cjs`）

```
node support/visual-contrast-probe.cjs --base=http://127.0.0.1:8095 --token=<jwt> --out=/tmp/slim-contrast
PASS: every page is readable          # 13 条路由 × zh/en = 26 个页面条目，问题页 0
/settings/system(zh|en): lowContrast=0 lightPanels=0 rendered=true stuckLoading=false
```

## 7. spec

- `build-and-deploy.md` 新增 §3.1「系统偏好只暴露真正需要在线改的项」（判据 + 守门位置 + 死设置处理）。
- §11「轮换凭据」里那条 `POST /api/pref/sys/jwt_secret` 已失效，改为 env+重启 或 直接改库。
