# 执行计划：脱离上游（仓库切换 + 去上游化）

> 前置：用户已授权 GitHub 访问（建仓库/改名/推送）与容器镜像仓库。
> 环境：装依赖/构建**必须 Node 20**（`export PATH=/root/picsur/.run/node20/bin:$PATH`）+ pnpm 9.6.0。
> **本文件在收尾时按实际执行结果回填。**

## 阶段 0 — 备份（回滚点）✅

- [x] 0.1 `docker tag zhemed/picsur:local zhemed/picsur:pre-detach`
- [x] 0.2 切换前状态记录 `research/before.md`（remote、HEAD）

## 阶段 1 — 仓库切换（AC1）✅

- [x] 1.1 原 fork 改名留档：`zhemed/Picsur` → **`zhemed/Picsur-fork-archive`**
- [x] 1.2 新建非 fork 仓库：**`zhemed/picsur`**（公开，`fork=false`），已加 topics
- [x] 1.3 `origin` → 新仓库；`upstream` remote 已移除
- [x] 1.4 `git push -u origin master`（全历史已推送）
- [x] 1.5 旧 fork 追加「已归档」描述并 `gh repo archive`（只读留档，可逆）

## 阶段 2 — 遥测断链（AC2/AC3）✅

- [x] 2.1 `ReportUrl` 置空（并留注释说明「想接自己的统计后端就改这里」）
- [x] 2.2 `usage.service.ts` 的 `execute()` 增加「端点为空则跳过」（代码层兜底）
- [x] 2.3 backend 重新构建通过

## 阶段 3 — 元数据与版本线（AC4）✅

- [x] 3.1 4 个 `package.json`：`version` → `0.6.0`、`repository` → 新仓库、`author` → zhemed
- [x] 3.2 `pnpm install`（lockfile 无需变更：workspace 版本不进 lockfile）

## 阶段 4 — 品牌与文档（AC5/AC6）✅

- [x] 4.1 页脚：作者/源码链接改为 zhemed 与本仓库（保留 Picsur 品牌与版式）
- [x] 4.2 `index.html`：删 `og:url` 与上游域名 `og:image`；`author` → zhemed
- [x] 4.3 README 重写为自维护版（构建/部署/配置/API/状态），**保留 AGPL 出处声明**
- [x] 4.4 删除 `.github/FUNDING.yml`（原指向上游作者）
- [x] 4.5 扫描：白名单之外零命中（仅 README 两行出处声明 + LICENSE 版权行）

## 阶段 5 — 构建与容器回归（AC5/AC7）✅

- [x] 5.1 三包构建通过（shared 2s / backend 3s / frontend 19s）
- [x] 5.2 镜像重建（libvips 层命中缓存，约 1 分钟）+ `docker compose up -d`
- [x] 5.3 冒烟：`/api/info` **version = 0.6.0**、登录 201、上传 201、**7 种格式全 200**、删除 201
- [x] 5.4 SPA 深链 `/` `/images` `/settings` 全 `200 text/html`
- [x] 5.5 前端产物零上游字样（`caramelfur` 命中 0 个文件；`zhemed` 命中 2 个）

## 阶段 6 — 收尾（AC8）

- [x] 6.1 `trellis-check` 子代理全量复核（AC1–AC8 + 白名单 + 遥测 + 密钥）
- [x] 6.2 spec：`build-and-deploy.md` 新增 **§9 仓库来源与发布口径**（含白名单与检查命令）
- [x] 6.3 AGENTS.md 更新仓库地址与「非 fork」事实
- [ ] 6.4 提交（带 `[task:10-13-detach-upstream]` 锚点）并 push 到**新 origin**

## 审查门

| 门 | 条件 | 结果 |
|---|---|---|
| G1 | 新仓库 `fork=false`、origin 已切换、upstream 已移除 | ✅ |
| G2 | 遥测在 `enable_telemetry=true` 下也不出网 | ✅（0 条发送痕迹，仅到 Postgres 的连接） |
| G3 | 冒烟 + 7 格式全绿，`/api/info` version = 0.6.0 | ✅ |
| G4 | 白名单之外无上游字样；密钥零入库 | 待 check 结论 |

## 遗留 / 后续

- **T1–T4 吸收上游未合并 PR**（#128/#115/#129/#130）——「最后一次取用上游」，之后与上游再无关系。
- T2 的 bug 修（#107 像素上限、#112 API key 复制、删除后仍 200 + 30 天缓存）。
- T5 存储后端（本地文件 / S3）、T6 Angular 大版本升级。
- `backend`/`frontend`/`shared` 的 `license` 字段仍是上游遗留的 `GPL-3.0`（与根 `LICENSE` 的 AGPL-3.0 不一致）：
  属许可表述问题，本任务按「不动许可」处理，仅记录。
