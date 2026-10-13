# 用户指令原文（directive）

> 按全局提交闸门要求，**逐字**记录用户当轮原话（不改写、不概括）。
> 会话：2026-10-13，任务 `10-13-align-komari-style`。

## 1. 本轮原话

> https://github.com/zhemed/komari你看一下这个项目的说明文件，特别是Komari
>
> 自用服务器监控：单个 Go 二进制 + 内嵌面板，节点装轻量 agent 上报。版本线 0.0.x（当前 0.0.21）。
>
> 部署
>
> docker run -d --name komari --restart always \
>   --network host \
>   -v ./data:/app/data \
>   ghcr.io/zhemed/komari:latest
>
> 我感觉很舒服，我们的项目可以做吗

## 2. 用户的选择（交互式提问，2026-10-13）

> 全都做（推荐）

即：① 把镜像发到 ghcr（一条命令部署）；② README 压到 Komari 的密度；
③ 细节挪进 `docs/MAINTAINING.md`。

## 3. 已确认的事实（调研见 `research/komari-comparison.md`）

- Komari README 结构 = 一句话定位 + 版本线 → 部署（一条 `docker run` 拉 ghcr 镜像）→ agent → 自检 + 指针。
- 我们缺的核心一环是**发布预构建镜像**（现在是 `--build` 本地构建）。
- 架构差异：Komari 用 sqlite（`-v ./data` 即全部数据），我们**全部数据在 Postgres**，
  所以「一条 docker run」不可能，最少是「库 + 应用」，Compsoe 一条命令是现实上限。
- 仓库 Actions 已启用（`enabled:true, allowed_actions:all`），账号下已有多个 ghcr 包（komari、halo…）。
