#!/bin/bash
# Picsur 图像 API 回归套件（冒烟 5 步 + 7 格式 + 删除语义 + 像素上限，共 34 项）。
#
# 用法：
#   bash support/regression-image-api.sh <base-url> <admin-password> [fixture-dir]
#
#   <base-url>        实例地址，例如 http://localhost:8080
#   <admin-password>  PICSUR_ADMIN_PASSWORD（容器内：sed -n 's/^PICSUR_ADMIN_PASSWORD=//p' /data/allinone.env）
#   [fixture-dir]     夹具目录，默认 $PICSUR_FIXTURES，再默认 /tmp/bugs-fx
#
# **夹具是自给的**：目录里缺文件时本脚本会自动调用
# support/make-image-fixtures.cjs 生成；该脚本在本地 sharp 编不出 JXL/JP2 时
# 自动改用带完整 libvips 的容器（默认 ghcr.io/zhemed/picsur:allinone）。
# 生成失败会直接 FATAL 退出（exit 2）并给出提示，不会跑出一堆 FAIL。
#
# 例：
#   bash support/regression-image-api.sh http://localhost:18080 "$PW"          # 一条命令，夹具自动就位
#   PICSUR_FIXTURES=/tmp/my-fx bash support/regression-image-api.sh http://localhost:8080 "$PW"
#   PICSUR_FIXTURE_NO_PULL=1 bash support/regression-image-api.sh …            # 离线机器：只用本地镜像
#
# 环境说明：JXL/JP2 的转码与源格式上传**只能在自编译 libvips 的环境**（容器）里通过；
#           宿主预编译 sharp 没有这两个解码器，会在 §4/§8 各失败一项，属已知环境差异。
set -uo pipefail

BASE="${1:?base url}"
PW="${2:?admin password}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
FIXTURES="${3:-${PICSUR_FIXTURES:-/tmp/bugs-fx}}"
BIG_IMAGE="${BIG_IMAGE:-${FIXTURES}/big-900mp.png}"
COOKIE_JAR=$(mktemp)
PASS=0; FAIL=0
ok()   { printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 (got '$2', want '$3')"; fi; }

# --- 依赖与夹具（在任何用例之前，失败就明确退出） ------------------------------
for bin in curl node python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "FATAL: '$bin' is required but not in PATH" >&2; exit 2; }
done

# 实例默认每 IP 60 请求/分钟（PicsurLayers 的全局 throttler）。本套件约 50 个请求，
# 单次跑没问题，但**紧接着跑第二次**会撞上限流，然后 26 项全变 FAIL —— 那是限流
# 不是回归。下面把 curl 包一层：看到 429 就等一会儿重试，得到的是确定性结论。
sleep_warned=0
curl() {
  local attempt out
  for attempt in 1 2 3 4; do
    out=$(command curl "$@")
    case "$out" in
      429 | *'"statusCode":429'* | *'HTTP/1.1 429'*)
        if [ "$attempt" -lt 4 ]; then
          if [ "$sleep_warned" -eq 0 ]; then
            echo "  (instance rate limited us, waiting for the window to reset…)" >&2
            sleep_warned=1
          fi
          sleep 5
          continue
          fi
        ;;
    esac
    printf '%s' "$out"
    return 0
  done
  printf '%s' "$out"
  return 0
}

echo "== 0. fixtures =="
FIXTURE_FORMATS=(png jpg webp avif jxl jp2 heif qoi)
MISSING=()
for f in "${FIXTURE_FORMATS[@]}"; do
  [ -s "${FIXTURES}/base.${f}" ] || MISSING+=("base.${f}")
done
[ -s "$BIG_IMAGE" ] || MISSING+=("$(basename "$BIG_IMAGE")")

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "  missing in ${FIXTURES}: ${MISSING[*]}"
  echo "  generating them with support/make-image-fixtures.cjs …"
  if ! node "${SCRIPT_DIR}/make-image-fixtures.cjs" "$FIXTURES"; then
    cat >&2 <<EOF

FATAL: could not prepare the fixtures, so the regression was not run.

The generator above explains what is missing. Quick options:
  * install docker            -> fixtures are then built inside
                                 ${PICSUR_FIXTURE_IMAGE:-ghcr.io/zhemed/picsur:allinone}
  * or pass a ready fixture dir as the 3rd argument:
        bash support/regression-image-api.sh <url> <password> /path/to/fixtures
        (needs base.{png,jpg,webp,avif,jxl,jp2,heif,qoi} + big-900mp.png)
EOF
    exit 2
  fi
else
  echo "  ok: ${#FIXTURE_FORMATS[@]} format fixtures + $(basename "$BIG_IMAGE") present in ${FIXTURES}"
fi

# 限流窗口可能被上一次运行占满：先探一次，必要时等窗口重置（最多 ~60s），
# 免得登录/前几项直接被 429 打死。
PROBE_WAITED=0
for _ in $(seq 1 15); do
  CODE=$(command curl -s -o /dev/null -w '%{http_code}' "$BASE/api/info")
  [ "$CODE" != "429" ] && break
  [ "$PROBE_WAITED" -eq 0 ] && echo "  instance is rate limiting this IP, waiting for the window…"
  PROBE_WAITED=1
  sleep 5
done

TOKEN=$(curl -s -X POST "$BASE/api/user/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PW\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("data",{}).get("jwt_token",""))')
if [ -z "$TOKEN" ]; then echo "FATAL: login failed (wrong password, or instance not reachable at $BASE)"; exit 2; fi
AUTH="Authorization: Bearer $TOKEN"

echo "== 1. service info =="
INFO=$(curl -s "$BASE/api/info")
check "GET /api/info is 200 with production" "$(echo "$INFO" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["statusCode"], d["data"]["production"])')" "200 True"

echo "== 2. upload (smoke step 1) =="
UP=$(curl -s -X POST "$BASE/api/image/upload" -H "$AUTH" -F "file=@${FIXTURES}/base.png")
ID=$(echo "$UP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("data",{}).get("id",""))')
check "POST /api/image/upload -> 201 + uuid" "$([ -n "$ID" ] && echo ok || echo missing)" "ok"

echo "== 3. retrieve master (smoke step 2) =="
R=$(curl -s -o /tmp/rg-out.bin -w '%{http_code} %{content_type}' "$BASE/i/$ID.png")
check "GET /i/<id>.png -> 200 image/png" "$R" "200 image/png"
LIVE_CACHE=$(curl -s -o /dev/null -D - "$BASE/i/$ID.png" | grep -i '^cache-control' | tr -d '\r' | sed 's/^[Cc]ache-[Cc]ontrol: //')
check "live image keeps month cache" "$LIVE_CACHE" "max-age=2592000"

echo "== 4. transcoding to all formats (smoke step 3) =="
for ext in qoi webp avif jxl jp2 heif png; do
  CODE=$(curl -s -o /tmp/rg-$ext.bin -w '%{http_code}' "$BASE/i/$ID.$ext")
  SIZE=$(stat -c %s /tmp/rg-$ext.bin 2>/dev/null || echo 0)
  if [ "$CODE" = "200" ] && [ "$SIZE" -gt 0 ]; then ok "GET /i/<id>.$ext -> 200 ($SIZE bytes)"; else bad "GET /i/<id>.$ext -> $CODE ($SIZE bytes)"; fi
done

echo "== 5. SPA deep link (smoke step 4) =="
check "GET /some/spa/route -> 200 text/html" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$BASE/some/spa/route" | tr -d '\r')" "200 text/html"

echo "== 6. deletion semantics (smoke step 5) =="
DEL=$(curl -s -X POST "$BASE/api/image/delete" -H "$AUTH" -H 'Content-Type: application/json' -d "{\"ids\":[\"$ID\"]}")
check "POST /api/image/delete -> 201" "$(echo "$DEL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["statusCode"])')" "201"
G=$(curl -s -o /tmp/rg-dead.bin -D /tmp/rg-dead.h -w '%{http_code}' "$BASE/i/$ID.png")
check "deleted GET -> 404" "$G" "404"
DC=$(grep -i '^cache-control' /tmp/rg-dead.h | tr -d '\r' | sed 's/^[Cc]ache-[Cc]ontrol: //')
check "deleted GET carries no month cache" "$DC" "no-store"
H=$(curl -s -I -o /tmp/rg-deadh.h -w '%{http_code}' "$BASE/i/$ID.png")
check "deleted HEAD -> 404" "$H" "404"
H2=$(grep -i '^cache-control' /tmp/rg-deadh.h | tr -d '\r' | sed 's/^[Cc]ache-[Cc]ontrol: //')
check "deleted HEAD is no-store" "$H2" "no-store"
for ext in webp qoi jxl; do
  check "deleted /i/<id>.$ext -> 404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/i/$ID.$ext")" "404"
done
check "deleted /i/<id> (no ext) -> 404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/i/$ID")" "404"
check "deleted /i/meta/<id> -> 404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/i/meta/$ID")" "404"
check "unknown uuid -> 404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/i/00000000-0000-4000-8000-000000000000.png")" "404"

echo "== 7. pixel limit (#107) =="
check "oversized upload -> 400" "$(curl -s -o /tmp/rg-big.json -w '%{http_code}' -X POST "$BASE/api/image/upload" -H "$AUTH" -F "file=@${BIG_IMAGE}")" "400"
MSG=$(python3 -c 'import json;print(json.load(open("/tmp/rg-big.json"))["data"]["message"])' 2>/dev/null)
if echo "$MSG" | grep -q "900000000 pixels" && echo "$MSG" | grep -q "268402689 pixels"; then ok "message names actual size + limit"; else bad "message missing size/limit: $MSG"; fi
check "service still alive after rejection" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/info")" "200"

echo "== 8. upload each source format, fetch master back =="
for f in png jpg webp avif jxl jp2 heif qoi; do
  U=$(curl -s -X POST "$BASE/api/image/upload" -H "$AUTH" -F "file=@${FIXTURES}/base.$f")
  UID2=$(echo "$U" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("data",{}).get("id",""))' 2>/dev/null)
  if [ -n "$UID2" ]; then
    C=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/i/$UID2.png")
    if [ "$C" = "200" ]; then ok "source .$f -> upload 201 + fetch 200"; else bad "source .$f -> upload ok but fetch $C"; fi
    curl -s -X POST "$BASE/api/image/delete" -H "$AUTH" -H 'Content-Type: application/json' -d "{\"ids\":[\"$UID2\"]}" -o /dev/null
  else
    bad "source .$f -> upload did not return an id: $(echo "$U" | head -c 160)"
  fi
done

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

