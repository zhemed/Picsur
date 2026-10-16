#!/bin/bash
# 内置 admin 账号的密码 / 权限回归（4 项）。
#
# 由来：admin 的密码在 UI 上改不了 —— 前端把权限也一起提交，服务端对
# 「给内置 admin 改权限」整体返回 403，于是同一个请求里的密码也没生效。
# 这条回归把两边的契约钉死：
#
#   1. 改密码必须成功（201），并且真的能用新密码登录（201）；
#   2. 改权限必须被拒（403），并给出明确原因；
#   3. 改密码时**只**带 password（正是前端修好的形态）也必须成功；
#   4. 恢复原密码必须成功 —— 回归结束后账号回到原状。
#
# 用法：
#   bash support/regression-user-admin.sh <base-url> <admin-password>
#
# 例：bash support/regression-user-admin.sh http://127.0.0.1:8080 "$PW"

set -uo pipefail

BASE="${1:?usage: regression-user-admin.sh <base-url> <admin-password>}"
ADMIN_PW="${2:?usage: regression-user-admin.sh <base-url> <admin-password>}"
BASE="${BASE%/}"

pass=0
fail=0
ok() { echo "  [PASS] $1"; pass=$((pass + 1)); }
bad() { echo "  [FAIL] $1"; fail=$((fail + 1)); }

jq_get() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

login() {
  curl -s -X POST "$BASE/api/user/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$1\"}"
}

echo "== 1. 用当前密码登录，取 token 与 admin 的 id =="
LOGIN="$(login "$ADMIN_PW")"
TOKEN="$(printf '%s' "$LOGIN" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['jwt_token'])" 2>/dev/null)"
if [ -n "${TOKEN:-}" ]; then ok "admin 登录成功"; else bad "admin 登录失败：$(printf '%s' "$LOGIN" | head -c 160)"; exit 1; fi

ME="$(curl -s "$BASE/api/user/me" -H "Authorization: Bearer $TOKEN")"
USER_ID="$(printf '%s' "$ME" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['user']['id'])" 2>/dev/null)"
if [ -n "${USER_ID:-}" ]; then ok "/api/user/me 返回 admin id (${USER_ID:0:8}…)"; else bad "/api/user/me 没有返回 id"; exit 1; fi

NEW_PW="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
update() { curl -s -o /tmp/reg-admin-body.json -w '%{http_code}' -X POST "$BASE/api/user/update" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$1"; }

echo
echo "== 2. 改密码（只带 password，前端修好后的形态）=="
CODE="$(update "{\"id\":\"$USER_ID\",\"password\":\"$NEW_PW\"}")"
if [ "$CODE" = "201" ]; then ok "POST /api/user/update {password} → 201"; else bad "改密码返回 $CODE：$(head -c 160 /tmp/reg-admin-body.json)"; fi

echo
echo "== 3. 用新密码登录 =="
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/user/login" -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$NEW_PW\"}")"
if [ "$CODE" = "201" ]; then ok "新密码可以登录 → 201"; else bad "新密码登录返回 $CODE"; fi

echo
echo "== 4. 改权限必须被拒 =="
CODE="$(update "{\"id\":\"$USER_ID\",\"permissions\":[]}")"
MSG="$(python3 -c "import json; print(json.load(open('/tmp/reg-admin-body.json'))['data']['message'])" 2>/dev/null)"
if [ "$CODE" = "403" ]; then ok "POST /api/user/update {permissions:[]} → 403"; else bad "改权限返回 $CODE（应为 403）"; fi
case "${MSG:-}" in
  *"built-in admin"*) ok "拒绝原因明确：$MSG" ;;
  "") bad "403 没有可读原因" ;;
  *) bad "拒绝原因不明确：$MSG" ;;
esac

echo
echo "== 5. 用新 token 把密码改回去 =="
TOKEN="$(login "$NEW_PW" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['jwt_token'])" 2>/dev/null)"
CODE="$(update "{\"id\":\"$USER_ID\",\"password\":\"$ADMIN_PW\"}")"
if [ "$CODE" = "201" ]; then ok "恢复原密码 → 201"; else bad "恢复原密码返回 $CODE"; fi
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/user/login" -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PW\"}")"
if [ "$CODE" = "201" ]; then ok "原密码重新可用 → 201"; else bad "原密码登录返回 $CODE"; fi

rm -f /tmp/reg-admin-body.json
echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
