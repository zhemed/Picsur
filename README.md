<img align="left" width="84" height="84" style="border-radius:15%" src="branding/logo/picsur.svg"/>

# Picsur

自用图床：NestJS 后端 + 内嵌 Angular 面板，图片与元数据都存在 Postgres 里。版本线 `0.6.x`（当前 0.6.0）。

## 部署

```bash
git clone https://github.com/zhemed/picsur && cd picsur
cp .env.example .env # 至少改 PICSUR_ADMIN_PASSWORD 与 PICSUR_JWT_SECRET
docker compose pull && docker compose up -d
```

面板 `http://<主机>:8080`（登录名固定 `admin`）。数据在 `picsur-data` 卷里（Postgres），
应用容器没有任何挂载。**升级**：`git pull && docker compose pull && docker compose up -d`；
不想用发布镜像就 `docker compose up -d --build` 从源码构建。

## 自检

```bash
bash support/regression-image-api.sh http://localhost:8080 "<admin口令>"
```

其余（构建、发版、部署口径、备份与恢复、回滚、凭据轮换、排障）见
[docs/MAINTAINING.md](./docs/MAINTAINING.md)；可执行契约在 [`.trellis/spec/`](./.trellis/spec)。

## 许可

AGPL-3.0，见 [`LICENSE`](./LICENSE)。代码源自 [Picsur](https://github.com/CaramelFur/Picsur)
（作者 Caramel 及贡献者，上游 2024 年起停止维护），本仓库以同一许可分发。
