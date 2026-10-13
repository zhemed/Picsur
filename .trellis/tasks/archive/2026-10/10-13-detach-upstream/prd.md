# 脱离上游（一）：仓库切换 + 去上游化改造

## 背景

- 上游 `CaramelFur/Picsur` 已停止维护；我们的代码一直挂在它的 fork 网络上、元数据仍指向上游。
- 用户定调：**完全自主**是目标；"先把能做的全做了"。
- 本轮实测代码/配置里共 **22 处上游指向**：`git remote upstream`、GitHub fork 关系、
  4 个 `package.json` 的 `repository`/`author`、`.github/FUNDING.yml`（捐给上游作者）、
  遥测端点 `https://metrics.picsur.org`、前端页脚两个上游链接、`index.html` 的 og 标签、README 全文。

## 目标

让这个图床在**仓库、代码、运行时**三个层面都不再依赖上游。

## 范围

**In**

1. **仓库层面**：新建非 fork 公开仓库 `zhemed/picsur`，代码迁过去；原 fork 改名留档；
   本地 `origin` 指向新仓库；移除 `upstream` remote。
2. **运行时**：移除指向上游 `metrics.picsur.org` 的遥测出网 —— 在**代码层**兜底
   （端点为空即跳过），不再只依赖 DB 设置。
3. **元数据**：4 个 `package.json` 的 `repository` / `author` / `version`（切到自有版本线 **0.6.0**）。
4. **前端**：页脚的上游作者与上游源码链接改为自有；`index.html` 的 `og:url` / `og:image` 去掉上游域名。
5. **文档**：README 重写为自维护版（保留 AGPL 与上游出处声明）；删除 `.github/FUNDING.yml`。
6. **spec**：把「来源与许可」「发布口径」写进仓库约定，供后续会话遵守。

**Out**

- 不改品牌名与 logo（用户已选：保留 Picsur 品牌）。
- 不做 T1–T4 的功能吸收（吸收上游 PR 是单独任务）。
- 不动 AGPL 许可、不删上游版权声明。
- 不改前端视觉与业务逻辑。

## 约束

- **AGPL-3.0 合规**：重写 README / 去掉链接时**必须保留**上游版权与出处声明；`LICENSE` 不动。
- 仓库切换后，所有提交与推送都到新 `origin`。
- 不删原 fork，只改名留档（保留历史与对照能力）。
- 除「遥测端点为空则跳过」外，不改业务逻辑。

## 验收标准

- [ ] AC1 新仓库 `zhemed/picsur` 存在、公开、**非 fork**（GitHub API 的 `fork=false`）；
      本地 `origin` 指向它；`upstream` remote 已移除。
- [ ] AC2 仓库内不再有**运行时**的上游指向（`picsur.org` / `caramelfur` / `metrics.picsur.org`）；
      仅允许出现在白名单里：`LICENSE`、README 的出处声明、`.trellis/` 下的历史任务记录。
- [ ] AC3 遥测：把 DB 的 `enable_telemetry` 置 true 服务也不会出网（端点为空即跳过），
      启动日志无 `UsageManagerModule` WARN。
- [ ] AC4 4 个 `package.json` 的 `version` 统一为 `0.6.0`；`repository` 指向新仓库、`author` 为 zhemed。
- [ ] AC5 前端构建通过；容器内 `/api/info` 的 `version` 显示 `0.6.0`。
- [ ] AC6 README 为自维护版：说明这是 zhemed 维护的 Picsur 分支、如何构建与部署、许可与出处。
- [ ] AC7 容器内冒烟通过（info / 登录 / 上传 / 7 种格式 / 删除），无功能回归。
- [ ] AC8 提交并 push 到**新 origin**。

## 风险

| 风险 | 应对 |
|---|---|
| GitHub 仓库名大小写不敏感 → `zhemed/Picsur`（fork）会挡住 `zhemed/picsur` | 先把 fork 改名，再建新仓库 |
| 改名会改 fork 的 URL | GitHub 保留重定向；本地 remote 显式改掉 |
| 去遥测被误判为「删功能」 | 用「端点为空则跳过」的最小改法，保留模块与开关 |
| 版本号跳到 0.6.0 会改变 `/api/info`、页脚、镜像标签 | 属预期，写进验收与记录 |
| README 重写时丢掉 AGPL 出处 | 强制保留「Based on CaramelFur/Picsur (AGPL-3.0)」段落，作为 AC |
