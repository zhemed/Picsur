# 用户指令原文（directive）

> 按全局提交闸门要求，**逐字**记录用户当轮原话（不改写、不概括）。
> 会话：2026-10-13，任务 `10-13-readme-wrap-command`。

## 1. 本轮原话（附一张 README 渲染截图，截图里那条 docker run 右侧带横向滚动条）

> 这格式好像不对呀，你看看对比一些

## 2. 问题定位

`docker run -d --name picsur --restart always -p 8080:8080 -v ./data:/data ghcr.io/zhemed/picsur:allinone`
单行 100+ 字符 → GitHub 代码块出横向滚动条；Komari 的对照写法是**反斜杠折行**：

```bash
docker run -d --name komari --restart always \
  --network host \
  -v ./data:/app/data \
  ghcr.io/zhemed/komari:latest
```

## 3. 诉求

照参照物把格式对齐（折行 + 核对其余排版的命令长度）。
