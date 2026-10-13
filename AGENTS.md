<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

---

# 本仓库约定（zhemed/Picsur fork）

> 由项目所有者 2026-10-13 定调，写在这里以便每个新会话都能看到。

1. **提交必须带任务锚点**：`[task:<任务目录名>]`（例如 `[task:10-13-dep-security-upgrade]`）。
   全局提交闸门会**拒绝**缺锚点、或任务目录缺 `directive.md`（逐字记录用户当轮原话）的提交。
   不要用 `git commit --no-verify` 绕过。补录历史文件时用 `Allow-Stale-Files: <理由>`。
2. **默认 push 到 origin**：这个仓库的提交默认直接推送，不需要每次询问。
3. **构建环境**：装依赖/构建**必须 Node 20 + pnpm 9.6.0**（`corepack` 固定）。
   宿主 Node 22 装不了依赖（`qoi-img`/`bmp-img`/`posix.js` 编译失败）。
   完整契约见 `.trellis/spec/picsur-backend/backend/build-and-deploy.md`。
4. **别开 `PICSUR_VERBOSE`**：它会把 JWT secret 与 DB 口令明文写进日志。
5. **别把密钥写进仓库**：`PICSUR_ADMIN_PASSWORD` / `PICSUR_JWT_SECRET` 只放在 `.env`
   （已同时进 `.gitignore` 与 `.dockerignore`）。
