# admin 用户名无法修改

## 成因

0.10.6 修复"密码被权限 403 连带拒掉"时，Lead 的指令写过头了 ✗：让前端在 locked-perms 账号上**同时剔除 `permissions` 与 `username`** ✗ → 用户名编辑被静默丢弃 ✓。

## 待实测

后端是否允许改用户名（`UserUpdateRequest = EntityIDObjectSchema.merge(SimpleUserSchema.partial())` ✓ 结构上允许 ✓）：用 admin 的 token 发 `{id, username:"admin2"}` 看状态码；**改完立刻改回** ✓。

## 修法（取决于实测）

- 若**允许** ✓ → 前端只剔除 `permissions`，保留 `username` ✓；
- 若**不允许** ✗ → 前端把用户名字段**明确置灰并说明原因** ✓（不许静默忽略 ✗）。

## 验收

- [ ] UI 上能改用户名（或明确不可改 + 原因）✓；
- [ ] 改密码仍可 ✓、改权限仍 403 ✓（不回归 0.10.6 的修复 ✓）；
- [ ] 回归脚本补一条：admin 改用户名 → 期望结果 ✓；
- [ ] 三包构建 + 两个回归全绿 ✓。
