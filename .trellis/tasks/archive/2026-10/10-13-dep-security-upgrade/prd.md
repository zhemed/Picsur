# T0 生产依赖安全升级（NestJS 12 / Fastify 5 / TypeORM / sharp）

> 标题里的「11」是规划时的写法；研究后改为 **NestJS 12**（原因见 design.md §2：Nest 11 内嵌的
> `@fastify/middie@9.0.3` 仍中 critical，12 用的是 9.3.5）。

## 背景

上一任务 `10-13-handover-baseline` 的依赖体检结论（原始证据 `research/audit-prod.json`）：

- 生产依赖 **118 条**告警：**5 critical / 64 high / 40 moderate / 9 low**。
- 最要命的几条：`@fastify/middie`（中间件认证绕过，critical）、`@fastify/reply-from`（critical）、
  `@fastify/static`（**路由守卫绕过 / 路径穿越**，high）、`typeorm`（SQL 注入，high）、
  `sharp`（继承 libvips CVE，high）、`@fastify/multipart`（上传端点资源耗尽，high）。
- 上游已停维护，这些修复**只能靠自己升级拿到**；而实例已经常驻在 0.0.0.0:8080。

## 目标

把**后端生产依赖**的漏洞面压到「critical 归零、high 归零或逐条说明」，
且**对外 API 契约与既有数据都不退化**。

## 范围

**In**

- `backend` / `shared` 生产依赖大版本升级：NestJS 10 → **12**、Fastify 4 → **5**、
  `@fastify/{helmet,multipart,reply-from,static}` 对齐到与 Fastify 5 + Nest 12 匹配的线、
  TypeORM 0.3.20 → **0.3.31**、sharp 0.33.5 → **0.35.5**、file-type 19 → **22**。
- 传递依赖残留告警：能安全 `pnpm.overrides` 的顶上，顶不动的逐条记录原因。
- `Dockerfile`：跟随 sharp 0.35 的要求升级自编译 libvips（**8.16.0 → ≥8.18.7**）。
- 镜像重建 + 常驻栈回归 + 冒烟。

**Out**

- **前端 Angular 大版本升级（留 T6）**。这是本任务的**已知残留风险**：Angular 18 的
  XSS/XSRF 类告警是浏览器端真实存在的，但升级它要动整个前端与构建链，必须单独任务。
- 不改对外 API 契约（路径、字段、状态码）；不做新功能；不做存储后端重做（T5）。
- 不引入新增的运行时依赖（除升级本身）。

## 约束

- 装依赖 / 构建**必须 Node 20 + pnpm 9.6.0**（见 `.trellis/spec/picsur-backend/backend/build-and-deploy.md`）。
- 升级期间**不得干扰常驻实例**：宿主迭代实例用 **8081**，数据库用 `support/dev.docker-compose.yml`。
- DB 数据不能丢；升级后不得出现「要手工改库才能启动」的情况。
- 每个 override 都要有构建 + 冒烟证据，禁止「先顶上去再说」。
- 不 push；是否 push 由用户在收尾时确认。

## 验收标准

- [ ] AC1 Node 20 下 `pnpm install` 成功、lockfile 变化可解释；`shared` / `backend` / `frontend` 三包构建通过。
- [ ] AC2 `pnpm audit --prod`（对 `registry.npmjs.org`）**critical = 0 且 high = 0**；
      若确有无法消除项，逐条列出「包 / 告警 / 为什么修不掉 / 缓解措施」，不隐藏。
- [ ] AC3 冒烟 5 步通过：`/api/info` → admin 登录 → 上传 → 带扩展名取回 → 删除；
      且 `png/qoi/webp/avif` 转码可用。
- [ ] AC4 **既有数据库**（升级前建的库：7 条 migration + 既有数据）升级后直接可启动，
      migration 不重复执行、无手工干预。
- [ ] AC5 镜像重建成功；容器内 `heif/jxl/jp2` 仍可用（证明 libvips 升级没丢 codec）。
- [ ] AC6 对外契约不变：`/api/info` 字段一致、上传/取回/删除的路径与状态码与升级前一致。
- [ ] AC7 `.trellis/spec/` 更新：新版本契约、升级坑、残留风险。
- [ ] AC8 本地提交（带任务锚点）；push 待用户确认。

## 风险

| 风险 | 应对 |
|---|---|
| Nest 12 / Fastify 5 的 breaking change（multipart、reply-from、DI） | 先在宿主 8081 迭代跑通，再进镜像 |
| sharp 0.35 要求 libvips ≥8.18.7，镜像里是自编译 8.16.0 | 同步升 libvips；编不出来则走 design.md §3 的降级预案 |
| `pnpm overrides` 顶传依赖可能把运行时搞坏 | 每个 override 必须构建 + 冒烟通过，能不加就不加 |
| typeorm 升级影响 migration 行为 | 留在 0.3 线（不上 1.x），用既有库做回归 |
| 升级期间常驻实例仍跑旧镜像 | 升级前 `docker tag zhemed/picsur:local zhemed/picsur:pre-t0` 备份，随时回滚 |
