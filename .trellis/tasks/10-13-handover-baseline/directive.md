# 用户指令原文（directive）

> 本文件按全局提交闸门要求，**逐字**记录用户当轮原话（不改写、不概括）。
> 会话：2026-10-13，任务 `10-13-handover-baseline`。

## 1. 开工原话

> 我们有事干了，你看看这个项目https://github.com/caramelfur/picsur

（同轮附带的运行时上下文：工作目录 `/root/picsur`、文件策略 danger-full-access、审批策略已改为 never。）

## 2. 交互组件返回的选择与授权

| 决策点 | 用户选择（逐字） |
|---|---|
| 这次干什么 | `选4吧，确认公开` |
| 是否启用 Trellis | `启用（trellis init --dsh -u zhemed）（推荐）` |
| 网络授权 | `允许这三类（推荐）` |
| 运行形态 | `验证通过后直接转常驻` |
| 端口暴露面 | `保持 0.0.0.0:8080` |
| 上游构建脚本 | `删掉上游那套` |
| 是否发布 | `直接 push 到 origin` |

> 说明：第 1 项是用户手打的自定义回答；其余为用户在交互组件里选中的选项标签（原样记录）。
> 「允许这三类」对应的完整选项描述为：pnpm install 从 registry.npmjs.org 拉依赖（含 sharp 预编译包）、
> docker pull postgres:17-alpine 起验证库、gh 读上游 40 个 issue 做分类。
