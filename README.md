# Picsur

自用图床：NestJS 后端 + 内嵌 Angular 面板，图片与元数据都存在 Postgres 里。版本线 `0.7.x`（当前 0.7.8）。

## 部署

```bash
docker run -d --name picsur --restart always \
  -p 8080:8080 \
  -v ./data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/zhemed/picsur:allinone
```

面板 `http://<主机>:8080`（登录名固定 `admin`，首次启动的管理员口令打印在 `docker logs picsur`）。
数据全在 `./data`。**升级**：先 `docker pull` 再重建（`docker run` 不会自动拉新镜像），
例如 `docker pull ghcr.io/zhemed/picsur:allinone && docker rm -f picsur` 后再跑上面那条；
迁移随容器启动自动执行。更省事的是用面板：设置 →「关于」→「立即升级」。
面板 → 设置 →「关于」可检查新版本并**一键升级**：上面那行 socket 挂载就是它的开关，
挂了就默认可用；不想要就删掉挂载并设 `PICSUR_ALLOW_SELF_UPDATE=false`（此时页面只显示升级命令）。

想要独立 Postgres（多容器、生产口径）：

```bash
curl -fsSL https://raw.githubusercontent.com/zhemed/picsur/master/install.sh \
  | bash
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
