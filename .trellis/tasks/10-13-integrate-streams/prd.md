# 集成三条战线并做最终验收

## 背景

「把剩下的交给团队」的三条战线已完成，各自在自己的 worktree/分支上交付：

| 战线 | 分支 | 提交 | 交付内容 |
|---|---|---:|---|
| prs-stream | `absorb/upstream-prs` | 3 | #128 默认 PNG（含 migration）、#115 `POST /api/image/list/all`、#129 SVG 支持（含 sanitize + CSP） |
| bugs-stream | `fix/known-bugs` | 5 | #107 超像素 400（`PICSUR_MAX_IMAGE_PIXELS`）、#112 剪贴板降级、删除后 404+no-store、`/i/meta` no-store、spec+回归脚本 |
| i18n-stream | `feat/i18n-zh` | 1 | #130 中文界面（自研 I18nService，无新运行时依赖） |

## 目标

把三条分支合回 master，解决冲突，并做**端到端最终验收**——验收对象是「三条线的能力**同时存在**」。

## 范围

**In**：合并与冲突解决；依赖安全复测；镜像重建与容器内验收；新能力逐项实测；spec 合并去重；提交与推送。
**Out**：不新增功能；不重构；不处理各战线报告里明确列为「遗留」的事项（除阻塞项）。

## 约束

- 合并顺序：`absorb/upstream-prs` → `fix/known-bugs` → `feat/i18n-zh`（冲突以「能力不退化 + 我们的基线」为准）。
- 构建/装依赖**必须 Node 20 + pnpm 9.6.0**。
- 新依赖（`dompurify`/`is-svg`/`jsdom`/`svgo`）必须过安全复测，否则不合并。
- 不 push 前必须跑完 check 子代理复核。

## 验收标准

- [ ] AC1 三条分支都已合入 master，`git log` 可见各自提交，冲突解决后**三方能力都在**。
- [ ] AC2 三包构建通过（shared → backend → frontend）。
- [ ] AC3 `pnpm audit --prod` 仍为 **0**（新依赖不得引入告警）；若引入，修掉或明确记录并回退相应依赖。
- [ ] AC4 镜像重建 + 容器内 **7 种格式**（png/qoi/webp/avif/jxl/jp2/heif）全部 200。
- [ ] AC5 新能力端到端实测：默认 PNG · `list/all` · SVG 上传/取回/安全头 · 中文界面 · 删除后 404+no-store · 超像素 400。
- [ ] AC6 既有库兼容：真 `picsur` 库启动一次，migration 7 → 8 且只新增一条，既有图片仍可取回。
- [ ] AC7 `trellis-check` 复核无阻塞问题。
- [ ] AC8 spec 合并去重后提交（带 `[task:10-13-integrate-streams]` 锚点）并 push 到 `zhemed/picsur`。

## 风险

| 风险 | 应对 |
|---|---|
| `view.component.ts` 冲突（SVG vs i18n） | 保留两边：SVG 分支逻辑 + i18n 文案注入 |
| 新依赖（尤其 `jsdom`）引入告警或体积膨胀 | AC3 强制复测；必要时改用更轻的 DOM 实现 |
| 三条线都改过 image 管线 | 合并后必须跑 `support/regression-image-api.sh`（bugs 线提供的 34 项断言） |
| 既有库 migration 语义变化 | 真库只读对账：条数 + 逐行 name/timestamp |
