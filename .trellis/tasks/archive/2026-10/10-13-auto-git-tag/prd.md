# 补齐 git tag + 发布脚本自动打 tag

## 根因

- 面板「关于」的版本检测读 GitHub **git tag**（`.../tags`）。
- CI 时代 tag 触发发布 → git tag 天然存在；改成**本地发布**后，脚本只推容器标签
  （`:<版本>`、`:v<版本>`、`:<主.次>`、`:latest`、`:allinone`），**从未创建/推送 git tag**。
- 因此最后一个 git tag 停在 `v0.7.2`；0.7.6 > 0.7.2 → 检测结果 "latest=0.7.2"、
  `updateAvailable=false` → 面板显示「当前已是最新版本」（判定逻辑正确，数据源滞后）。

## 改动

1. 补齐缺失的 git tag：`v0.7.3`、`v0.7.4`、`v0.7.5`、`v0.7.6`（各自指向对应提交）。
2. `support/release-local.sh`：构建推送成功后**自动创建并推送 `v<版本>` git tag**；
   若该 tag 已存在则跳过并提示（不覆盖）。
3. 不发布新版本（无需 0.7.7）。

## 验收标准

- [ ] AC1 `git ls-remote --tags origin` 可见 v0.7.3~v0.7.6。
- [ ] AC2 重启常驻实例（清 1 小时检测缓存）后，`POST /api/system/update/check` 返回
      `latest = 0.7.6`、`updateAvailable = false`；面板显示「当前已是最新版本」与最新版本 0.7.6 一致。
- [ ] AC3 脚本改动经 shell 语法检查 + 干跑演练（tag 已存在时应跳过而不是报错）。
- [ ] AC4 提交推送；工作树干净。
