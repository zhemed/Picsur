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
    --allow-dirty) ALLOW_DIRTY=1 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then echo "❌ docker 不可用"; exit 1; fi
if [ "${DRY:-0}" != "1" ]; then
  if ! grep -q '"ghcr.io"' ~/.docker/config.json 2>/dev/null; then
    echo "⚠️  看起来还没登录 ghcr.io：docker login ghcr.io -u <用户> -p <token>"
  fi
fi

# 脏树/未推送守卫：镜像必须对应一个已推送的提交，否则无从追溯（本次教训：提交被闸门拒后仍发布了镜像）
if [ "${ALLOW_DIRTY:-0}" != "1" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "❌ 工作树不干净：请先提交（或用 --allow-dirty 显式跳过此检查）"
    git status --short | head -10
    exit 1
  fi
  if [ -n "$(git log --oneline @{u}..HEAD 2>/dev/null)" ]; then
    echo "❌ 有未推送的提交：请先 git push（或用 --allow-dirty 跳过）"
    git log --oneline @{u}..HEAD | head -5
    exit 1
  fi
fi

echo "▶ 构建 $IMAGE:$VERSION（同时打 :latest 与 :$MINOR）"
docker build -t "$IMAGE:$VERSION" -t "$IMAGE:v$VERSION" -t "$IMAGE:$MINOR" -t "$IMAGE:latest" .
if [ "$BUILD_ALLINONE" = "1" ]; then
  echo "▶ 构建 $IMAGE:allinone（基底用刚构建的 :$VERSION）"
  docker build -f Dockerfile.allinone --build-arg "PICSUR_BASE_IMAGE=$IMAGE:$VERSION" -t "$IMAGE:allinone" .
fi

if [ "${DRY:-0}" = "1" ]; then echo "✅ dry-run：镜像已构建但未推送"; exit 0; fi
for t in "$VERSION" "v$VERSION" "$MINOR" latest; do echo "▶ push $IMAGE:$t"; docker push "$IMAGE:$t"; done
[ "$BUILD_ALLINONE" = "1" ] && { echo "▶ push $IMAGE:allinone"; docker push "$IMAGE:allinone"; }
# 自动打并推送 git tag（版本检测读的就是它；以前 CI 靠 tag 触发天然有，改本地发布后必须自己打）
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  echo "▶ git tag v$VERSION 已存在，跳过"
else
  git tag -a "v$VERSION" -m "release $VERSION"
  git push origin "v$VERSION"
  echo "▶ 已推送 git tag v$VERSION"
fi
echo "✅ 完成：$IMAGE:$VERSION / :v$VERSION / :$MINOR / :latest${BUILD_ALLINONE:+ / :allinone}"
