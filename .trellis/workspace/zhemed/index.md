# Workspace Index - zhemed

> Journal tracking for AI development sessions.

---

## Current Status

<!-- @@@auto:current-status -->
- **Active File**: `journal-1.md`
- **Total Sessions**: 20
- **Last Active**: 2026-10-15
<!-- @@@/auto:current-status -->

---

## Active Documents

<!-- @@@auto:active-documents -->
| File | Lines | Status |
|------|-------|--------|
| `journal-1.md` | ~461 | Active |
<!-- @@@/auto:active-documents -->

---

## Session History

<!-- @@@auto:session-history -->
| # | Date | Title | Commits | Branch |
|---|------|-------|---------|--------|
| 20 | 2026-10-15 | 全项目审计（四线）+ 修复（四流）+ 质检 → 0.7.9 | `5535f56` | `master` |
| 19 | 2026-10-15 | 调查 Komari 免 socket 升级机制；决定保持应用持 socket | - | `master` |
| 18 | 2026-10-13 | 修正部署文档：手动升级必须先 pull | `5bf0b0f` | `master` |
| 17 | 2026-10-13 | 排查 某台测试服务器（主机名已脱敏）「升级未启用」→ 连带修出两个真 bug（0.7.7 / 0.7.8） | `632f477` | `master` |
| 16 | 2026-10-13 | 修复版本检测显示旧版本：补 git tag + 发布脚本自动打 tag | `f7bbe1b` | `master` |
| 15 | 2026-10-13 | 还原页脚（0.7.6）——revert 时踩到两个坑 | `98710bf` | `master` |
| 14 | 2026-10-13 | 去掉页脚 + 发布 0.7.5 | `8ee0d99` | `master` |
| 13 | 2026-10-13 | 修复界面文字选不中（删除全局 user-select:none）+ 发布 0.7.4 | `1d79f3a` | `master` |
| 12 | 2026-10-13 | 语言菜单中文置顶 + 本地发布流程修 v 前缀 + 实例面板升级到 0.7.3 | `90c3d35` | `master` |
| 11 | 2026-10-13 | 修「关于」对齐 + 升级默认开启 + 本地发布流程 + 实例真升级到 0.7.2 | `0e8ef1d` | `master` |
| 10 | 2026-10-13 | 0.7.0：默认简体中文 + 面板内版本检测/可选自升级，并发布 | `fe83659` | `master` |
| 9 | 2026-10-13 | README 命令折行（消除代码块横向滚动） | `260579b` | `master` |
| 8 | 2026-10-13 | 一键部署：all-in-one 镜像（内嵌 Postgres）+ install.sh | - | `master` |
| 7 | 2026-10-13 | 对标 Komari：发布 ghcr 镜像 + README 压到 31 行 + 运维手册 | `b351d8a` | `master` |
| 6 | 2026-10-13 | 重整提交历史（450 → 32）并把 README 换成简体中文精简版 | `4c8b8e0` | `master` |
| 5 | 2026-10-13 | 轮换开发实例凭据（admin 口令 + JWT secret） | - | `master` |
| 4 | 2026-10-13 | 团队三线并行：吸收上游 PR + 修 bug + 中文界面，并集成验收 | `ef1c89e` | `master` |
| 3 | 2026-10-13 | 脱离上游（一）：仓库切换 + 去上游化改造 | `8dbf5f0` | `master` |
| 2 | 2026-10-13 | T0 生产依赖安全升级（Nest 12 / Fastify 5 / TypeORM / sharp） | `050eaeb` | `master` |
| 1 | 2026-10-13 | 接手 Picsur：可构建可运行基线 + 改造清单 | `d103d32` | `master` |
<!-- @@@/auto:session-history -->

---

## Notes

- Sessions are appended to journal files
- New journal file created when current exceeds 2000 lines
- Use `add_session.py` to record sessions