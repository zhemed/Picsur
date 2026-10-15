# Picsur 自有镜像（zhemed/Picsur）
#
# 与上游 support/picsur-stage1.Dockerfile + picsur-stage2.Dockerfile 的区别：
#   1. JS 构建阶段内联在本文件里 —— 上游那套 stage2 依赖它自己的**私有中间镜像**，
#      那个镜像随时可能被清理，构建就废了；本文件不依赖任何外部构建产物。
#   2. pnpm 固定为 9.6.0，与根 package.json 的 packageManager 字段一致（可复现）。
#   3. libvips 编译限制并行度（-j4），避免在小内存机器上 OOM。
#   4. 生产依赖在「目标平台 + 全局 libvips」下重新安装，保证 sharp 是针对 musl + 全局 vips 编译的。
#
# 构建（在仓库根目录）：docker build -t zhemed/picsur:local .
# 说明：镜像内固定 PICSUR_PRODUCTION=true —— TypeORM 不再 synchronize，只跑 migrations。
#
# 可复现性（2026-10-15 审计 C-M5）：
#   * 基础镜像锁 digest（node:20 / node:20-alpine），digest 由 Dependabot 每周提 PR 更新；
#   * apk 包锁到具体版本（Alpine 3.23 当前版本）—— Alpine 一发新的 -rN 修订，这里就会
#     构建失败（"unable to select packages"），用 `bash support/apk-versions.sh` 重新解析并更新；
#     注意：锁的是 amd64 的版本号，arm64 上同一 Alpine 分支的修订号可能不同；
#   * libvips 源码包校验 sha256（值同时核对过 GitHub release asset 的 digest）；
#   * 全局 node-gyp / node-addon-api 锁版本（与 lockfile 里的解析结果一致）。

# ============================================================
# 阶段 1：JS 产物（shared → frontend → backend）
# ============================================================
# 注意：必须是 node:20（完整镜像，自带 python3/gcc/g++/make），不能用 -slim ——
# 依赖里有 qoi-img / bmp-img / posix.js 是走 node-gyp 源码编译的。
# Node 版本必须是 20：Node ≥22.16 的 N-API 签名变更会让这些包编译失败（实测）。
FROM node:25@sha256:78839ac448c23517f8eab2e8f7943d9b4f73979eb7f8bed2c73dbf72ff869e7b AS js_builder

RUN npm install -g pnpm@9.6.0

WORKDIR /picsur
COPY . .

RUN pnpm install --frozen-lockfile

# 顺序不能变：backend / frontend 直接 import picsur-shared/dist/*
RUN pnpm --filter picsur-shared build \
 && pnpm --filter picsur-frontend build \
 && pnpm --filter picsur-backend build

# 只保留生产运行需要的东西（dist + package.json + 锁文件 + 品牌资源）
RUN mkdir -p /trimmed \
 && cp -r --parents ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./branding /trimmed \
 && cp -r --parents ./frontend/dist ./frontend/package.json /trimmed \
 && cp -r --parents ./backend/dist ./backend/package.json /trimmed \
 && cp -r --parents ./shared/dist ./shared/package.json /trimmed

# ============================================================
# 阶段 2：编译 libvips（HEIF / JPEG-XL / JPEG2000 等编解码在这一层）
# ============================================================
# 版本不能低于 8.18.7：sharp 0.35.x 的 package.json config.libvips 要求 >=8.18.7，
# 低于它 sharp 的 install 脚本会拒绝用全局 libvips（SHARP_FORCE_GLOBAL_LIBVIPS 下仍会失败）。
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS vips_builder

RUN apk add --no-cache \
    build-base=0.5-r3 meson=1.9.1-r0 cmake=4.1.3-r0 pkgconf=2.5.1-r0 \
    glib-dev=2.86.3-r0 expat-dev=2.8.5-r0 libexif-dev=0.6.26-r0 jpeg-dev=9f-r0 \
    libjxl-dev=0.11.2-r0 openjpeg-dev=2.5.4-r2 libpng-dev=1.6.59-r0 tiff-dev=4.7.2-r0 \
    libheif-dev=1.23.0-r0 libwebp-dev=1.6.0-r0 cgif-dev=0.5.4-r0 \
    imagemagick-dev=7.1.2.29-r0 librsvg-dev=2.61.2-r0 pango-dev=1.56.4-r0 \
    cfitsio-dev=4.6.3-r0 poppler-dev=25.12.0-r0 libspng-dev=0.7.4-r1 \
    lcms2-dev=2.19-r0 fftw-dev=3.3.10-r7 libimagequant-dev=4.2.2-r0

WORKDIR /vips
# sha256 由 GitHub release asset 的 digest 交叉核对过（2026-10-15）
RUN wget -q https://github.com/libvips/libvips/releases/download/v8.18.7/vips-8.18.7.tar.xz -O vips.tar.xz \
 && echo "5baaead3b0bb20ffdb9e9ff09aa9fda08620923df77b63b436654cb5e0b3bf94  vips.tar.xz" | sha256sum -c - \
 && tar -xf vips.tar.xz && rm vips.tar.xz
RUN cd vips-*/ \
 && meson setup build -Dexamples=false \
 && cd build \
 && meson compile -j4 \
 && meson install

# ============================================================
# 阶段 3：vips 运行时（只带运行期依赖）
# ============================================================
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS vips_runtime

COPY --from=vips_builder /usr/local /usr/local
RUN apk add --no-cache \
    pkgconf=2.5.1-r0 glib=2.86.3-r0 expat=2.8.5-r0 libexif=0.6.26-r0 jpeg=9f-r0 \
    libjxl=0.11.2-r0 openjpeg=2.5.4-r2 libpng=1.6.59-r0 tiff=4.7.2-r0 \
    libheif=1.23.0-r0 libwebp=1.6.0-r0 cgif=0.5.4-r0 imagemagick=7.1.2.29-r0 \
    librsvg=2.61.2-r0 pango=1.56.4-r0 cfitsio=4.6.3-r0 poppler=25.12.0-r0 \
    poppler-glib=25.12.0-r0 libspng=0.7.4-r1 lcms2=2.19-r0 fftw=3.3.10-r7 \
    libimagequant=4.2.2-r0

# ============================================================
# 阶段 4：生产依赖（sharp 必须从源码编译，链接到我们自编译的 libvips）
# ============================================================
FROM vips_builder AS prod_deps

# node-addon-api / node-gyp 供 sharp 的源码构建使用（sharp 自己的 node_modules 是空的，
# 所以用 NODE_PATH 指到全局安装位置给它解析）；版本锁死，避免构建工具悄悄换代。
RUN npm install -g pnpm@9.6.0 node-gyp@11.5.0 node-addon-api@8.2.2
# sharp 从源码编译需要 python3 + 编译工具链
RUN apk add --no-cache python3=3.12.15-r0 build-base=0.5-r3

WORKDIR /picsur
COPY --from=js_builder /trimmed ./

ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
RUN pnpm install --frozen-lockfile --prod

# ⚠️ 关键：sharp >= 0.33 的安装流程**不会**自动从源码构建 —— 它只装预编译的
# `@img/sharp-*`（自带一份精简 libvips，**不含 JPEG-XL / JPEG2000 编解码**，
# SHARP_FORCE_GLOBAL_LIBVIPS 也不再被安装流程读取）。要拿到我们自编译 libvips 的
# 全量编解码（HEIF / JXL / JP2 / PDF / Magick），必须显式跑一次 sharp 的源码构建。
RUN cd /picsur/backend/node_modules/sharp \
 && SHARP_FORCE_GLOBAL_LIBVIPS=1 NODE_PATH=/usr/local/lib/node_modules node install/build.js

# ============================================================
# 阶段 5：最终镜像
# ============================================================
FROM vips_runtime

RUN npm install -g pnpm@9.6.0

ENV PICSUR_PRODUCTION=true

WORKDIR /picsur
# 以非 root 运行（审计 C-M6）：
#   * `--chown=node:node` 让 /picsur（含 frontend/dist 静态产物、backend/dist、node_modules）可读；
#   * 应用只写数据库与 /tmp（上传内容存 Postgres，不落盘），所以不需要写 /picsur；
#   * CMD 仍是 pnpm（为了注入 npm_package_version 给 /api/info），node 用户的 HOME=/home/node 可写。
#   * ⚠️ 面板内一键升级需要访问宿主 docker.sock：socket 属于宿主 root:docker，容器里 uid 1000
#     默认**没有**权限。要保留这个能力，compose 里用 `group_add` 把宿主 docker 组 GID 加进来
#     （install.sh 会自动探测并写进受管 override；手工部署见 .env.example 的 PICSUR_DOCKER_GID）。
#     不加也能跑：应用会检测到 socket 不可用，面板退化为显示可复制的升级命令。
COPY --from=prod_deps --chown=node:node /picsur ./

USER node

CMD ["pnpm", "--filter", "picsur-backend", "start:prod"]
