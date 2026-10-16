# CI 一直红的根因与修复（lint 步骤）

## Goal

GitHub Actions 的 `ci / build-and-audit` 最近 5 次运行全 failure，用户在提交旁看到红叉。
查实根因、修到「有意义且稳定」的绿色，并说清 CI 各步骤对**外网 / 浏览器环境**的依赖与失败判法。

## 现状（已查实，2026-10-16）

- 失败步骤只有最后一个：`Lint（flat config 落地后才强制）`（前三步 install / build / audit 都通过）。
- `pnpm lint` = `eslint .`，报 **62 problems（53 errors / 9 warnings）**，exit 1。
- **53 个 error 全部落在三个 `support/*.cjs`**：
  - `support/gallery-layout-probe.cjs`：`document` / `window` / `getComputedStyle` / `localStorage` / `setTimeout` 未定义（这些是**注入浏览器执行**的代码里的全局量）；
  - `support/visual-contrast-probe.cjs`：同上 + 1 个真实发现（`http` 引入后未使用）；
  - `support/make-image-fixtures.cjs`：`Buffer` / `__filename` 未定义（纯 Node 脚本）。
- 根因：`eslint.config.cjs` 里 `js.configs.recommended` 不带 `files` 限制，对**所有文件**生效；
  末尾的 `**/*.cjs` 块只声明了 `module/require/process/__dirname/console` 五个 global，
  **缺 Node 的 `Buffer/__filename/setTimeout…`，也没有浏览器 global** → `no-undef` 全红。
  （`**/*.ts` 块里 `no-undef` 是 off 的，所以只有 `.cjs` 中招。）
- 与「审计脚本在 Node 里跑浏览器代码」无关：`support/audit-prod.sh` 是**通过**的。
- 「error connecting to api.github.com」不是 CI 的报错，是 `gh` CLI 自己连不上 API 时的输出
  （同一句在本机 `gh run view` 失败时也出现过），**不是** workflow 的问题。

## Requirements

1. `pnpm lint` 修到 exit 0（本地与 CI 一致），且**不许**用 `|| true` / 关掉整个规则 / 把 `support/` 排除掉了事；
   要让 `support/` 脚本在**正确的环境假设**下被 lint（Node 脚本给 Node globals，注入浏览器的探针脚本给 Node+浏览器 globals）。
2. `visual-contrast-probe.cjs` 那个真实 finding（未使用的 `http`）要真修，不是降级成 warning。
3. CI 的 lint 步骤去掉「flat config 存在才跑」的条件魔法，变成**无条件门禁**（现在 config 已落地）。
4. workflow 里写清各步骤的依赖与失败判法：哪些需要外网（pnpm install / audit 需要 registry.npmjs.org）、
   哪些**不需要**外网与浏览器（build / lint）；浏览器相关的探针脚本**不在 CI 里跑**（需要本机常驻 Chromium），
   CI 只做静态 lint。
5. 修复先在分支上跑绿（`gh run watch` 验证），**不动 master**。

## Acceptance Criteria

- [x] 本地（Node 20 + pnpm 9.6.0）逐条跑 ci.yml 的四条命令：install / build / audit / lint 全 exit 0。
- [x] 分支推送后 `ci / build-and-audit` 变绿：run **38938017883** success（https://github.com/zhemed/picsur/actions/runs/38938017883）。
- [x] `pnpm lint` 输出里 support 三个脚本不再有 error（`no-undef` 合理消解、真实 finding 已修）：62 problems(53 errors) → 9 problems(0 errors)。
- [x] spec §6.1 新增「CI 门禁」小节：依赖矩阵 + 失败判法 + 新增步骤的规矩。
- [x] 边界：只碰 `.github/workflows/**`、`eslint.config.cjs`、`support/*.cjs`、spec；不碰 `backend/src`、`frontend/src`。

## Notes

- 分支：`fix/ci-green`（worktree `.worktrees/ci-fix`），锚点 `[task:10-16-ci-green]`。
- 参考：`eslint.config.cjs` 顶部注释记录了 ② 线迁移 flat config 时的取舍（`prettier/prettier` 暂关等），本次不改那些取舍。
