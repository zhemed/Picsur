# 用户指令原文（directive）

> 按全局提交闸门要求，**逐字**记录用户当轮原话（不改写、不概括）。
> 会话：2026-10-13，任务 `10-13-one-command-deploy`。

## 1. 本轮原话（附了一张 README 渲染截图）

> 这个图去掉，这个部署命令也不是一键命令呀，调用团队有没有什么好办法

## 2. 拆解

| # | 诉求 | 性质 |
|---|---|---|
| 1 | README 顶部那张 logo 图去掉 | 明确动作 |
| 2 | 现在的部署不是「一键命令」（clone + cp + compose pull/up 三行） | 事实指正 + 改进诉求 |
| 3 | **调用团队**找好办法 | 明确授权使用 Agent Teams |

## 3. 参照物（上一轮已对标）

`zhemed/komari` 的部署是一行：
`docker run -d --name komari --restart always --network host -v ./data:/app/data ghcr.io/zhemed/komari:latest`
—— 它能一行，是因为**数据在 sqlite 里**（一个文件 = `-v ./data`）。
我们数据全在 Postgres，所以要么把库也塞进同一个容器（all-in-one），要么用脚本把多容器流程包成一条命令。
