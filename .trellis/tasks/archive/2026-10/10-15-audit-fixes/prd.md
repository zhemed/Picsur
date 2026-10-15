# 修复审计发现（四线并行 + Lead 质检）

## 来源

`10-15-full-audit`（A 后端 / B 前端 / C 运维供应链 / D 对抗性真机）。跨线独立复现过的高危见下。

## 分区（写范围严格互斥）

### ① 后端安全与运行时 —— 负责人 `bugs-stream`
- **限流单位**：`PicsurLayers.module.ts` 全局 `ttl: 60` → `60_000`；`easy-throttle.decorator.ts` 的 ttl 按毫秒传（调用点语义保留"秒"）；**并查明为何 `EasyThrottle` 装饰器在 D 线实测完全没生效**（60 连击全 201）并修好。
- **`PICSUR_PRODUCTION` 双定义**：统一到 `HostConfigService.isProduction()`（`main.ts` 也要用），`synchronize` 改为显式开关（不再由 `!production` 推导）。
- **登录失败状态码**：`FT.Authentication` 200 → 401。
- **API key 明文日志**：`apikey.strategy.ts:34,40` 改成只打前缀/哈希，并限制长度、转义。
- **上传失败 4xx**：0 字节/非图片/超 `PICSUR_MAX_FILE_SIZE`/客户端中断 → 400/413 + 可读原因（不再 500）。
- **`/i/*` 限流与派生图上限**：去掉无上限的 `@SkipThrottle`（至少宽松限流）+ 每图派生数量/字节上限。
- **`/api/usage/report` 鉴权**：加 `SysPrefAdmin` 或改服务端主动上报。
- **ShareX 删除**：匿名带正确 `delete_key` 应可删（对齐 guest 权限表与 spec §2）。
- 派生图 `last_read` 判断写反、`list/all` 无分页、类级权限并集、mutex key 缺 imageId。
- **文件范围**：`backend/src/**`、`shared/src/**`。**不含** `backend/src/managers/update/**`（归 ④）。

### ② 前端 —— 负责人 `i18n-stream`
权限服务兜底改 `[]` + 守卫失败路径超时；object URL 释放；恢复兼容性检查；view 页"原图"随语言重翻；4 个死 key；webmanifest `lang`；生成 HTML 片段转义 `file_name`；`image.service.ts:120` 改用 i18n key。
**文件范围**：`frontend/src/**`（**不含 `frontend/package.json`**，依赖搬迁归 ③）。

### ③ 运维/供应链/文档 —— 负责人 `installer`
前端运行时依赖从 `devDependencies` 搬到 `dependencies`（让 prod 审计口径真正覆盖浏览器产物）；CI 触发/`:latest` 只在 tag 事件推；`.gitignore` 加 dump 规则；文档与实现四处对齐（ALLOW_SELF_UPDATE 默认值、"没有任何挂载"、版本行 0.6.x→0.7.8、`PICSUR_UPDATE_TAG` 对 all-in-one 被忽略）；子包 `license` 统一 `AGPL-3.0-or-later`；`verify-published-image.sh` 迁移数不再硬编码；`install.sh` 特权差异检查与 `.env` 权限告警；`release-local.sh` 的 `:latest` 回退与 tag↔commit 校验。
**文件范围**：根配置、`frontend/package.json`、`support/**`、`.github/**`、`install.sh`、`Dockerfile*`、`README.md`、`docs/**`、`.env.example`。

### ④ 自升级健壮性 —— 负责人 `upgrade-panel`
helper 中途死亡 → 启动自愈（扫 `-prev-`/`-new-` 残留并恢复）或提供一次性恢复入口；`lastUpdate` 只统计自身容器的 helper（按 label 值=自身容器 id）；可复制升级命令回显真实主机端口与重启策略。
**文件范围**：`backend/src/managers/update/**` 与 helper 入口脚本。

## Lead 质检（本任务的验收）

- 每线修完后，Lead 用**审计报告里的原始复现命令**独立验证（不接受"应该好了"）。
- 全量：三包构建（Node 20 + pnpm 9.6.0）、34 项镜像回归、`pnpm audit --prod`（后端口径 0）、版本与 tag 一致性。
- 检查各线**未越界改别人文件**（`git diff --stat` 比对范围）。

## 验收标准

- [ ] AC1 四线各自修复完成并给出"复现命令 → 修复前后对比"。
- [ ] AC2 至少 6 条高危/中危由 Lead 独立复现确认已修。
- [ ] AC3 回归全绿；无越界改动；发 0.7.9 并在本机实例上验证面板升级仍可用。
