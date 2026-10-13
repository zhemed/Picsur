# 用户指令原文（directive）

> 按全局提交闸门要求，**逐字**记录用户当轮原话（不改写、不概括）。
> 会话：2026-10-13，任务 `10-13-integrate-streams`。

## 1. 本轮原话

> 把剩下的交给团队吧

（以及用户对中断的追问：`快起来，怎么回事蹦了吗` —— 我据此把被打断的三个 teammate 叫醒续跑。）

## 2. 上下文

三条团队战线已完成并交付，本任务是 **Lead 的集成与验收**（团队任务板 `task-4`）：

| 战线 | 分支 | 提交数 |
|---|---|---|
| prs-stream | `absorb/upstream-prs` | 3（#128 默认 PNG / #115 列表 API / #129 SVG） |
| bugs-stream | `fix/known-bugs` | 5（#107 像素上限 / #112 复制降级 / 删除 404+no-store / meta no-store / spec+脚本） |
| i18n-stream | `feat/i18n-zh` | 1（#130 中文界面） |

已知冲突：`frontend/src/app/routes/view/view.component.ts`（prs 的 SVG 逻辑 vs i18n 的文案注入）。
