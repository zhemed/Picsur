# Journal - zhemed (Part 1)

> AI development session journal
> Started: 2026-10-13

---



## Session 1: 接手 Picsur：可构建可运行基线 + 改造清单
<!-- trellis-session: v=2 fp=fe45535b28501f3c -->

**Date**: 2026-10-13
**Task**: 接手 Picsur：可构建可运行基线 + 改造清单
**Package**: picsur-shared
**Branch**: `master`

### Summary

从零接手 fork zhemed/Picsur：启用 Trellis；装依赖+三包构建（Node 22 装不上，锁定 Node 20 + pnpm 9.6.0）；修 frontend custom-webpack 在 Node>=20.19 的 require(esm) 缺陷；自有 Dockerfile（不依赖上游私有中间镜像）+ 常驻 compose 上线，7 种格式转码可用；产出改造清单（生产依赖 118 条漏洞、5 个未合并 PR、35 条 issue、dev 分支不可 merge）；spec 落 build-and-deploy 与 image-api-contracts。

### Git Commits

| Hash | Message |
|------|---------|
| `d103d32` | chore(frontend): drop the old .js webpack config (renamed to .cjs) |

### Status

[OK] **Completed**


## Session 2: T0 生产依赖安全升级（Nest 12 / Fastify 5 / TypeORM / sharp）
<!-- trellis-session: v=2 fp=8d25d2215f02ebed -->

**Date**: 2026-10-13
**Task**: T0 生产依赖安全升级（Nest 12 / Fastify 5 / TypeORM / sharp）
**Package**: picsur-shared
**Branch**: `master`

### Summary

生产依赖告警 118→0（critical 5→0、high 64→0）：Nest 10→12 + Fastify 4→5 + @fastify 四条线 + typeorm 0.3.31 + sharp 0.35.5 + file-type 21.3.4 + 11 条同大版本 override；修掉 4 处升级引入的编译/运行问题（其中 serve-static fallthrough 的 SPA 深链回归只有深链冒烟能抓到）；镜像内 libvips 8.16→8.18.7 并补上 sharp 源码构建（sharp>=0.33 不再认 SHARP_FORCE_GLOBAL_LIBVIPS，否则 JXL/JP2 静默消失）。验证：三包构建、既有库零 migration 重跑、容器内 7/7 格式、SPA 深链、5 条负例、重启恢复、与 pre-t0 镜像 A/B 契约一致。已 push 到 origin。

### Git Commits

| Hash | Message |
|------|---------|
| `050eaeb` | chore(deps): upgrade Nest 12 / Fastify 5 / TypeORM / sharp; prod audit 118 -> 0 |

### Status

[OK] **Completed**


## Session 3: 脱离上游（一）：仓库切换 + 去上游化改造
<!-- trellis-session: v=2 fp=d0aa80b3d1a61535 -->

**Date**: 2026-10-13
**Task**: 脱离上游（一）：仓库切换 + 去上游化改造
**Package**: picsur-shared
**Branch**: `master`

### Summary

把项目从上游彻底摘出来：① 仓库层面——原 fork 改名 zhemed/Picsur-fork-archive 并归档（只读），新建非 fork 仓库 zhemed/picsur，origin 切过去、upstream remote 删除、全历史推送；② 运行时——遥测断链（ReportUrl 编译期置空 + UsageService 端点为空即跳过），DB 首选项置 true 也不出网（tcpdump 0 包验证）；③ 元数据——四个 package.json 换到自有版本线 0.6.0、repository/author 指向新仓库；④ 品牌保留 Picsur，只去掉上游指向（页脚、og 标签、README 重写、删上游 FUNDING.yml）。验证：三包构建、容器 7 格式全 200、SPA 深链、/api/info version=0.6.0、密钥零入库、白名单外零上游字样。

### Git Commits

| Hash | Message |
|------|---------|
| `8dbf5f0` | chore: reword comments that still carried upstream coordinates |

### Status

[OK] **Completed**


## Session 4: 团队三线并行：吸收上游 PR + 修 bug + 中文界面，并集成验收
<!-- trellis-session: v=2 fp=706e6721daa067fe -->

**Date**: 2026-10-13
**Task**: 团队三线并行：吸收上游 PR + 修 bug + 中文界面，并集成验收
**Package**: picsur-shared
**Branch**: `master`

### Summary

三条战线并行（各自 worktree/分支/库/端口）：prs 吸收 #128 默认PNG（带 migration）/ #115 list-all / #129 SVG（含净化+CSP）；bugs 修 #107 超像素400 / #112 剪贴板降级 / 删除语义改 404+no-store / meta no-store；i18n 吸收 #130 中文界面（自研 I18nService，无新依赖）。Lead 集成：4 处冲突手工解（headImage 双能力、view 的 SVG/i18n 分支、剪贴板结构化+文案、词典补 key），新增 jsdom/dompurify/svgo/is-svg 后又用 3 条 override 把生产告警压回 0；复核子代理抓出并修掉一个真安全洞（SVG 净化只查 <use>，外链可绕过）与一处漏翻；最终镜像重建后 34 项回归 + 21 项端到端全绿，容器内 7 格式可用，SVG 外链/script/javascript 全删。

### Git Commits

| Hash | Message |
|------|---------|
| `ef1c89e` | docs: record the absorbed capabilities and the no-extension contract |

### Status

[OK] **Completed**


## Session 5: 轮换开发实例凭据（admin 口令 + JWT secret）
<!-- trellis-session: v=2 fp=d459947d00fea257 -->

**Date**: 2026-10-13
**Task**: 轮换开发实例凭据（admin 口令 + JWT secret）
**Package**: picsur-shared
**Branch**: `master`

### Summary

按用户选择就地轮换：新随机口令（32 字符）与新 JWT secret（64 hex）。踩到三个坑并全部写进 spec §11：① ensureUserExists 只创建不更新（改 .env 不改已有 admin 口令）；② jwt_secret 运行期读数据库首选项，.env 只在首选项缺失时生效；③ docker compose 优先用 shell 环境变量而非 .env——第一次轮换因此'假成功'（库改了值、容器还是旧的），用 sha256 比对 .env/容器/数据库三处才发现。兜底路径：用应用自带 bcrypt-ts 直接写 hashed_password（口令走 stdin，脚本放 backend 目录解析 node_modules，用完删）。验证：新口令 201、错口令被拒、旧 token 失效、34 项回归全过、中文界面正常、图片行数不变。

### Git Commits

(No commits - planning session)

### Status

[OK] **Completed**


## Session 6: 重整提交历史（450 → 32）并把 README 换成简体中文精简版
<!-- trellis-session: v=2 fp=63603405cebc87e1 -->

**Date**: 2026-10-13
**Task**: 重整提交历史（450 → 32）并把 README 换成简体中文精简版
**Package**: picsur-shared
**Branch**: `master`

### Summary

用户质疑 450 个提交：查明 419 个是上游继承（rubikscraft 342/Caramel 49/…），我们自己只有 31 个。按用户选择把上游压成 1 个起点提交、保留我们的 31 个：git rebase 会丢 merge 提交（团队三条战线的合并处冲突），改用 filter-branch --parent-filter 只改父链接，不用三方合并，一次成功；树经 git diff 证明逐字节未变（否则要重新验证）。起点提交被提交闸门拦（整树都是老文件），用官方 Allow-Stale-Files 逃逸通过。README 由英文 93 行/5405 字符改为中文 74 行/3234 字符：这是什么/快速开始/能做什么/源码构建/配置/运维（升级·备份·自检·轮换）/现状/许可，其中每条命令都当场跑过（pnpm build OK、回归脚本可执行、spec §11 存在）。备份：本地 backup/pre-squash-2026-10-13 与 refs/original/refs/heads/master 均指向旧 tip 3e3d73a。已 --force-with-lease 推送，远端提交数 33。

### Git Commits

| Hash | Message |
|------|---------|
| `4c8b8e0` | docs: rewrite the README in Simplified Chinese for a self-maintained project |

### Status

[OK] **Completed**


## Session 7: 对标 Komari：发布 ghcr 镜像 + README 压到 31 行 + 运维手册
<!-- trellis-session: v=2 fp=bcebfc26a2f4affd -->

**Date**: 2026-10-13
**Task**: 对标 Komari：发布 ghcr 镜像 + README 压到 31 行 + 运维手册
**Package**: picsur-shared
**Branch**: `master`

### Summary

用户拿自己 komari 仓库的 README 做参照（一句话定位+版本线 → 一条 docker run 拉现成镜像 → 自检 → 指针），问能不能做到；选定'全都做'。交付：① .github/workflows/release-image.yml：v* tag 或手动触发构建并推 ghcr.io/zhemed/picsur（:版本/:主.次/:latest），只用内置 GITHUB_TOKEN + packages:write，无需新凭据；首次运行 v0.6.0 成功（7m26s）。② docker-compose.yml 的 image 改为 ${PICSUR_IMAGE:-ghcr.io/zhemed/picsur:latest}，--build 本地构建仍可用。③ docs/MAINTAINING.md（120 行）：构建/发版/部署/备份恢复/回滚/凭据轮换/自检/排障。④ README 74→31 行，Komari 同款结构。验证：拉发布镜像起隔离栈（8099/独立卷）→ /api/info=0.6.0 → migrations=8 → 34 项回归全过 → 拆除，常驻栈未受影响；包为 public，匿名可拉；固化了 support/verify-published-image.sh（8/8）。已知差异：Komari 用 sqlite 所以一条 docker run 带 -v ./data，我们数据全在 Postgres，最少是 compose 一条命令；面板内一键自升级不做（需把 docker socket 交给 Web 应用）。

### Git Commits

| Hash | Message |
|------|---------|
| `b351d8a` | docs: record the ghcr release flow and ship the release verification script |

### Status

[OK] **Completed**


## Session 8: 一键部署：all-in-one 镜像（内嵌 Postgres）+ install.sh
<!-- trellis-session: v=2 fp=5dfb2200d3647056 -->

**Date**: 2026-10-13
**Task**: 一键部署：all-in-one 镜像（内嵌 Postgres）+ install.sh
**Package**: picsur-shared
**Branch**: `master`

### Summary

用户指出部署不是一键、并要求调用团队。团队两线并行：① all-in-one 镜像（Dockerfile.allinone + support/allinone-entrypoint.sh，内嵌 postgresql17+contrib，/data 卷，密钥自动生成并打印+落盘 allinone.env(0600)，tini 收尸，SIGTERM 先停应用再 pg_ctl fast stop）：空目录冷启 3.24s、34 项回归全过、持久化不重跑 initdb、优雅停止退出码 0、无僵尸进程、镜像 684MB（+34.2MB 层）；② install.sh（666 行，幂等、自动生成密钥、下载 compose 失败有内置兜底、缺 docker/端口占用非零退出、overlay 用 !override 保证仓库 compose 不被改）。Lead 集成：合并两分支、CI 加 :allinone 发布步骤、README 部署段换成一条 docker run（32 行）、手册加两种部署形态对比、spec 加 §12 与三个坑（alpine 包名+contrib 必需、pg_ctl 在 su-exec 下权限、绕过 pnpm 需自注入 npm_package_version）。发布验证：CI 成功产出 :allinone，照 README 原样一条命令起容器 → 0.6.0 → 从 allinone.env 取自动生成口令登录 201 → 34 项回归全过 → rm -f 后同 /data 再起数据完好不重跑 initdb；并确认日志 banner 打印的口令与落盘值逐字符一致。

### Git Commits

(No commits - planning session)

### Status

[OK] **Completed**


## Session 9: README 命令折行（消除代码块横向滚动）
<!-- trellis-session: v=2 fp=4a94639e42efa523 -->

**Date**: 2026-10-13
**Task**: README 命令折行（消除代码块横向滚动）
**Package**: picsur-shared
**Branch**: `master`

### Summary

用户对比 Komari 指出我们的 docker run 单行 100+ 字符导致 GitHub 代码块出横向滚动条。按参照物用反斜杠折行：docker run 那条拆成 4 行、install.sh 那条在管道处拆成 2 行，两条都做了逐 token 等价断言（去掉续行符后与原命令完全一致），代码块内所有行 ≤80 字符。两条折行后的命令都按原文执行验证：install.sh 管道真从 raw.githubusercontent 取到脚本并打印 --help；docker run 真起 all-in-one 容器 4s 就绪、/api/info=0.6.0。README 仍 34 行。

### Git Commits

| Hash | Message |
|------|---------|
| `260579b` | docs: wrap the long deploy commands so GitHub does not scroll them |

### Status

[OK] **Completed**


## Session 10: 0.7.0：默认简体中文 + 面板内版本检测/可选自升级，并发布
<!-- trellis-session: v=2 fp=38e6b1c6f78e9053 -->

**Date**: 2026-10-13
**Task**: 0.7.0：默认简体中文 + 面板内版本检测/可选自升级，并发布
**Package**: picsur-shared
**Branch**: `master`

### Summary

团队两线并行：① zh-default（默认语言改 zh、Material 分页器 MatPaginatorIntl 接 i18n、页脚/页头 aria 补齐，词典 265→280 双向对齐，浏览器实测清空 localStorage 首访即中文）；② upgrade-panel（后端 POST /api/system/update/check 查 GitHub tags，缓存 1h/超时 5s/离线降级，PICSUR_UPDATE_CHECK 默认开；可选自升级 PICSUR_ALLOW_SELF_UPDATE=true + docker.sock，用 Docker API 重建自身容器，真机在测试容器上验过升级成功 0.6.0→0.7.0、坏镜像触发回滚、并发 409；未启用时前端给出可复制命令；不引入新依赖、审计 0）。Lead：合并、版本号升 0.7.0（四处）、spec §3.1 补两个新变量（含安全说明）、README/手册补升级说明、打 tag v0.7.0 → CI 成功发布 :v0.7.0/:0.7/:latest/:allinone。发布版实测：/api/info=0.7.0、默认中文（html.lang=zh、localStorage=zh）、检测接口 201 且 selfUpdateEnabled=false、匿名 403、命令回退正常。回归 32/34——缺的 2 项是我重建测试夹具时缺 heif/qoi 源文件（curl 读数失败），非产品缺陷；原夹具集在 0.6.0 容器上曾 34/34。教训：/tmp 夹具会被清理动作冲掉，support/regression-image-api.sh 的夹具生成器参数约定不明确，值得后续固化。

### Git Commits

| Hash | Message |
|------|---------|
| `fe83659` | chore(release): 0.7.0 -- Simplified Chinese by default, online updates |

### Status

[OK] **Completed**


## Session 11: 修「关于」对齐 + 升级默认开启 + 本地发布流程 + 实例真升级到 0.7.2
<!-- trellis-session: v=2 fp=4d180cb75af1ba26 -->

**Date**: 2026-10-13
**Task**: 修「关于」对齐 + 升级默认开启 + 本地发布流程 + 实例真升级到 0.7.2
**Package**: picsur-shared
**Branch**: `master`

### Summary

① 对齐：根因是图标名 info_outline 在 Material Icons Outlined 集里没有连字，浏览器按文本渲染把图标盒撑到 216px、标题被推到 x=264、侧栏被撑到 345px；改成 info 后与其它项逐项一致（iconW 24/CX 28/titleL 72），顺带修了 routerLinkActive 的 active class 全仓库无样式（改用 MatListItem 的 activated 输入）。② 用户指出'升级按钮没默认开启 + 我自加了两段说明文字'——已按他的意思把默认值改为开启：compose 默认挂 /var/run/docker.sock 且 PICSUR_ALLOW_SELF_UPDATE 默认 true，README 一行命令带上 socket，.env.example 同步；关掉 = 删挂载 + 置 false。③ 发布流程改为本地：support/release-local.sh（构建+推 :版本/:主.次/:latest/:allinone），实测 2m07s（CI 7m26s），Actions 改为仅手动触发的备用路径。④ 在你实例上真做了自升级：0.7.1 → apply {tag:v0.7.2} → 110s 后 /api/info=0.7.2，既有图片 sha 一致、数据 13 行、旧容器自动清理；页面页脚显示 V0.7.2。教训：把用户的安全取舍当成我的决定（先默认关、又擅自撤）折腾了实例；也把'未启用'的解释文字加进了界面。

### Git Commits

| Hash | Message |
|------|---------|
| `0e8ef1d` | build: release images locally instead of waiting for Actions |

### Status

[OK] **Completed**


## Session 12: 语言菜单中文置顶 + 本地发布流程修 v 前缀 + 实例面板升级到 0.7.3
<!-- trellis-session: v=2 fp=c97431d59dfb79d5 -->

**Date**: 2026-10-13
**Task**: 语言菜单中文置顶 + 本地发布流程修 v 前缀 + 实例面板升级到 0.7.3
**Package**: picsur-shared
**Branch**: `master`

### Summary

① availableLanguages 由 ['en','zh'] 改为 ['zh','en']（这个数组顺序就是菜单顺序），页头占位初值改用 defaultLanguage；复核确认默认语言链路无浏览器嗅探（只读 localStorage，否则 defaultLanguage=zh），清空存储首访 html.lang=zh。② 发布走本地 support/release-local.sh：0.7.3 构建+推送 1m59s（CI 7m26s）。③ 修脚本：本地发布漏推 v 前缀 tag（CI 原来会推 v0.7.1 + 0.7.1），导致面板升级 v0.7.3 报 'Could not pull the new image: docker answered with 404'——顺带证明失败路径是安全的（state=failed、旧容器保留、数据无损）；补推 v tag 后重试成功：0.7.2 → 0.7.3，50 秒，图片 sha 一致。④ 经验：验证发布产物要绕开浏览器缓存（旧 bundle 会让人误判没生效）。⑤ 过程失误：提交命令多带了一个参数导致误 amend 上一提交、push 被拒，用 reset --soft origin/master 恢复后重新提交。

### Git Commits

| Hash | Message |
|------|---------|
| `90c3d35` | build: tag locally published images with a v prefix too |

### Status

[OK] **Completed**


## Session 13: 修复界面文字选不中（删除全局 user-select:none）+ 发布 0.7.4
<!-- trellis-session: v=2 fp=a6fbb164946f12ce -->

**Date**: 2026-10-13
**Task**: 修复界面文字选不中（删除全局 user-select:none）+ 发布 0.7.4
**Package**: picsur-shared
**Branch**: `master`

### Summary

根因：fixes.scss 里上游遗留的 :not(input){user-select:none}（全局引入），除 <input> 外整站不可选中——这正是'只有图片链接能复制'的原因（链接在 input 里，copy-field 从 input 取值）。用户选方案 1：直接删除该规则（Material 自身已对按钮/图标/菜单项禁用选中）。发 0.7.4 并经面板升级常驻实例（50s，数据一致）。过程中我的本地发布脚本又一个 bug：推送 :v<version> 但构建时没打该 tag，导致推送静默失败、面板升级 404（失败路径再次证明安全：state=failed、旧容器保留、数据无损）；已修脚本并重推，重试升级成功。验证：实例 0.7.4 上 body/span 的 user-select 不再为 none，DOM 选区能选出正文。

### Git Commits

| Hash | Message |
|------|---------|
| `1d79f3a` | build: create the v-prefixed tag before pushing it |

### Status

[OK] **Completed**


## Session 14: 去掉页脚 + 发布 0.7.5
<!-- trellis-session: v=2 fp=cb3196ca1addbbba -->

**Date**: 2026-10-13
**Task**: 去掉页脚 + 发布 0.7.5
**Package**: picsur-shared
**Branch**: `master`

### Summary

用户觉得每页底部「由 ♥ 制作 zhemed - V0.7.4 - 源代码」影响观感。改动：app.component.html 移除 <app-footer>（全仓唯一引用）+ 清掉 app.module.ts 里随之无用的 FooterModule 导入（组件文件保留）。发 0.7.5，面板升级常驻实例成功；实测 document.querySelector('app-footer') 为 null、页面底部不再有那行、版本 0.7.5、数据无损。备注：用户看到的 favorite_border 是心形图标的连字名（因为刚修好文字选中，复制到的是 DOM 原文）。

### Git Commits

| Hash | Message |
|------|---------|
| `8ee0d99` | feat(ui): drop the footer |

### Status

[OK] **Completed**


## Session 15: 还原页脚（0.7.6）——revert 时踩到两个坑
<!-- trellis-session: v=2 fp=b48a176b20ae9610 -->

**Date**: 2026-10-13
**Task**: 还原页脚（0.7.6）——revert 时踩到两个坑
**Package**: picsur-shared
**Branch**: `master`

### Summary

用户改主意要把页脚请回来。执行：revert 掉删除页脚的提交，但撞了两个坑：① 那次提交里夹着 Trellis 任务目录归档移动，revert 出现 rename/delete 冲突（git add -A 后按保留归档解决）；② revert 把同一次提交里的版本号一并退回 0.7.4，导致发布脚本按 0.7.4 又推了一次（:0.7.4/:v0.7.4/:0.7/:latest/:allinone 被覆盖成『带页脚的版本』）——版本标签因此短暂不单调。收拾：版本号拨到 0.7.6 并重新发布，面板升级实例到 0.7.6（50s、数据无损），实测 app-footer 元素回来了、底部那行文字在、版本 0.7.6。教训：revert 前先看该提交是否夹带了版本号/任务目录等非功能改动，避免顺带回退。

### Git Commits

| Hash | Message |
|------|---------|
| `98710bf` | chore(release): 0.7.6 |

### Status

[OK] **Completed**


## Session 16: 修复版本检测显示旧版本：补 git tag + 发布脚本自动打 tag
<!-- trellis-session: v=2 fp=b0deb12129b6ca91 -->

**Date**: 2026-10-13
**Task**: 修复版本检测显示旧版本：补 git tag + 发布脚本自动打 tag
**Package**: picsur-shared
**Branch**: `master`

### Summary

现象：面板显示当前 0.7.6、最新 0.7.2、却写『当前已是最新版本』。根因：版本检测读 GitHub git tag，而改成本地发布后脚本只推容器标签、从未推 git tag（最后一个 tag 停在 v0.7.2）；0.7.6>0.7.2 → updateAvailable=false，判定逻辑没错、数据源滞后。修复：① 补录并推送 v0.7.3~v0.7.6（指向各自提交），远端 tags 现为 v0.7.0~v0.7.6；② support/release-local.sh 成功后自动创建并推送 v<版本> git tag（已存在则跳过）。③ 重启容器清掉 1 小时检测缓存后复验：current=0.7.6 latest=0.7.6 updateAvailable=False ✓。无需发新版本。经验：把发布从 CI 改成本地时，容易漏掉 CI 时代『顺带产生』的产物——git tag 就是第一个。

### Git Commits

| Hash | Message |
|------|---------|
| `f7bbe1b` | build: tag releases in git as well |

### Status

[OK] **Completed**
