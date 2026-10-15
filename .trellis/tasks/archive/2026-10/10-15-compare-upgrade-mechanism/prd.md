# 调查：Komari 免 socket 面板升级的机制，以及我们是否必须挂 socket

## 结论

**我们必须挂（就当前实现而言）；Komari 不是"不用 socket 也能 Docker 级升级"，而是走了一条我们不具备条件的机制。**

### Komari 的四条升级路径（来自其 `internal/upgrade/upgrade.go` 的模式定义与 `.trellis/spec/backend/server-upgrade.md`）

| 形态 | 模式 | 行为 |
|---|---|---|
| 二进制 + systemd | `binary` | 下载 → 校验 → `--help` 自检 → 原子替换 → 交给 systemd 重启 |
| 容器 + **有 socket** | `docker-recreate` | 拉镜像 + helper 容器重建自身容器（**与我们完全相同**） |
| 容器 + **无 socket**（目录可写） | **`container-replace`** | **在容器内替换二进制 + 原地重执行**（"零配置"，README 说的就是这条） |
| 容器 + 目录只读 | `manual` | 只给可复制的 pull 命令，**不做替换**（与我们兜底一致） |

### 为什么它能 `container-replace`
镜像是 `alpine` + `COPY komari-… /app/komari` + `CMD ["/app/komari","server"]`：
**整个应用就是一个可写文件**。升级 = 下载新二进制 → SHA256 校验 → 试运行自检 → `os.Rename` 原子替换 → 原地重执行，
全程不碰 Docker，因此不需要 socket。前提是二进制所在目录可写。

### 代价（同等重要）
被替换的是**容器内**的文件：一旦容器被重建（`docker rm` 后重跑、compose 换镜像、被其它工具重建），
就回到镜像里的旧版本；`upgrade-state.json` 同理。它是把容器当"长生命周期实体"用。

### 为什么我们不能照抄
Picsur 不是一个文件，而是一整棵树：`backend/dist` + `node_modules`（含 `sharp`、`qoi-img` 等原生模块）
+ `frontend/dist` + 自编译 libvips。要"容器内自替换"就得每次下载整棵树（数百 MB）覆盖自身再重执行——
又重又脆，还会破坏"镜像即真相"（跑的内容与镜像不再一致）。

## 我们的可选项

| 方案 | 说明 |
|---|---|
| A 保持现状 | 应用挂 socket，等价 Komari 的 `docker-recreate`；一行命令即可，已默认开启 |
| B 侧车更新器 | 应用**不碰** socket；另起一个只负责"拉镜像 + 重建应用容器"的小容器（Watchtower 思路）。权限只给侧车，职责更清晰；代价是多一个容器 |
| C 完全不给权限 | 面板只显示升级命令（现有兜底），零风险 |

## 验收

- [x] 读到 Komari 的模式定义与部署形态判定（代码 + 其 spec）
- [x] 解释清楚"它为什么不需要 socket"与"我们为什么需要"
- [x] 给出可选项与代价；由用户决定是否切换方案

## 决定（用户 2026-10-15 选定）

**保持现状**：应用容器挂 `/var/run/docker.sock` 且默认开启 `PICSUR_ALLOW_SELF_UPDATE`（等价 Komari 的 `docker-recreate` 模式）。
理由：一行命令即可用、已在两台实例上端到端验证；接受「面板因此具备宿主 docker 权限」这一代价。
不做侧车更新器，也不做容器内自替换。
