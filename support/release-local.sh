#!/usr/bin/env bash
# 本地构建并推送镜像到 ghcr.io —— 比 GitHub runner 快得多（热缓存约 2 分钟 vs CI 7+ 分钟）
#
# 用法：bash support/release-local.sh [--no-allinone] [--dry-run] [--allow-dirty] [--allow-downgrade]
#   版本号取自根 package.json；推送 :<版本>、:v<版本>、:<主.次>、:latest、:allinone
#   需要先登录（别把 token 写进命令行，会留在 shell 历史里）：
#     docker login ghcr.io -u <用户> --password-stdin
#
# 发布前会做四道检查（都可以显式跳过，但不能默认糊过去）：
#   1. 工作树干净、提交已推送 —— 镜像必须对应一个已推送的提交（--allow-dirty 跳过）
#   2. v<版本> tag 若已存在，必须指向当前 HEAD（--allow-dirty 跳过）
#   3. 版本号不得低于远端最新 tag，否则 :latest 会回退（--allow-downgrade 跳过）
#   4. docker 可用 + 已登录 ghcr（登录缺失只警告）
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
    --allow-downgrade) ALLOW_DOWNGRADE=1 ;;
    *) echo "❌ 未知参数：$a（支持 --no-allinone / --dry-run / --allow-dirty / --allow-downgrade）"; exit 2 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then echo "❌ docker 不可用"; exit 1; fi
if [ "${DRY:-0}" != "1" ]; then
  if ! grep -q '"ghcr.io"' ~/.docker/config.json 2>/dev/null; then
    echo "⚠️  看起来还没登录 ghcr.io：docker login ghcr.io -u <用户> --password-stdin"
  fi
fi

HEAD_SHA="$(git rev-parse HEAD)"

# —— 守卫 1：脏树/未推送提交（镜像必须对应一个已推送的提交；本次教训：提交被闸门拒后仍发布了镜像）
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

# —— 守卫 2：v<版本> tag 必须指向当前 HEAD（否则镜像与 tag 指向不同提交，无从追溯）
local_tag_sha=""
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null 2>&1; then
  local_tag_sha="$(git rev-parse "refs/tags/v$VERSION^{commit}" 2>/dev/null || true)"
  if [ -n "$local_tag_sha" ] && [ "$local_tag_sha" != "$HEAD_SHA" ]; then
    echo "❌ 本地 tag v$VERSION 指向 $local_tag_sha，不是当前 HEAD $HEAD_SHA"
    echo "   要么改版本号，要么删掉这个 tag 再发（--allow-dirty 可跳过本检查）"
    [ "${ALLOW_DIRTY:-0}" = "1" ] || exit 1
  fi
fi

# 远端 tag 的两种形态（annotated 会带一条 ^{} 的 peel 记录）
remote_refs="$(git ls-remote --tags origin "refs/tags/v$VERSION" "refs/tags/v$VERSION^{}" 2>/dev/null || true)"
remote_tag_sha="$(printf '%s\n' "$remote_refs" | awk '/\^\{\}$/{print $1}' | head -1)"
[ -n "$remote_tag_sha" ] || remote_tag_sha="$(printf '%s\n' "$remote_refs" | awk 'NF==2{print $1}' | head -1)"
if [ -n "$remote_tag_sha" ] && [ "$remote_tag_sha" != "$HEAD_SHA" ] && [ -z "$local_tag_sha" ]; then
  echo "❌ 远端已有 tag v$VERSION，但它指向 $remote_tag_sha，不是当前 HEAD $HEAD_SHA"
  echo "   同一个版本号不能对应两个提交（--allow-dirty 可跳过本检查）"
  [ "${ALLOW_DIRTY:-0}" = "1" ] || exit 1
fi

# —— 守卫 3：不能把 :latest 往回推（版本号必须 ≥ 远端最新 tag）
remote_tags="$(git ls-remote --tags --refs origin 'v*' 2>/dev/null | sed -n 's#.*refs/tags/v##p' || true)"
if [ -z "$remote_tags" ]; then
  echo "⚠️  拿不到远端 tag 列表（离线？），跳过「版本回退」检查"
else
  highest="$(printf '%s\n' "$remote_tags" | grep -E '^[0-9]+(\.[0-9]+)+$' | sort -V | tail -1 || true)"
  if [ -n "$highest" ] && [ "$highest" != "$VERSION" ]; then
    newer="$(printf '%s\n%s\n' "$highest" "$VERSION" | sort -V | tail -1)"
    if [ "$newer" != "$VERSION" ]; then
      echo "❌ 当前版本 $VERSION 低于远端最新 v$highest：继续发布会把 :latest 回退到旧版本"
      echo "   先同步版本号，或确认要降级时加 --allow-downgrade"
      [ "${ALLOW_DOWNGRADE:-0}" = "1" ] || exit 1
      echo "⚠️  --allow-downgrade 已设置，继续用旧版本覆盖 :latest"
    fi
  fi
fi

echo "▶ 构建 $IMAGE:$VERSION（同时打 :v$VERSION / :$MINOR / :latest）"
docker build -t "$IMAGE:$VERSION" -t "$IMAGE:v$VERSION" -t "$IMAGE:$MINOR" -t "$IMAGE:latest" .
if [ "$BUILD_ALLINONE" = "1" ]; then
  echo "▶ 构建 $IMAGE:allinone（基底用刚构建的 :$VERSION）"
  docker build -f Dockerfile.allinone --build-arg "PICSUR_BASE_IMAGE=$IMAGE:$VERSION" -t "$IMAGE:allinone" .
fi

if [ "${DRY:-0}" = "1" ]; then echo "✅ dry-run：镜像已构建但未推送"; exit 0; fi
for t in "$VERSION" "v$VERSION" "$MINOR" latest; do echo "▶ push $IMAGE:$t"; docker push "$IMAGE:$t"; done
TAIL=""
if [ "$BUILD_ALLINONE" = "1" ]; then
  echo "▶ push $IMAGE:allinone"
  docker push "$IMAGE:allinone"
  TAIL=" / :allinone"
fi
# 自动打并推送 git tag（面板的版本检测读的就是 GitHub tags；以前 CI 靠 tag 触发天然有，改本地发布后必须自己打）
if [ -n "$local_tag_sha" ]; then
  echo "▶ git tag v$VERSION 已存在且指向当前提交，跳过"
else
  git tag -a "v$VERSION" -m "release $VERSION"
  git push origin "v$VERSION"
  echo "▶ 已推送 git tag v$VERSION"
fi
echo "✅ 完成：$IMAGE:$VERSION / :v$VERSION / :$MINOR / :latest$TAIL"
