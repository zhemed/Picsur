# 仓库清理

- master 加保护：禁强推/禁删除，但不要求 PR/状态检查（发布流程是直推 master）。
- 关闭 Dependabot 的 12 个 PR 并删其分支；删掉已合并的临时远端分支。
- 移除 .github/dependabot.yml（避免它反复重开 PR）。
