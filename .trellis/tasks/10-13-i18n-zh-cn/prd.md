# 中文界面（吸收上游 PR #130 i18n）

## 背景

上游有一个人气很高的未合并 PR：**#130 Feat/issue 124 i18n implement for zh-cn**
（作者 `LogicDX342`，+1559/-433，92 文件，MERGEABLE/CLEAN）。它给前端加了 i18n 框架与中文翻译。
上游停维护后一直没合，我们把它吸收进来。

取用方式（**不要**重新添加 upstream remote）：
```bash
git fetch https://github.com/CaramelFur/Picsur.git pull/130/head:pr-130
```

## 目标

界面支持切换语言，至少中英文可用；默认仍为英文。

## 范围

**In**：`frontend/**`（i18n 模块、翻译资源、组件模板里的硬编码文案替换）。
**Out**：后端不动；不改品牌；不做新的翻译语种。

## 约束

- 装依赖/构建**必须 Node 20**（`export PATH=/root/picsur/.run/node20/bin:$PATH`）+ pnpm 9.6.0。
- 在自己的 worktree（`.worktrees/i18n`）里工作，不碰主工作区与其他 worktree。
- 注意：我们的 `frontend/custom-webpack.config` 已是 **`.cjs`**（上游 PR 里是 `.mjs`/`.js`），
  合并时以我们的写法为准，不要退回旧形式。
- 不 push；提交信息注明来源 PR 与原作者（`Refs #130 by LogicDX342`）。
- 语言切换要**持久化**（刷新后保持），但不要引入新的运行时依赖（PR 里若用了 `@ngx-translate` 之类，先评估；
  上游 PR 是自研 i18n 模块，优先跟随它）。

## 验收标准

- [ ] AC1 界面上有语言切换入口，切到中文后主要页面文案变中文（登录、上传、查看、设置）。
- [ ] AC2 默认语言仍是英文；切回英文不残留中文。
- [ ] AC3 选择在刷新后保持（localStorage 或等价机制）。
- [ ] AC4 `frontend` 构建通过，且 `custom-webpack.config.cjs` 未被退回 `.js`。
- [ ] AC5 与 SVG 战线（#129，改 `angular.json`/`custom-webpack.config.cjs`/`view.component.ts`）的改动
      在 Lead 集成后仍能构建通过（冲突无法自行解决时，留给 Lead 并说明冲突点）。
- [ ] AC6 提交带 `[task:10-13-i18n-zh-cn]` 锚点 + 来源署名。

## 风险

| 风险 | 应对 |
|---|---|
| PR 基于旧代码（zod 3 / Angular 18 / 旧目录结构） | 按意图重写允许；以构建通过为准 |
| 与 #129 在前端文件上冲突 | 各自分支独立提交，Lead 集成解决 |
| 翻译不全 | 允许部分页面暂留英文，但要在提交信息与报告中说明覆盖范围 |
