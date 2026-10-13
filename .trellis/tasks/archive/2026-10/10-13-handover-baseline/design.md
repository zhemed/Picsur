# 技术设计：可构建可运行基线

## 1. 运行形态选择

三种可选，选 **B（生产形态本地验证）**：

| 方案 | 内容 | 取舍 |
|---|---|---|
| A. 纯 dev | `nest start` + `ng serve` | 需要给 Angular 配 API 代理，验证不到真实托管形态 |
| **B. 生产形态** | `pnpm build` 三包 → 直接 `node backend/dist/main.js`，backend 托管 `frontend/dist` | 与 docker 镜像形态一致，冒烟最有代表性 ✅ |
| C. 自建镜像 | `support/picsur-stage1/2.Dockerfile` 本地构建镜像 | 需要 binfmt + buildx + `--push`（脚本写死推送），本任务不做 |

## 2. 版本与工具链

- **pnpm**：上游 `packageManager: pnpm@9.6.0`。用 `corepack enable && corepack prepare pnpm@9.6.0 --activate`
  在仓库内使用，不改 `package.json`，不污染全局 pnpm 12。
- **Node**：`.nvmrc` 为 `v20`，本机是 v22.23.2。先用 v22 试构建；若 `sharp` 或 Angular 报 ABI 问题，
  再决定装 node 20（记录到 spec 作为接手知识）。
- **构建顺序**：`shared` → (`backend`, `frontend`)；`picsur-shared` 是 workspace 依赖，
  backend/frontend 都 import `picsur-shared/dist/*`，所以必须先生成 dist。

## 3. 数据库与配置

- 数据源：`support/dev.docker-compose.yml`（`postgres:17-alpine`，宿主 5432，卷 `db-data`）。
  本机 5432 当前无监听，端口可用。
- 后端环境变量（前缀 `PICSUR_`，见 `backend/src/config/config.static.ts`）：
  - `PICSUR_DB_HOST/PORT/USERNAME/PASSWORD/DATABASE`（默认全部 `picsur`）
  - `PICSUR_HOST`(0.0.0.0) / `PICSUR_PORT`(8080，本机空闲)
  - `PICSUR_ADMIN_PASSWORD`（admin 初始口令，账号名固定 `admin`）
  - `PICSUR_JWT_SECRET`（不设则每次随机 → 重启后登录态失效，本地固定一个）
  - `PICSUR_STATIC_FRONTEND_ROOT=/root/picsur/frontend/dist`
  - `PICSUR_PRODUCTION=true` 时 TypeORM `synchronize` 关闭、只跑 migration；
    本地验证取 `true`（验证真实迁移路径）
- 秘钥只写在 `/root/picsur/.env`（本地），`.gitignore` 追加 `.env`。

## 4. 分支与提交策略

- fork 的主线 = `master`（fork 即开发主线，`upstream` 只做参考，不回推）。
- 本任务直接在 `master` 上工作并本地提交，提交信息带 `[task:handover-baseline]`。
- **不 push**；何时建自有分支/发布镜像留给后续任务决定。
- 上游 `dev` 分支先盘点（`research/` 记录差异），不在本任务合并。

## 5. 冒烟路径（AC4/AC5）

1. `GET /api/info` → 服务信息 + 版本。
2. `POST /api/user/login`（admin + `PICSUR_ADMIN_PASSWORD`）→ token。
3. `POST /api/image`（multipart，带 token 或匿名）→ 返回 image id / 完整 id。
4. `GET /api/image/<id>` → 图片字节；确认服务器转换策略（默认转 QOI，可 `keep original`）。
5. `DELETE /api/image/<id>` → 删除成功。

优先用 `curl` 直接打 API（可复现、可写进 spec）；若前端页面需要验证，再用本机常驻浏览器 `bw` 截图。

## 6. 回滚点

- 每个阶段有明确回滚：`rm -rf node_modules dist` 回到干净树；`docker compose down -v` 清库；
  `git reset --hard origin/master` 回到 fork 基线。所有验证产物都在 git 忽略范围内，不存在不可逆动作。

## 7. 不做什么

- 不改 Angular/NestJS 大版本，不重构业务代码，不做 CI/CD，不发镜像，不 push。
