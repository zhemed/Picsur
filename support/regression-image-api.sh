#!/bin/bash
# Picsur 图像 API 回归套件（冒烟 5 步 + 7 格式 + 删除语义 + 像素上限）。
#
# 用法：
#   ./support/regression-image-api.sh <base-url> <admin-password> [fixture-dir]
#
# 夹具目录默认为 /tmp/bugs-fx，需要这些文件（见 support/make-image-fixtures.cjs）：
#   base.{png,jpg,webp,avif,jxl,jp2,heif,qoi}   # 源格式上传用例
# 另外需要 /tmp/big-900mp.png（超像素图，见本脚本末尾说明）。
#
# 注意：JXL/JP2 的转码与源格式上传**只能在自编译 libvips 的环境**（容器）里通过；
#       宿主预编译 sharp 没有这两个解码器，会在 §4/§8 各失败一项，属已知环境差异。
#
# 例：
#   . /root/picsur/.env && ./support/regression-image-api.sh http://localhost:8095 "$PICSUR_ADMIN_PASSWORD"
set -uo pipefail

BASE="${1:?base url}"
PW="${2:?admin password}"
FIXTURES="${3:-/tmp/bugs-fx}"
BIG_IMAGE="${BIG_IMAGE:-/tmp/big-900mp.png}"
COOKIE_JAR=$(mktemp)
PASS=0; FAIL=0
ok()   { printf '  [PASS] %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  [FAIL] %s\n' "$1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 (got '$2', want '$3')"; fi; }

TOKEN=$(curl -s -X POST "$BASE/api/user/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PW\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("data",{}).get("jwt_token",""))')
if [ -z "$TOKEN" ]; then echo "FATAL: login failed"; exit 2; fi
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

# 超像素夹具 /tmp/big-900mp.png 可以很小（sharp 只看头部声明的尺寸）：
#   python3 - <<'PY'
#   import zlib, struct, binascii
#   def chunk(t, d):
#       return struct.pack('>I', len(d)) + t + d + struct.pack('>I', binascii.crc32(t+d) & 0xffffffff)
#   w = h = 30000  # 900_000_000 px，远超默认上限 268402689
#   ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
#   idat = zlib.compress(b'\x00' + b'\x00' * (w * 3), 9)
#   open('/tmp/big-900mp.png','wb').write(
#       b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b''))
#   PY
