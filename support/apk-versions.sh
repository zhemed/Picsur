#!/usr/bin/env bash
# 解析 Dockerfile / Dockerfile.allinone 各阶段应锁定的 apk 版本（审计 C-M5）。
#
# 为什么需要它：镜像为了可复现，把 apk 包锁到了具体版本（`pkg=1.2.3-r4`）。
# Alpine 一发新的 -rN 修订，旧的那份就从软件源消失，`docker build` 会报
# "unable to select packages" —— 这时跑本脚本重新解析，把新版本号同步进 Dockerfile 即可。
#
# 用法：
#   bash support/apk-versions.sh            # 打印四个阶段的锁定清单（默认）
#   APK_BASE_IMAGE=node:20-alpine bash support/apk-versions.sh
#
# 说明：解析用的是**当前**软件源（Alpine 3.23）在 amd64 上的版本号；
# arm64 上同一分支的修订号可能不同（锁版本带来的已知代价，见 Dockerfile 顶部注释）。
set -euo pipefail

BASE_IMAGE="${APK_BASE_IMAGE:-node:20-alpine}"

command -v docker >/dev/null 2>&1 || { echo "❌ 需要 docker" >&2; exit 1; }
docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || {
  echo "▶ 本地没有 $BASE_IMAGE，先 docker pull"
  docker pull "$BASE_IMAGE" >/dev/null
}

docker run --rm "$BASE_IMAGE" sh -c '
apk update >/dev/null 2>&1
sim() { # 只打印显式列出的包（不展开传递依赖）
  apk add --no-cache --simulate "$@" 2>&1 \
    | sed -n "s/^([ 0-9]*\/[0-9]*) Installing \([^ ]*\) (\([^)]*\)).*/\1=\2/p" \
    | grep -E "^($(printf "%s|" "$@" | sed "s/|$//"))=" | tr "\n" " "
  echo
}
echo "### Dockerfile 阶段 2（vips_builder）："
sim build-base meson cmake pkgconf glib-dev expat-dev libexif-dev jpeg-dev \
    libjxl-dev openjpeg-dev libpng-dev tiff-dev libheif-dev libwebp-dev cgif-dev \
    imagemagick-dev librsvg-dev pango-dev cfitsio-dev poppler-dev libspng-dev \
    lcms2-dev fftw-dev libimagequant-dev
echo "### Dockerfile 阶段 3（vips_runtime）："
sim pkgconf glib expat libexif jpeg libjxl openjpeg libpng tiff libheif libwebp \
    cgif imagemagick librsvg pango cfitsio poppler poppler-glib libspng lcms2 fftw \
    libimagequant
echo "### Dockerfile 阶段 4（prod_deps 额外）："
sim python3 build-base
echo "### Dockerfile.allinone："
sim postgresql17 postgresql17-client postgresql17-contrib tini su-exec
'
echo
echo "提示：上面每行直接替换 Dockerfile 里对应的 apk add 列表即可（保持 \`pkg=版本\` 形式）。"
