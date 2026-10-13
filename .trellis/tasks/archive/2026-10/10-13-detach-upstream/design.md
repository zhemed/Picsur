# 技术设计：脱离上游

## 1. 仓库切换（GitHub 不支持自助解除 fork 关系）

GitHub 的 fork 关系无法自助解除，只能「新建一个非 fork 仓库 + 迁过去」。
同时仓库名**大小写不敏感**：现有 fork 叫 `zhemed/Picsur`，会挡住 `zhemed/picsur`，所以顺序必须是：

```
1) 原 fork 改名留档：  zhemed/Picsur  ->  zhemed/Picsur-fork-archive
2) 新建非 fork 仓库：  gh repo create zhemed/picsur --public -d "..."
3) 重指本地 remote：   git remote set-url origin https://github.com/zhemed/picsur.git
                       git remote remove upstream
4) 推送：              git push -u origin master
```

**验证**：`gh api repos/zhemed/picsur --jq '.fork'` 必须是 `false`；
`gh api repos/zhemed/Picsur-fork-archive --jq '.fork'` 仍是 `true`（留档，不影响我们）。

**回滚**：`git remote set-url origin <fork-url>` 即可回到旧的；新仓库可删。

## 2. 遥测：在代码层断掉，而不是只靠 DB 设置

现状（`backend/src/managers/usage/usage.service.ts`）：
`execute()` 只看 DB 首选项 `enable_telemetry`，然后把主机名/CPU/内存/用户数/图片数
POST 到 `ReportUrl + /api/install/create|update`，`ReportUrl = 'https://metrics.picsur.org'`。

**为什么不能只靠 DB 设置**：DB 设置是**数据**，重装/换库/别人 clone 后重新部署都会回到默认 `true`
（`preference-defaults.service.ts` 里 `EnableTelemetry: true`），等于上游依赖仍然"潜伏"。

最小改法（两处，不删模块、不删开关）：

```ts
// config.static.ts —— 不再指向任何第三方端点
export const ReportUrl = '';

// usage.service.ts —— 端点为空就不上报（代码层兜底）
public async execute() {
  if (!(await this.usageConfig.getMetricsEnabled())) return;
  if (!(await this.usageConfig.getMetricsUrl())) return;   // ← 新增
  ...
}
```

保留 `enable_telemetry` 首选项与模块本身：将来若要接**自己的**统计后端，改 `ReportUrl` 即可。

## 3. 元数据与版本线

| 文件 | 字段 | 改成 |
|---|---|---|
| 根 / backend / frontend / shared `package.json` | `version` | `0.6.0`（自有版本线的起点，与上游 0.5.7 明确分家） |
| 同上 | `repository` | `https://github.com/zhemed/picsur` |
| backend / frontend / shared | `author` | `zhemed` |
| backend / frontend | `license: GPL-3.0` | **保持不动**（与根 LICENSE 的 AGPL-3.0 不一致是上游遗留，改它属许可决策，不在本任务；仅记录） |

版本号影响面：`/api/info` 的 `version`、前端页脚、镜像 tag（人为指定）。
`0.6.0` 也顺带修正了「裸 node 起服务时 version 显示 0.0.0」之外的语义混淆。

## 4. 品牌边界（保留 Picsur，去掉上游指向）

| 位置 | 现在 | 改成 |
|---|---|---|
| `frontend/.../footer.component.html` | "Made with ♥ by Caramel"(caramelfur.dev) + "Source Code"(github.com/caramelfur/picsur) | 保留 Picsur 品牌与页脚结构，作者/源码链接指向本仓库（zhemed/picsur） |
| `frontend/src/index.html` | `og:url=https://picsur.org`、`og:image=https://picsur.org/...` | 删掉 `og:url`；`og:image` 改成本地相对资源（不再出现上游域名） |
| `README.md` | 上游全文（含 "NOT MAINTAINED"、demo、Discord 徽章、上游 issue 入口、上游镜像） | 重写：自维护说明 + 构建/部署（指向根 Dockerfile/compose）+ 许可与出处声明 |
| `.github/FUNDING.yml` | 捐给上游作者 | 删除 |
| `LICENSE` | AGPL-3.0 全文 | **不动**（合规底线） |

**许可合规**：AGPL 要求保留版权声明与许可全文；README 里保留一段
「Based on [CaramelFur/Picsur](https://github.com/CaramelFur/Picsur), AGPL-3.0」作为出处声明 ——
这是**合规声明**，不是运行时依赖，故列入 AC2 白名单。

## 5. AC2 的白名单（哪些文件允许出现上游字样）

| 文件 | 允许内容 |
|---|---|
| `LICENSE` | AGPL-3.0 全文（含上游版权行） |
| `README.md` | 出处声明段落（一句话 + 链接） |
| `.trellis/**` | 历史任务记录、本 spec 的来源说明（只读考古用途） |
| `frontend/src/index.html` | 无（必须清空） |
| 其余代码/配置 | 无 |

判定命令见 implement.md 阶段 4 的检查项。

## 6. 验证策略

1. **静态**：`grep -rn` 扫 `picsur.org|caramelfur` 并与白名单比对（AC2）。
2. **运行期**：临时把 DB 的 `enable_telemetry` 置 `true`，重启容器，观察日志**没有**出网请求与 WARN（AC3）。
3. **功能**：容器冒烟 5 步 + 7 种格式（AC7）。
4. **仓库**：`gh api` 验证 `fork=false`（AC1）。

## 7. 回滚

- 代码：`git revert`/`git checkout` 单文件即可，无数据库改动。
- 仓库：remote 指回旧 fork（改名后的 `Picsur-fork-archive`）或原 URL。
- 版本号：改回 `0.5.7`。
