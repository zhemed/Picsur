# 吸收上游未合并 PR（#128 默认 PNG + #115 图片列表 + #129 SVG）

## 背景

上游 `CaramelFur/Picsur` 已停维护，但有三个社区 PR 从未合入（都基于上游 master 的最后状态）。
它们的实现思路对我们仍然有价值，且这是**最后一次取用上游**。

| PR | 内容 | 规模 | 上游状态 |
|---|---|---|---|
| **#128** | 上传后默认展示/输出格式改为 PNG（对应 issue #111） | +55/-19，9 文件，**含一个 migration** | MERGEABLE/CLEAN |
| **#115** | 新增「列出全部图片（不分页）」API | +89/-0，5 文件 | MERGEABLE/CLEAN |
| **#129** | SVG 支持（对应 issue #63） | +600/-83，11 文件 | MERGEABLE/CLEAN |

取用方式（**不要**重新添加 upstream remote）：
```bash
git fetch https://github.com/CaramelFur/Picsur.git pull/128/head:pr-128
```
随后按需 `git merge pr-128` 或按 PR 意图手工实现（我们的基线已升级到 Nest 12 / Fastify 5 / 0.6.0，
直接 merge 大概率有冲突，按意图重写是允许的）。

## 目标

三个 PR 的能力在本仓库可用，且不破坏现有功能与数据。

## 范围

**In**：按 #128 → #115 → #129 的顺序逐个吸收；每个 PR 独立构建验证；解决冲突时以**我们的基线**为准。
**Out**：不做 PR 之外的"顺手优化"；不动 i18n（另一条战线）；不动 bug 修复（另一条战线）。

## 约束

- 装依赖/构建**必须 Node 20**（`export PATH=/root/picsur/.run/node20/bin:$PATH`）+ pnpm 9.6.0。
- 在自己的 worktree 里工作（`.worktrees/prs`），不碰主工作区与其他 worktree。
- 提交信息要**注明来源 PR 与原作者**（`Refs #128 by <作者>`），保留署名。
- 不 push（Lead 集成后统一 push）；不重新添加 upstream remote。
- `#128` 带的 migration 必须在**既有数据库**上可重复安全执行（migration 只跑一次，`migrations` 表为准）。

## 验收标准

- [ ] AC1 `#128`：上传后默认输出格式为 PNG（`/i/<id>.png` 与默认展示一致），且新 migration 在既有库上成功执行、不重复。
- [ ] AC2 `#115`：新 API 可用（列出当前用户的全部图片，不分页），返回结构符合 `shared/` 里的 DTO。
- [ ] AC3 `#129`：上传 SVG 成功；可取回；不再因 SVG 报错（上游 issue #63 的行为）。
- [ ] AC4 三包构建通过（shared → backend → frontend）。
- [ ] AC5 既有数据不丢：升级前建的库启动后 `migrations` 表只多出必要的一行、既有图片仍可取回。
- [ ] AC6 冒烟 5 步（info/登录/上传/取回/删除）+ 7 种格式在**容器或宿主实例**上通过。
- [ ] AC7 每个 PR 一个独立提交，带 `[task:10-13-absorb-upstream-prs]` 锚点与来源署名。

## 风险

| 风险 | 应对 |
|---|---|
| 直接 merge 冲突多 | 允许按 PR 意图手工实现，但要在提交信息里说明与原 PR 的差异 |
| `#128` 的 migration 与既有 7 条冲突 | 先 `SELECT * FROM migrations` 对账，确保只新增一条 |
| `#129` 与 i18n 战线的前端改动重叠 | 各自 worktree 独立分支，冲突由 Lead 集成时解决 |
