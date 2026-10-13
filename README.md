<img align="left" width="90" height="90" style="border-radius: 15%" src="branding/logo/picsur.svg"/>

# Picsur

自建的图片分享服务（Imgur + Pastebin 混合体），自己部署、数据在自己手里。

> 本仓库由 [@zhemed](https://github.com/zhemed) 自维护，**不依赖上游、不上报遥测**。
> 代码源自 [Picsur](https://github.com/CaramelFur/Picsur)（作者 Caramel，AGPL-3.0，上游 2024 年起停止维护）。

## 快速开始

```bash
cp .env.example .env # 至少改 PICSUR_ADMIN_PASSWORD 与 PICSUR_JWT_SECRET
docker compose up -d --build
# 打开 http://localhost:8080  登录名固定为 admin
```

镜像用本仓库的 `Dockerfile` 自己构建，不拉任何上游镜像。

## 能做什么

- 上传 / 浏览图片，支持匿名上传；账号、角色、权限
- 格式：QOI、JPG、PNG、WEBP（动图）、TIFF、HEIF、BMP、GIF（动图）、JPEG-XL、JPEG-2000、
  **SVG**（按向量保存，上传即净化，取回带严格 CSP）
- 转换与编辑：缩放、旋转、翻转、去透明、负片、灰度；EXIF 剥离，「保留原图」可选
- 删除与过期、ShareX 端点、数据库迁移
- 界面**中英文**可切（页头切换，按浏览器记忆）
- 自编译镜像，编解码器齐全（HEIF / JXL / JP2 —— 上游预编译的 `sharp` 没有这些）

## 从源码构建

必须 **Node 20 + pnpm 9.6.0**：`qoi-img` / `bmp-img` / `posix.js` 在 Node ≥ 22.16 装不上
（构建产物本身可以在更高版本的 Node 上跑）。

```bash
corepack enable && corepack prepare pnpm@9.6.0 --activate
pnpm install
pnpm build                              # shared → backend → frontend
pnpm --filter picsur-backend start:prod # 需要先配好 .env
```

## 配置

变量都以 `PICSUR_` 开头，完整清单见 [`.env.example`](./.env.example)。常用的：

| 变量                                               | 默认                            | 说明                                               |
| -------------------------------------------------- | ------------------------------- | -------------------------------------------------- |
| `PICSUR_ADMIN_PASSWORD`                            | 必填                            | 管理员口令（用户名固定 `admin`）                   |
| `PICSUR_JWT_SECRET`                                | 随机                            | 不设则每次重启所有人掉线                           |
| `PICSUR_DB_{HOST,PORT,USERNAME,PASSWORD,DATABASE}` | `localhost` / `5432` / `picsur` | Postgres 连接                                      |
| `PICSUR_PORT` / `PICSUR_HOST`                      | `8080` / `0.0.0.0`              | 监听地址                                           |
| `PICSUR_MAX_FILE_SIZE`                             | `128000000`                     | 上传字节上限                                       |
| `PICSUR_MAX_IMAGE_PIXELS`                          | `268402689`                     | 像素上限（`宽 × 高`），`0` = 不限                  |
| `PICSUR_PRODUCTION`                                | `false`                         | **生产必须设 `true`**（否则 TypeORM 会同步表结构） |
| `PICSUR_VERBOSE`                                   | `false`                         | ⚠️ **别开**：会把 JWT secret 与库口令明文打进日志  |

## 运维

- **升级**：`git pull && docker compose up -d --build`；数据库迁移随容器启动自动执行。
- **备份**：图片、用户、配置**全部存在 Postgres 里**（应用容器没有任何挂载），所以
  `docker compose exec postgres pg_dump -U picsur picsur > picsur-$(date +%F).sql` 就是全量备份。
- **自检**：`bash support/regression-image-api.sh http://localhost:8080 "<admin口令>"`（34 项断言：
  上传 / 取回 / 7 种格式 / 删除语义 / 像素上限）。
- **凭据轮换**：步骤与三个坑见 [build-and-deploy.md §11](.trellis/spec/picsur-backend/backend/build-and-deploy.md)。

## 现状

- 生产依赖审计 **0 告警**：`pnpm audit --prod --registry https://registry.npmjs.org/`
- 还没做：Angular 大版本升级、可插拔存储后端（本地文件 / S3）、相册 / 公开画廊

## 许可

**AGPL-3.0**，见 [`LICENSE`](./LICENSE)。代码版权归 Caramel 及贡献者所有，源自
<https://github.com/CaramelFur/Picsur>，本仓库以同一许可分发。
