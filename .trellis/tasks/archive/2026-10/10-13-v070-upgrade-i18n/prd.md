# 0.7.0：在线升级按钮 + 默认简体中文 + 补齐翻译

## 现状（已勘察）

- 默认语言写死在 `frontend/src/app/i18n/i18n.service.ts` 的 `fallbackLanguage = 'en'`。
- **词典本身是齐的**：en/zh 各 265 个 key，双向无缺；所以「补翻译」= 处理**没走 i18n 的硬编码文案**。
- 已确认的硬编码：页脚 `Made with` / `Source Code`；Material 分页器内置文案（`Items per page:`）；
  ShareX 导出内容；后端返回的文本（原样透传）。
- 版本号 `0.6.0` 在四个 `package.json` 里，本次升到 **`0.7.0`**。

## 战线 A：默认中文 + 补齐翻译（worktree `.worktrees/i18n`）

1. 默认语言改为**简体中文**（首次访问；用户显式切过英文则尊重其选择；`documentElement.lang` 同步）。
2. 把剩余硬编码文案接入 i18n，至少覆盖：
   - 页脚品牌行（`Made with ♥ by zhemed` / `Source Code`）
   - Material 分页器内置文案（用 `MatPaginatorIntl` 定制）
   - 截图/弹窗/表单里其余硬编码英文（自查 `grep` 模板与 TS 里的英文字面量）
   - ShareX 导出内容（能翻译就翻，不能就明确不翻并在报告里说明）
3. en/zh **两份词典保持一一对应**；不允许出现裸 key。
4. 验收：默认打开是中文；切英文再切回中文都不残留；刷新保持；`bw` 截图 + `bw text` 抓中文片段。

## 战线 B：在线升级（worktree `.worktrees/upgrade`）

1. **版本检测**（默认开启，可 `PICSUR_UPDATE_CHECK=false` 关闭）：后端查本仓库的 GitHub tags/releases
   （`api.github.com`），带缓存（≥1 小时）、超时与离线降级；绝不发送任何额外数据。
2. **管理接口**：`POST /api/system/update/check`（admin）→ `{current, latest, updateAvailable, selfUpdateEnabled, command}`。
3. **自升级（可选，默认关闭）**：显式 `PICSUR_ALLOW_SELF_UPDATE=true` 才启用；
   通过挂载的 `/var/run/docker.sock` 用 Docker HTTP API（**不引入新依赖**，用 fetch + unix socket）：
   拉取新镜像 → 用同配置重建自身容器 → 启动 → 删除旧容器（Watchtower 同款做法）。
   未启用时接口返回 `selfUpdateEnabled:false` 并给出**可复制的升级命令**。
4. **前端**：系统设置页新增「关于/升级」区块：显示当前版本、最新版本、检查按钮、升级按钮
   （禁用态 + 原因提示：未开启自升级时显示命令）。
5. 验收：检测在有网/断网两种情况都不报错崩；自升级路径在**独立测试容器**上真跑一次
   （自己拉自己、重建成新 tag、`/api/info` 变成新版本）；未开启时按钮给出命令不报错。

## 硬约束（两条战线共同）

- 各自 worktree，互不碰、也不碰主工作区；端口：A 用 **8081**、B 用 **8082**（不得占 8080）。
- 构建/装依赖必须 Node 20 + pnpm 9.6.0。
- 不 push；提交带 `[task:10-13-v070-upgrade-i18n]` 锚点。
- 不改 `backend/src/managers/usage/**`（遥测已定稿）；不引入上游依赖。
- 新依赖要过 `pnpm audit --prod --registry https://registry.npmjs.org/`（必须 0）。

## 验收标准（整体，Lead 汇总）

- [ ] AC1 默认语言为简体中文，且 en/zh 可自由切换、刷新保持、无裸 key。
- [ ] AC2 硬编码文案清单里的项目全部处理（或明确说明不处理的理由）。
- [ ] AC3 升级检测接口可用（admin），离线/超时不崩，有缓存。
- [ ] AC4 自升级在测试容器上真跑通一次；默认关闭；关闭时给出命令。
- [ ] AC5 三包构建通过、审计 0、34 项回归通过（容器内 7 格式）。
- [ ] AC6 版本号 0.7.0 同步四处；打 tag `v0.7.0` → CI 发布 `:0.7.0/:0.7/:latest/:allinone`；
      拉发布镜像实测新版能力（中文默认 + 升级按钮可见）。
- [ ] AC7 spec/README/手册同步（新环境变量、升级路径与安全前提）。
