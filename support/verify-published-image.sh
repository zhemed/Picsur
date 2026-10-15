#!/usr/bin/env bash
# 验证 ghcr 上发布的镜像真的能用：
#   拉镜像 → 用隔离的 compose 项目/端口/卷起一套 → /api/info 版本 → 34 项回归 → 清理
# 全程不碰常驻栈（8080 / picsur-data）。
set -uo pipefail
cd "$(dirname "$0")/.."
set -a
. ./.env
set +a

TAG="${1:-latest}"
EXPECT_VER="${2:-${TAG#v}}"   # 期望版本号：默认取 tag（v0.7.0 -> 0.7.0）
IMAGE="ghcr.io/zhemed/picsur:${TAG}"
PROJECT=picsur-ghcr
PORT=8099
BASE="http://127.0.0.1:${PORT}"
PASS=0
FAIL=0
ok() {
  echo "  ✅ $1"
  PASS=$((PASS + 1))
}
bad() {
  echo "  ❌ $1"
  FAIL=$((FAIL + 1))
}

cat > /tmp/verify-override.yml << YML
services:
  picsur:
    container_name: picsur-verify
    # !override 才会替换掉基础文件里的 8080:8080（否则 compose 是追加列表，撞端口）
    ports: !override
      - '${PORT}:8080'
  picsur_postgres:
    container_name: picsur-verify-pg
volumes:
  picsur-data:
    name: picsur-verify-data
YML

echo "=== 1. 拉取发布镜像 ==="
if docker pull "$IMAGE" > /tmp/pull.log 2>&1; then
  ok "$(grep -m1 'Status:' /tmp/pull.log || echo pulled) $IMAGE"
  docker image inspect "$IMAGE" --format '  digest={{index .RepoDigests 0}}  size={{.Size}}'
else
  bad "docker pull $IMAGE 失败"
  tail -3 /tmp/pull.log
  exit 1
fi

echo "=== 2. 用发布镜像起隔离栈（project=$PROJECT, 端口=$PORT）==="
PICSUR_IMAGE="$IMAGE" docker compose -p "$PROJECT" -f docker-compose.yml -f /tmp/verify-override.yml up -d > /tmp/verify-up.log 2>&1 \
  && ok "栈已启动" || {
  bad "启动失败"
  tail -5 /tmp/verify-up.log
}

echo "=== 3. 等服务就绪 ==="
for i in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/info" 2> /dev/null)" = "200" ] && {
    ok "就绪 ${i}s"
    break
  }
  sleep 1
done

echo "=== 4. 版本与来源 ==="
VER=$(curl -s "$BASE/api/info" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["version"])' 2> /dev/null || echo PARSE_FAIL)
[ "$VER" = "$EXPECT_VER" ] && ok "/api/info version=$VER" || bad "/api/info version=$VER（期望 $EXPECT_VER）"
RUNNING=$(docker inspect picsur-verify --format '{{.Config.Image}}' 2> /dev/null)
[ "$RUNNING" = "$IMAGE" ] && ok "容器确实跑的是 $RUNNING" || bad "容器镜像=$RUNNING（期望 $IMAGE）"

echo "=== 5. 迁移（新库首次启动）==="
# 期望条数从仓库里的 migration 文件数推出（不再写死，避免下次加迁移就假失败）
EXPECT_M=$(ls backend/src/database/migrations/*.ts 2> /dev/null | grep -vc 'index\.ts$')
M=$(docker exec picsur-verify-pg psql -U picsur -d picsur -tAc "select count(*) from migrations" 2> /dev/null | tr -d ' ')
[ "$M" = "$EXPECT_M" ] && ok "migrations=$M（= 仓库 migration 文件数）" || bad "migrations=$M（期望 $EXPECT_M = 仓库 migration 文件数）"

echo "=== 6. 34 项回归 ==="
if bash support/regression-image-api.sh "$BASE" "$PICSUR_ADMIN_PASSWORD" /tmp/bugs-fx > /tmp/verify-regress.log 2>&1; then
  ok "$(tail -1 /tmp/verify-regress.log)"
else
  bad "$(tail -1 /tmp/verify-regress.log)"
  grep -c FAIL /tmp/verify-regress.log | sed 's/^/    失败条数: /'
fi

echo "=== 7. 清理隔离栈 ==="
PICSUR_IMAGE="$IMAGE" docker compose -p "$PROJECT" -f docker-compose.yml -f /tmp/verify-override.yml down -v > /dev/null 2>&1 \
  && ok "已拆除（含卷）" || bad "拆除失败"
docker rm -f picsur-verify picsur-verify-pg > /dev/null 2>&1

echo
echo "================ 结果 ================"
echo "  通过 $PASS / 失败 $FAIL"
echo "  常驻栈未受影响: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/info)"
[ "$FAIL" -eq 0 ] || exit 1
