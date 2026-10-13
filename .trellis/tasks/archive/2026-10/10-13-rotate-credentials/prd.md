# 轮换 admin 口令与 JWT secret

## 背景

开发实例的凭据在本会话过程中被**回显过两次**（我用 `docker exec printenv` 时、i18n 队友用 `bw fill`
时）。都没进仓库、没进提交，但值已落到模型上下文里，按规矩应当视为已泄漏并轮换。
用户 2026-10-13 选择「现在就轮换」。

## 范围

**In**：`PICSUR_ADMIN_PASSWORD`、`PICSUR_JWT_SECRET`（本机开发实例）。
**Out**：端口暴露策略（用户没选收窄，`0.0.0.0:8080` 保持）；数据库口令（compose 默认字面量，非真实凭据）。

## 约束

- 新凭据必须**随机生成**，且**不得**出现在对话输出、文件、提交、日志里。
- 必须同时更新三处并保持一致：`.env`、数据库（`e_user_backend.hashed_password` 与
  `e_sys_preference_backend[ jwt_secret ]`）、容器环境。
- 轮换后必须验证：新凭据可用、旧凭据失效、旧 token 失效、**数据无损**。
- 不改代码；只操作运行中的实例与 `.env`（`.env` 已 gitignore）。

## 验收标准

- [ ] AC1 新 `PICSUR_ADMIN_PASSWORD` 登录返回 201；错误口令被拒（`Wrong username or password`）。
- [ ] AC2 新 `PICSUR_JWT_SECRET` 生效：轮换前签发的 token 被拒（401/403）。
- [ ] AC3 **三处一致**：`.env` 值 == 容器 `printenv` 值 == 数据库对应值（用 `sha256` 比对，不打印明文）。
- [ ] AC4 数据无损：`e_image_backend` 行数不变，既有图片仍可取回。
- [ ] AC5 轮换后 `support/regression-image-api.sh` 34 项全过。
- [ ] AC6 把踩到的坑写进 `.trellis/spec/.../build-and-deploy.md`（轮换步骤 + compose 环境变量优先级）。

## 风险 / 已知坑

| 坑 | 说明 |
|---|---|
| `ensureUserExists` 只创建不更新 | 改 `.env` 不会改已有 admin 的口令 |
| `jwt_secret` 是数据库首选项 | 改 `.env` 不影响运行中的签名密钥 |
| **compose 优先 shell 环境变量** | `set -a; . ./.env` 之后再改 `.env` 并重建容器，容器拿到的仍是 shell 里的旧值（本次第一次轮换就栽在这，误判为"已换"） |
| `/api/user/me` 结构 | 不是 `{data:{id}}`；取 admin uuid 走 `POST /api/user/list` 或直接查库 |
