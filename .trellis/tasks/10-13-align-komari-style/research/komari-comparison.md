# 对标 Komari 的说明文件与部署体验（调研）

日期：2026-10-13 · 任务 `10-13-align-komari-style` · 用户原话见 `../directive.md`

## 1. Komari README 原文（`zhemed/komari`，master，2026-10-13 抓取）

结构就四块：**一句话定位 + 版本线 → 部署（一条 docker run）→ 节点 agent → 自检 + 指针**。

```markdown
# Komari

自用服务器监控：单个 Go 二进制 + 内嵌面板，节点装轻量 agent 上报。版本线 `0.0.x`（当前 0.0.21）。

## 部署
docker run -d --name komari --restart always --network host -v ./data:/app/data ghcr.io/zhemed/komari:latest
（数据在 ./data；面板 http://<主机>:25774，首次进安装向导；升级 = 面板点一下，容器内替换，零配置）

## 节点 agent
（wget 一行安装 / docker run 一行）

## 自检
./scripts/check-repo.sh

其余（构建、发版、部署口径、回滚、维护规范）：docs/MAINTAINING.md 与 .trellis/spec/
```

仓库元数据：MIT、`default_branch=main`、topics 齐全、ghcr 上有 `komari` / `komari-agent` 包 ✓、
工作流只有一个 `trellis-gate.yml`（**构建/发布镜像不在仓库里做，发布脚本在 `scripts/`**）。

## 2. 逐项对标

| 维度 | Komari | Picsur（现状） | 结论 |
|---|---|---|---|
| 一句话定位 | ✓ 极简 | 有，但夹着"独立维护分支"的长解释 | **改写法即可** |
| 版本线 | `0.0.x（当前 0.0.21）` | `0.6.0`（`/api/info`、页脚、四个 package.json 同步）✓ | 已有，只需在 README 亮出来 |
| 部署 | 一条 `docker run` 拉 ghcr 现成镜像 | `git clone` + `docker compose up -d --build`（**本地构建**） | **真差距：没有发布的镜像** |
| 数据 | `-v ./data:/app/data`（sqlite 单文件） | **全部在 Postgres**（应用容器无任何挂载，实测 `docker inspect` 无 Mounts） | **架构差异**：一条 `docker run` 起不来，最少「Postgres + 应用」 |
| 升级 | 面板内一键自替换 | 换镜像 tag + `compose up -d` | 面板内自升级需容器内 docker socket 权限 → 安全面不划算，**建议不做** |
| 自检 | `./scripts/check-repo.sh` | `support/regression-image-api.sh`（34 项断言，已入库）✓ | 已有，只需在 README 亮出来 |
| 细节归档 | `docs/MAINTAINING.md` + `.trellis/spec/` | 只有 `.trellis/spec/`；README 塞了配置表/构建细节 | **补 `docs/MAINTAINING.md`，README 只留指针** |
| CI 用途 | 只做闸门（`trellis-gate.yml`） | 无（本次比对的另一个发现） | 发布链路可先放 `scripts/` + Actions |

## 3. 「我们能不能做」的答案

**能，缺的主要是"发布预构建镜像"这一环。**

1. **发 ghcr 镜像**（可做，代价可控）：加 `.github/workflows/release-image.yml`，
   `permissions: packages: write` 用内置 `GITHUB_TOKEN`（**不需要用户提供任何新凭据**），
   push tag / 手动触发时构建并推 `ghcr.io/zhemed/picsur:{latest,0.6.0}`。
   成本：CI 里要跑 Dockerfile 的 libvips 自编译（本地实测整链 **1m45s**，CI 偏慢但可接受；
   用 `type=gha` 缓存层可再省）。需要用户确认的前提：**仓库允许 Actions 写 packages**（默认允许）。
2. **README 压到 Komari 密度**（纯文档，随时可做）：把配置表/构建细节挪到
   `docs/MAINTAINING.md`，README 只留：一句话 + 一条部署命令 + 数据位置 + 升级 + 自检 + 指针。
3. **做不到 / 不建议**：
   - `-v ./data` 单目录即全部数据 —— 我们用 Postgres（图片行、用户、首选项都在库里）。
     要真做到，等于换存储引擎（sqlite/嵌入式），是**大改造且会退掉现有能力**，不划算。
   - 面板内一键自升级 —— 需要把 docker socket 暴露给容器，等于把宿主 root 权限交给 Web 应用。

## 4. 若动手，建议的交付形态

- `.github/workflows/release-image.yml`：tag 触发，推 `ghcr.io/zhemed/picsur:latest` 与版本 tag。
- `docker-compose.yml` 增加"用现成镜像"的用法说明（`image:` 指向 ghcr，可省 `--build`）。
- `docs/MAINTAINING.md`：构建、发版、部署口径、备份/恢复、回滚、凭据轮换、自检。
- `README.md`：压到 ~25 行，Komari 同款结构。
- 验收：`docker pull ghcr.io/zhemed/picsur:latest` 后一条命令起栈，`/api/info` 返回 0.6.0，
  34 项回归全过；README 每行内容都能在仓库里找到出处。
