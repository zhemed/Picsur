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

# ============================================================
# 阶段 1：JS 产物（shared → frontend → backend）
# ============================================================
# 注意：必须是 node:20（完整镜像，自带 python3/gcc/g++/make），不能用 -slim ——
# 依赖里有 qoi-img / bmp-img / posix.js 是走 node-gyp 源码编译的。
# Node 版本必须是 20：Node ≥22.16 的 N-API 签名变更会让这些包编译失败（实测）。
FROM node:20 AS js_builder

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
FROM node:20-alpine AS vips_builder

RUN apk add --no-cache build-base meson cmake pkgconfig glib-dev \
    expat-dev libexif-dev jpeg-dev libjxl-dev openjpeg-dev libpng-dev \
    tiff-dev libheif-dev libwebp-dev cgif-dev imagemagick-dev \
    librsvg-dev pango-dev cfitsio-dev poppler-dev libspng-dev \
    lcms2-dev fftw-dev libimagequant-dev

WORKDIR /vips
RUN wget -q https://github.com/libvips/libvips/releases/download/v8.18.7/vips-8.18.7.tar.xz -O vips.tar.xz \
 && tar -xf vips.tar.xz && rm vips.tar.xz
RUN cd vips-*/ \
 && meson setup build -Dexamples=false \
 && cd build \
 && meson compile -j4 \
 && meson install

# ============================================================
# 阶段 3：vips 运行时（只带运行期依赖）
# ============================================================
FROM node:20-alpine AS vips_runtime

COPY --from=vips_builder /usr/local /usr/local
RUN apk add --no-cache pkgconfig glib expat libexif jpeg libjxl openjpeg libpng tiff \
    libheif libwebp cgif imagemagick librsvg pango cfitsio poppler poppler-glib \
    libspng lcms2 fftw libimagequant

# ============================================================
# 阶段 4：生产依赖（sharp 必须从源码编译，链接到我们自编译的 libvips）
# ============================================================
FROM vips_builder AS prod_deps

# node-addon-api / node-gyp 供 sharp 的源码构建使用（sharp 自己的 node_modules 是空的，
# 所以用 NODE_PATH 指到全局安装位置给它解析）
RUN npm install -g pnpm@9.6.0 node-gyp node-addon-api
# sharp 从源码编译需要 python3 + 编译工具链
RUN apk add --no-cache python3 build-base

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
COPY --from=prod_deps /picsur ./

CMD ["pnpm", "--filter", "picsur-backend", "start:prod"]
