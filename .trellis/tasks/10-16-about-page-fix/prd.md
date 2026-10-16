# 修复「关于与升级」页面状态机

## 现象

管理员打开「关于与升级」：`最新版本` 显示「未知」、提示停在「正在检查更新…」、并显示「面板内升级未启用」
与手动升级命令；但后端 `POST /api/system/update/check` 实测返回 `current=0.8.0 latest=0.8.0 updateAvailable=false selfUpdateEnabled=true`。
页面底部显示 `V0.8.0`（bundle 是新的，排除缓存）。

## 判定

前端检测更新链路（`api.service.ts` 的响应解析 + `info.service.ts` 语义）在 0.8.0 合并后出现回归：
请求未成功落到 UI 状态，既没有 `latest` 也没有 `selfUpdateEnabled`，于是显示兜底文案且 loading 永不清除。

## 验收

- [ ] AC1 管理员的「关于」页在**后端正常**时显示 当前/最新版本 与「已是最新版本」或可用按钮，且 loading 会结束。
- [ ] AC2 **后端异常/超时**时不再假称"未启用"或永久"正在检查"，给出可读原因与「检查更新」重试。
- [ ] AC3 给出复现步骤与修复前后截图/DOM 证据（本机 8080 实例即可复现）。
- [ ] AC4 三包构建通过；修复经验写进 spec。
