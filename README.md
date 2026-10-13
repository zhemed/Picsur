# Picsur

自用图床：NestJS 后端 + 内嵌 Angular 面板，图片与元数据都存在 Postgres 里。版本线 `0.6.x`（当前 0.6.0）。

## 部署

```bash
docker run -d --name picsur --restart always -p 8080:8080 -v ./data:/data ghcr.io/zhemed/picsur:allinone
```

面板 `http://<主机>:8080`（登录名固定 `admin`，首次启动的管理员口令打印在 `docker logs picsur`）。
数据全在 `./data`。**升级**：`docker rm -f picsur` 后用新 tag 再跑同一条命令，迁移自动执行。

想要独立 Postgres（多容器、生产口径）：

```bash
curl -fsSL https://raw.githubusercontent.com/zhemed/picsur/master/install.sh | bash
```

## 自检

```bash
bash support/regression-image-api.sh http://localhost:8080 "<admin口令>"
```

其余（构建、发版、部署口径、备份与恢复、回滚、凭据轮换、排障）见
[docs/MAINTAINING.md](./docs/MAINTAINING.md)；可执行契约在 [`.trellis/spec/`](./.trellis/spec)。

## 许可

AGPL-3.0，见 [`LICENSE`](./LICENSE)。代码源自 [Picsur](https://github.com/CaramelFur/Picsur)
（作者 Caramel 及贡献者，上游 2024 年起停止维护），本仓库以同一许可分发。
