# admin 用户名无法修改（上一版把 username 也从请求里去掉了）

## Goal

用户反馈 0.10.6 上 admin 的用户名改不了。成因：0.10.6 的修复为避免权限 403，把 locked-perms 账号请求里的 permissions『和 username』一起剔除（Lead 指令写错）。需先实测后端是否允许改用户名，再决定：允许→前端只剔除 permissions；不允许→前端把该字段明确置灰并说明，而不是静默忽略。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
