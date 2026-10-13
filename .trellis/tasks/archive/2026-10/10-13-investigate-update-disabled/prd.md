# 排查并修复 某台测试服务器（主机名已脱敏）「面板内升级未启用」

## 结论（只读排查所得）

| 项 | 值 |
|---|---|
| 主机 | debian12（刚重装过，故 SSH 主机密钥变） |
| 部署 | `docker run`（无 compose 文件），镜像 `ghcr.io/zhemed/picsur:allinone` 0.7.6 |
| 数据 | `/root/data -> /data` ✓ |
| docker.sock | **已挂载** ✓ |
| `PICSUR_ALLOW_SELF_UPDATE` | **未设置** ✗ → 应用兜底默认 false → 面板「未启用」 |

**根因是文档/默认值不一致**：0.7.2 起 compose 里默认 `true`，但**应用自身兜底仍是 false**，
而 README 的 `docker run` 一行命令没传该变量 → 只挂 socket 的部署依然是关闭态。

## 处置

1. **某台测试服务器（主机名已脱敏）**：用原参数 + `-e PICSUR_ALLOW_SELF_UPDATE=true` 重建容器（数据卷不动）→ 已完成待复验。
2. **代码**：`update.config.service.ts` 的默认值改为 `true`（真正的门槛是 socket 挂载，未挂时预检会拒绝并给命令）→ 0.7.7。
3. **文档**：README 与 MAINTAINING 文案同步为「挂 socket 即默认可用，设 false 关闭」。
4. **发布脚本加脏树守卫**：工作树脏或提交未推送时**拒绝发布**（可用 `--allow-dirty` 覆盖）——
   本次 0.7.7 就是因为在提交被闸门拒绝后仍执行了发布，导致镜像内容与 git tag 不对应。

## 验收标准

- [ ] AC1 某台测试服务器（主机名已脱敏） 上面板 `selfUpdateEnabled=true`（应用接口实测）。
- [ ] AC2 0.7.7 的**镜像内容与 git tag 指向同一提交**（补提交后把 tag 移到该提交）。
- [ ] AC3 发布脚本对脏树/未推送提交会拒绝，并支持 `--allow-dirty`。
- [ ] AC4 三包构建通过；tag 与镜像一致；工作树干净。
