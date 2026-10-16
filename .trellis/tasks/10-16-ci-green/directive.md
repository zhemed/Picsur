# 用户指令原文（directive）

> **新任务：CI 一直红，查实并修** —— 用户在 GitHub 上看到最新提交旁有红叉 ✗。
>
> **现状证据（`gh run list -R zhemed/picsur`）**：最近 5 次全 failure（0.10.2 / feat/gallery-dims /
> docs(task) / 0.10.1 / fix(gallery)），说明 CI 已经红了一阵，不是某一次提交引入。
>
> **失败步骤**：`build-and-audit`（约 1m26s），日志两类错误：
> `'window' is not defined` × 4、`'document' is not defined` × 3、
> `error connecting to api.github.com → check your internet connection or https://githubstatus.com`。
>
> **要做**：
> 1. **本地复现**：在干净的 Node 20 + pnpm 9.6.0 环境里跑 `.github/workflows/ci.yml` 里
>    `build-and-audit` 那几步（逐条照抄），把真实报错与**出错的文件:行**钉死；
> 2. **判断归属**：是 CI 步骤配置问题还是审计脚本本身的假设错；
> 3. **修**：让 CI 变成**有意义且稳定**的绿色 —— 该在 Node 跑的静态检查就静态检查；
>    需要浏览器环境的就别在 CI 里假装能跑（明确跳过并注明，不许用 `|| true` 糊过去）；
>    需要外网的那段要有**明确的跳过条件**与说明；
> 4. **验证**：把修复推到**分支**上先看它自己那条 CI 变绿（需要时用 `gh run watch`）；
>    绿了再告诉我，我来决定是否动 master（**别直接推 master**）；
> 5. 顺手在 spec 的 CI/验收那节写清："CI 里哪些步骤需要外网、哪些需要浏览器环境、各自失败时怎么判"。
>
> 边界：`.github/workflows/**`、`support/audit-prod.sh`（若问题在它）；别碰 `backend/src`、`frontend/src`。
> 任务锚点用 `[task:10-16-gallery-layout]`（或你新建一个更贴切的任务也行，告诉我 slug）。
> 交付：分支 + sha + **CI 变绿的那条 run 链接/ID** + 失败根因说明。
