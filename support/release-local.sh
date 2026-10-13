#!/usr/bin/env bash
# 本地构建并推送镜像到 ghcr.io —— 比 GitHub runner 快得多（热缓存约 2 分钟 vs CI 7+ 分钟）
#
# 用法：bash support/release-local.sh [--no-allinone] [--dry-run]
#   版本号取自根 package.json；推送 :<版本>、:<主.次>、:latest、:allinone
#   需要先登录：docker login ghcr.io -u <用户> -p <token(含 write:packages)>
set -euo pipefail
cd "$(dirname "$0")/.."

PY=$(command -v python3 || command -v python)
VERSION=$("$PY" -c 'import json;print(json.load(open("package.json"))["version"])')
IMAGE=ghcr.io/zhemed/picsur
MINOR=${VERSION%.*}
BUILD_ALLINONE=1
for a in "$@"; do
  case "$a" in
    --no-allinone) BUILD_ALLINONE=0 ;;
    --dry-run) DRY=1 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then echo "❌ docker 不可用"; exit 1; fi
if [ "${DRY:-0}" != "1" ]; then
  if ! grep -q '"ghcr.io"' ~/.docker/config.json 2>/dev/null; then
    echo "⚠️  看起来还没登录 ghcr.io：docker login ghcr.io -u <用户> -p <token>"
  fi
fi

echo "▶ 构建 $IMAGE:$VERSION（同时打 :latest 与 :$MINOR）"
docker build -t "$IMAGE:$VERSION" -t "$IMAGE:$MINOR" -t "$IMAGE:latest" .
if [ "$BUILD_ALLINONE" = "1" ]; then
  echo "▶ 构建 $IMAGE:allinone（基底用刚构建的 :$VERSION）"
  docker build -f Dockerfile.allinone --build-arg "PICSUR_BASE_IMAGE=$IMAGE:$VERSION" -t "$IMAGE:allinone" .
fi

if [ "${DRY:-0}" = "1" ]; then echo "✅ dry-run：镜像已构建但未推送"; exit 0; fi
for t in "$VERSION" "v$VERSION" "$MINOR" latest; do echo "▶ push $IMAGE:$t"; docker push "$IMAGE:$t"; done
[ "$BUILD_ALLINONE" = "1" ] && { echo "▶ push $IMAGE:allinone"; docker push "$IMAGE:allinone"; }
echo "✅ 完成：$IMAGE:$VERSION / :v$VERSION / :$MINOR / :latest${BUILD_ALLINONE:+ / :allinone}"
