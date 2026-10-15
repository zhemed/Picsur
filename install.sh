#!/usr/bin/env bash
# =============================================================================
# Picsur 一键安装脚本（多容器正式部署路径：应用 + Postgres）
#
# 用法：
#   bash install.sh [选项]
#   curl -fsSL https://raw.githubusercontent.com/zhemed/picsur/master/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/zhemed/picsur/master/install.sh | bash -s -- --dir /opt/picsur
#
# 选项：
#   --dir <目录>             安装目录（默认：当前目录）
#   --port <端口>            对外访问端口（默认：8080）
#   --version <tag>          镜像 tag，例：0.6.0 / latest（默认用 compose 里的 latest）
#   --admin-password <口令>  指定管理员初始口令（**仅在数据库为空时生效**）
#   --accept-new-privileges  重跑升级时接受新版 compose 新增的特权面（默认中止）
#   -h, --help               显示本帮助
#
# 高级环境变量（一般不用设）：
#   PICSUR_IMAGE          完整镜像名，优先级最高（例：zhemed/picsur:local）
#   PICSUR_PROJECT_NAME   compose 项目名 / 容器名前缀（默认：picsur）
#   PICSUR_COMPOSE_URL    覆盖 docker-compose.yml 下载地址（离线/自建源）
#   PICSUR_WAIT_TIMEOUT   就绪等待秒数（默认：180）
#
# 行为约定：
#   - 重复执行 = 升级：已有的 .env 绝不覆盖，数据卷保留；compose 文件会刷新到最新。
#   - 管理员口令只在首次安装（生成 .env 那一次）打印，且只打印一次。
#   - 全程不交互，可直接 `curl | bash`。
#
# 依赖：bash 4+、docker（含 compose v2 插件）、curl 或 wget（下载与就绪探测）。
# =============================================================================
set -Eeuo pipefail

REPO_SLUG="zhemed/picsur"
RAW_BASE="https://raw.githubusercontent.com/${REPO_SLUG}"
DEFAULT_PORT="8080"
DEFAULT_PROJECT="picsur"
OVERRIDE_MARK="# 由 picsur install.sh 生成/管理"
WAIT_TIMEOUT="${PICSUR_WAIT_TIMEOUT:-180}"

info() { printf '[i] %s\n' "$*"; }
ok()   { printf '[✓] %s\n' "$*"; }
warn() { printf '[!] %s\n' "$*" >&2; }
fail() { printf '[x] %s\n' "$*" >&2; }

# 参数错误：退出码 2
die_arg() {
  fail "$1"
  printf '    查看帮助：bash install.sh --help\n' >&2
  exit 2
}

# 运行期错误：退出码 1
die() {
  fail "$1"
  if [ $# -gt 1 ]; then
    printf '    %s\n' "$2" >&2
  fi
  exit 1
}

cleanup_tmp() {
  local d="${DIR:-}"
  [ -n "$d" ] || return 0
  rm -f -- "$d"/.env.tmp.* "$d"/.docker-compose.yml.tmp.* \
           "$d"/.docker-compose.bundled.tmp.* "$d"/.override.tmp.* 2>/dev/null || true
  return 0
}

on_error() {
  local rc=$?
  printf '[x] 安装中断：脚本第 %s 行执行失败（退出码 %s）\n' "${BASH_LINENO[0]:-?}" "$rc" >&2
}
trap on_error ERR
trap cleanup_tmp EXIT

usage() {
  cat <<'USAGE'
Picsur 一键安装脚本（多容器正式部署路径：应用 + Postgres）

用法：
  bash install.sh [选项]
  curl -fsSL https://raw.githubusercontent.com/zhemed/picsur/master/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/zhemed/picsur/master/install.sh | bash -s -- --dir /opt/picsur

选项：
  --dir <目录>             安装目录（默认：当前目录）
  --port <端口>            对外访问端口（默认：8080）
  --version <tag>          镜像 tag，例：0.6.0 / latest（默认用 compose 里的 latest）
  --admin-password <口令>  指定管理员初始口令（仅在数据库为空时生效）
  --accept-new-privileges  允许「重跑升级」时接受新版 compose 新增的特权面
                           （默认会中止：升级不该悄悄多挂宿主 docker.sock 之类的东西）
  -h, --help               显示本帮助

高级环境变量（一般不用设）：
  PICSUR_IMAGE          完整镜像名，优先级最高（例：zhemed/picsur:local）
  PICSUR_PROJECT_NAME   compose 项目名 / 容器名前缀（默认：picsur）
  PICSUR_COMPOSE_URL    覆盖 docker-compose.yml 下载地址（离线/自建源）
  PICSUR_WAIT_TIMEOUT   就绪等待秒数（默认：180）

行为约定：
  - 重复执行 = 升级：已有的 .env 绝不覆盖，数据卷保留；compose 文件会刷新到最新。
  - 管理员口令只在首次安装（生成 .env 那一次）打印，且只打印一次。
  - 全程不交互，可直接 `curl | bash`。

依赖：bash 4+、docker（含 compose v2 插件）、curl 或 wget（下载与就绪探测）。
USAGE
}

# ---------------------------------------------------------------------------
# 1. 解析参数
# ---------------------------------------------------------------------------
DIR=""
PORT=""
TAG=""
ADMIN_PASSWORD_ARG=""
ACCEPT_NEW_PRIVILEGES=0
COMPOSE_REPLACED=0

while [ $# -gt 0 ]; do
  arg="$1"; shift
  val=""
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --accept-new-privileges) ACCEPT_NEW_PRIVILEGES=1; continue ;;
    --dir|--port|--version|--admin-password)
      [ $# -gt 0 ] || die_arg "选项 $arg 缺少参数值"
      val="$1"; shift ;;
    --dir=*|--port=*|--version=*|--admin-password=*)
      val="${arg#*=}"
      [ -n "$val" ] || die_arg "选项 ${arg%%=*} 缺少参数值" ;;
    -*) die_arg "未知选项：$arg" ;;
    *)  die_arg "未知参数：$arg（只接受 --dir/--port/--version/--admin-password/--accept-new-privileges）" ;;
  esac
  case "${arg%%=*}" in
    --dir) DIR="$val" ;;
    --port) PORT="$val" ;;
    --version) TAG="$val" ;;
    --admin-password) ADMIN_PASSWORD_ARG="$val" ;;
  esac
done

PORT="${PORT:-$DEFAULT_PORT}"
DIR="${DIR:-$PWD}"
PROJECT="${PICSUR_PROJECT_NAME:-$DEFAULT_PROJECT}"

case "$PORT" in
  ''|*[!0-9]*) die_arg "端口不合法：'$PORT'（需要 1-65535 的整数）" ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  die_arg "端口不合法：'$PORT'（需要 1-65535 的整数）"
fi
case "$PROJECT" in
  *[!a-z0-9_-]*|'') die_arg "compose 项目名不合法：'$PROJECT'（PICSUR_PROJECT_NAME 只能用小写字母/数字/-/_）" ;;
esac
if [ -n "$TAG" ]; then
  case "$TAG" in
    *[!A-Za-z0-9._-]*) die_arg "版本 tag 不合法：'$TAG'（只允许字母/数字/._-）" ;;
    */*) die_arg "版本 tag 不合法：'$TAG'" ;;
  esac
fi
if [ -n "$ADMIN_PASSWORD_ARG" ]; then
  case "$ADMIN_PASSWORD_ARG" in
    *$'\n'*|*$'\r'*) die_arg "--admin-password 不能包含换行符" ;;
    *"'"*) die_arg "--admin-password 不能包含单引号（会破坏 .env 语法），请换一个口令" ;;
  esac
  if [ "$(printf '%s' "$ADMIN_PASSWORD_ARG" | wc -c | tr -d ' ')" -lt 8 ]; then
    die_arg "--admin-password 太短（至少 8 个字符）"
  fi
fi

APP_CONTAINER="$PROJECT"
PG_CONTAINER="${PROJECT}_postgres"

# ---------------------------------------------------------------------------
# 2. 前置检查：docker / docker compose / 网络工具
# ---------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die \
  "未检测到 docker 命令，无法继续。" \
  "请先安装 Docker：https://docs.docker.com/engine/install/ ；Debian/Ubuntu 可用官方脚本：curl -fsSL https://get.docker.com | sh"

if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    die "检测到 docker-compose v1（已停止维护），本脚本需要 docker compose v2 插件。" \
        "安装插件：apt-get install -y docker-compose-plugin（或参考 https://docs.docker.com/compose/install/linux/）"
  fi
  die "未检测到 'docker compose' 子命令（缺少 compose v2 插件）。" \
      "安装插件：apt-get install -y docker-compose-plugin（或参考 https://docs.docker.com/compose/install/linux/）"
fi

docker info >/dev/null 2>&1 || die \
  "Docker 守护进程不可用（未启动，或当前用户没有访问 /var/run/docker.sock 的权限）。" \
  "启动：systemctl start docker ；权限：把当前用户加入 docker 组，或用 sudo 重新执行本脚本。"

if command -v curl >/dev/null 2>&1; then
  FETCHER="curl"
elif command -v wget >/dev/null 2>&1; then
  FETCHER="wget"
else
  FETCHER=""
  warn "未找到 curl / wget：将跳过 compose 下载，使用脚本内置副本兜底，就绪探测也只做端口检查。"
fi

# 端口占用检查（在创建任何文件之前做，便于「未做任何改动」）：允许我们自己项目的容器
port_holders="$(docker ps --filter "publish=${PORT}" --format '{{.Names}}' 2>/dev/null | tr '\n' ' ' || true)"
for holder in $port_holders; do
  if [ "$holder" != "$APP_CONTAINER" ]; then
    die "端口 $PORT 已被其他容器占用（容器：$holder），未做任何改动。" \
        "换个端口重试（--port <其它端口>），或先停掉占用者：docker stop $holder"
  fi
done

if [ -z "$(printf '%s' "$port_holders" | tr -d ' ')" ]; then
  port_busy=0
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${PORT}\$"; then port_busy=1; fi
  elif (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
    port_busy=1
  fi
  if [ "$port_busy" = 1 ]; then
    die "端口 $PORT 已被本机其它进程占用（不是本脚本管理的容器），未做任何改动。" \
        "查看占用：ss -ltnp | grep :$PORT ；或换端口重试：--port <其它端口>"
  fi
fi

# ---------------------------------------------------------------------------
# 3. 安装目录与 .env（幂等：已存在则绝不覆盖）
# ---------------------------------------------------------------------------
mkdir -p -- "$DIR" 2>/dev/null || die "无法创建安装目录：$DIR" "请检查路径与权限（父目录是否存在、是否可写）。"
[ -d "$DIR" ] || die "安装目录不是目录：$DIR"
DIR="$(cd -- "$DIR" && pwd)" || die "无法进入安装目录：$DIR"
ENV_FILE="$DIR/.env"
COMPOSE_FILE="$DIR/docker-compose.yml"
USER_OVERRIDE="$DIR/docker-compose.override.yml"
MANAGED_OVERRIDE="$DIR/docker-compose.override.yml"

gen_random() {
  local n="${1:-32}" s=""
  if command -v openssl >/dev/null 2>&1; then
    s="$(openssl rand -hex 48 2>/dev/null || true)"
  fi
  if [ "${#s}" -lt "$n" ]; then
    s="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 256 || true)"
  fi
  [ "${#s}" -ge "$n" ] || die "无法生成随机口令/密钥（openssl 与 /dev/urandom 都不可用）。"
  printf '%s' "${s:0:n}"
}

# 读取 .env 中的变量值（去空白与引号）；不存在则返回 1
env_value() {
  local key="$1" line v
  [ -f "$ENV_FILE" ] || return 1
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" | tail -n1 || true)"
  [ -n "$line" ] || return 1
  v="${line#*=}"
  v="${v%$'\r'}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s' "$v"
}

# 读写 .env 用的安全引用：普通字符原样，其余用单引号包裹（compose 的 dotenv 会去掉引号）
env_quote() {
  case "$1" in
    *$'\n'*|*$'\r'*) die "值里不能包含换行符。" ;;
    *"'"*) die "值里不能包含单引号（会破坏 .env 语法），请换一个口令。" ;;
  esac
  case "$1" in
    *[!A-Za-z0-9._@%+:=/-]*) printf "'%s'" "$1" ;;
    *) printf '%s' "$1" ;;
  esac
}

ENV_CREATED=0
ADMIN_PASSWORD=""

if [ -f "$ENV_FILE" ]; then
  info "检测到已有 .env（$ENV_FILE）：保留不覆盖，继续按升级流程执行。"
  env_problem=0
  for k in PICSUR_ADMIN_PASSWORD PICSUR_JWT_SECRET; do
    v="$(env_value "$k" || true)"
    if [ -z "$v" ]; then
      fail "现有 .env 缺少必需变量（缺失或为空）：$k"
      env_problem=1
      continue
    fi
    case "$v" in
      change-me-please|change-me-too)
        fail "现有 .env 里的 $k 仍是示例占位值（$v），拒绝用它部署。"
        env_problem=1 ;;
      picsur)
        warn "现有 .env 里的 $k 是代码默认值（picsur），建议尽快改成随机值。" ;;
    esac
  done
  if [ "$env_problem" = 1 ]; then
    die "请先修好 $ENV_FILE 再重跑本脚本。" \
        "提示：PICSUR_ADMIN_PASSWORD / PICSUR_JWT_SECRET 都必须是非空的真实值，例如用 openssl rand -hex 32 生成。"
  fi

  existing_port="$(env_value PICSUR_PORT || true)"
  if [ -n "$existing_port" ] && [ "$existing_port" != "$PORT" ]; then
    warn "本次按 --port $PORT 执行；.env 里记录的 PICSUR_PORT=$existing_port 没有改动（如需手工 docker compose，请自行同步）。"
  fi
  if [ -n "$ADMIN_PASSWORD_ARG" ]; then
    warn "--admin-password 已忽略：.env 已存在，本脚本不会覆盖它；且管理员口令只在数据库首次初始化时生效。"
    warn "如需改口令，请登录后在设置里修改。"
  fi
  # 既有 .env 的权限：里面有管理员口令 / JWT secret / DB 口令，组或其他人可读就该提醒
  env_mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '')"
  if [ -n "$env_mode" ]; then
    case "${env_mode: -2}" in
      00) : ;;
      *)  warn "现有 .env 权限过宽（$env_mode）：文件里有管理员口令与 JWT secret，建议收窄到 600"
          warn "   修法：chmod 600 '$ENV_FILE'" ;;
    esac
  fi
else
  ADMIN_PASSWORD="${ADMIN_PASSWORD_ARG:-$(gen_random 40)}"
  [ -n "$ADMIN_PASSWORD" ] || die "管理员口令为空。"
  JWT_SECRET="$(gen_random 64)"
  DB_PASSWORD="$(gen_random 32)"

  tmp_env="$DIR/.env.tmp.$$"
  ( umask 077
    cat >"$tmp_env" <<ENVEOF
# Picsur 环境变量（由 install.sh 生成；不要提交到版本库，不要外传）
# 重复运行 install.sh 不会覆盖本文件，只会在镜像层做升级。
PICSUR_ADMIN_PASSWORD=$(env_quote "$ADMIN_PASSWORD")
PICSUR_JWT_SECRET=$(env_quote "$JWT_SECRET")
PICSUR_DB_PASSWORD=$(env_quote "$DB_PASSWORD")
# install.sh 使用的对外端口（手工 docker compose 时也会读取）
PICSUR_PORT=${PORT}
ENVEOF
  ) || die "写入 .env 失败：$ENV_FILE"
  mv -f -- "$tmp_env" "$ENV_FILE" || die "写入 .env 失败：$ENV_FILE"
  chmod 600 "$ENV_FILE" || die "设置 .env 权限（600）失败：$ENV_FILE"
  ENV_CREATED=1
  ok "已生成 .env（权限 600，随机管理员口令与 JWT secret）"
fi

# ---------------------------------------------------------------------------
# 4. 取得 docker-compose.yml（优先下载，失败用内置最小副本兜底）
# ---------------------------------------------------------------------------
compose_file_usable() {
  [ -f "$COMPOSE_FILE" ] && grep -qE '^[[:space:]]*services:' "$COMPOSE_FILE" 2>/dev/null
}

compose_file_matches_marker() {
  head -n 3 "$1" 2>/dev/null | grep -qF "$OVERRIDE_MARK"
}

download_compose() {
  local url="$1" tmp="$DIR/.docker-compose.yml.tmp.$$"
  rm -f -- "$tmp"
  if [ "$FETCHER" = "curl" ]; then
    curl -fsSL --retry 2 --connect-timeout 10 --max-time 60 -o "$tmp" "$url" </dev/null 2>/dev/null || { rm -f -- "$tmp"; return 1; }
  elif [ "$FETCHER" = "wget" ]; then
    wget -q -O "$tmp" --tries=2 --timeout=20 "$url" </dev/null 2>/dev/null || { rm -f -- "$tmp"; return 1; }
  else
    return 1
  fi
  [ -s "$tmp" ] || { rm -f -- "$tmp"; return 1; }
  grep -qE '^[[:space:]]*services:' "$tmp" || { rm -f -- "$tmp"; return 1; }
  grep -q 'picsur' "$tmp" || { rm -f -- "$tmp"; return 1; }
  if [ -f "$COMPOSE_FILE" ] && ! cmp -s "$tmp" "$COMPOSE_FILE"; then
    cp -f -- "$COMPOSE_FILE" "$COMPOSE_FILE.bak" 2>/dev/null || true
    COMPOSE_REPLACED=1
    info "已用新版覆盖 docker-compose.yml，原文件备份为 docker-compose.yml.bak"
  fi
  mv -f -- "$tmp" "$COMPOSE_FILE" || { rm -f -- "$tmp"; return 1; }
  return 0
}

# 内置最小副本：与仓库根 docker-compose.yml 等价，只把对外端口/容器名参数化
write_bundled_compose() {
  local target="$1" tmp="$DIR/.docker-compose.bundled.tmp.$$"
  if [ -f "$target" ]; then
    cp -f -- "$target" "$target.bak" 2>/dev/null || true
    COMPOSE_REPLACED=1
  fi
  cat >"$tmp" <<'YAML'
# Picsur 常驻部署（由 install.sh 内置的兜底副本生成）
# 说明：正常情况下 install.sh 会从仓库下载最新的 docker-compose.yml；只有在
#       下载失败且本地没有可用 compose 文件时，才写入本副本。
services:
  picsur:
    image: ${PICSUR_IMAGE:-ghcr.io/zhemed/picsur:latest}
    build:
      context: .
      dockerfile: Dockerfile
    container_name: ${PICSUR_PROJECT_NAME:-picsur}
    ports:
      - '${PICSUR_PORT:-8080}:8080'
    environment:
      PICSUR_HOST: '0.0.0.0'
      PICSUR_PORT: 8080
      PICSUR_DB_HOST: picsur_postgres
      PICSUR_DB_PORT: 5432
      PICSUR_DB_USERNAME: picsur
      PICSUR_DB_PASSWORD: ${PICSUR_DB_PASSWORD:-picsur}
      PICSUR_DB_DATABASE: picsur
      PICSUR_ADMIN_PASSWORD: ${PICSUR_ADMIN_PASSWORD:?请在 .env 里设置 PICSUR_ADMIN_PASSWORD}
      PICSUR_JWT_SECRET: ${PICSUR_JWT_SECRET:?请在 .env 里设置 PICSUR_JWT_SECRET}
      PICSUR_STATIC_FRONTEND_ROOT: /picsur/frontend/dist
      PICSUR_MAX_FILE_SIZE: ${PICSUR_MAX_FILE_SIZE:-128000000}
      PICSUR_TELEMETRY: 'false'
      PICSUR_VERBOSE: 'false'
    depends_on:
      - picsur_postgres
    restart: unless-stopped

  picsur_postgres:
    image: postgres:17-alpine
    container_name: ${PICSUR_PROJECT_NAME:-picsur}_postgres
    environment:
      POSTGRES_DB: picsur
      POSTGRES_USER: picsur
      POSTGRES_PASSWORD: ${PICSUR_DB_PASSWORD:-picsur}
    volumes:
      - picsur-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  picsur-data:
YAML
  mv -f -- "$tmp" "$target" || die "写入 compose 文件失败：$target"
}

compose_url=""
if [ -n "$TAG" ] && [ "$TAG" != "latest" ]; then
  compose_url="$RAW_BASE/$TAG/docker-compose.yml"
else
  compose_url="$RAW_BASE/master/docker-compose.yml"
fi
if [ -n "${PICSUR_COMPOSE_URL:-}" ]; then
  compose_url="$PICSUR_COMPOSE_URL"
fi

compose_ok=0
if download_compose "$compose_url"; then
  compose_ok=1
  ok "已获取 docker-compose.yml（$compose_url）"
elif [ -n "$TAG" ] && [ "$TAG" != "latest" ] && [ -z "${PICSUR_COMPOSE_URL:-}" ]; then
  warn "从 tag $TAG 下载 docker-compose.yml 失败，回退到 master 分支。"
  if download_compose "$RAW_BASE/master/docker-compose.yml"; then
    compose_ok=1
    ok "已获取 docker-compose.yml（master 分支）"
  fi
fi

if [ "$compose_ok" != 1 ]; then
  warn "无法下载 docker-compose.yml（网络不可用、地址失效或未安装 curl/wget）。"
  if compose_file_usable; then
    warn "继续使用安装目录里已有的 compose 文件：$COMPOSE_FILE"
  else
    warn "本地没有可用的 compose 文件，改用脚本内置的最小副本兜底。"
    write_bundled_compose "$COMPOSE_FILE"
  fi
fi

# ---------------------------------------------------------------------------
# 5. 端口 / 容器名覆盖文件（上游 compose 把 8080 与容器名写死了）
# ---------------------------------------------------------------------------
if [ -f "$USER_OVERRIDE" ] && ! compose_file_matches_marker "$USER_OVERRIDE"; then
  # 用户自己的覆盖文件：保留（显式 -f 会自动带上），我们的覆盖文件换个名字
  MANAGED_OVERRIDE="$DIR/picsur-install.override.yml"
  MANAGED_BY_US=0
  info "检测到自定义 $USER_OVERRIDE，将按 [docker-compose.yml, 自定义 override, install 覆盖] 顺序加载。"
else
  MANAGED_BY_US=1
fi

write_managed_override() {
  local target="$1" tmp="$DIR/.override.tmp.$$"
  cat >"$tmp" <<'YAML'
# 由 picsur install.sh 生成/管理：只覆盖对外端口与容器名，其余沿用 docker-compose.yml
# （上游 compose 把 8080:8080 与 container_name 写死了，这里用 !override 替换而不是追加）
services:
  picsur:
    container_name: ${PICSUR_PROJECT_NAME:-picsur}
    ports: !override
      - "${PICSUR_PORT:-8080}:8080"
  picsur_postgres:
    container_name: ${PICSUR_PROJECT_NAME:-picsur}_postgres
YAML
  mv -f -- "$tmp" "$target" || die "写入覆盖文件失败：$target"
}

write_managed_override "$MANAGED_OVERRIDE"

export PICSUR_PROJECT_NAME="$PROJECT"
export PICSUR_PORT="$PORT"
if [ -n "$TAG" ]; then
  export PICSUR_IMAGE="ghcr.io/zhemed/picsur:${TAG}"
fi

compose() {
  ( cd -- "$DIR" && docker compose -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@" ) </dev/null
}

set_compose_files() { # $1 = 1 表示带上 install 覆盖文件
  COMPOSE_FILES=(-f docker-compose.yml)
  if [ -f "$USER_OVERRIDE" ] && [ "$USER_OVERRIDE" != "$MANAGED_OVERRIDE" ]; then
    COMPOSE_FILES+=(-f docker-compose.override.yml)
  fi
  if [ "$1" = "1" ]; then
    COMPOSE_FILES+=(-f "$(basename -- "$MANAGED_OVERRIDE")")
  fi
}

effective_port() {
  local out
  out="$(compose config 2>/dev/null || true)"
  printf '%s' "$out" | sed -n 's/^[[:space:]]*published:[[:space:]]*"\{0,1\}\([0-9]\{1,5\}\)"\{0,1\}[[:space:]]*$/\1/p' | head -n1
}

effective_app_container() {
  local out
  out="$(compose config 2>/dev/null || true)"
  printf '%s' "$out" | sed -n 's/^[[:space:]]*container_name:[[:space:]]*\([^[:space:]]*\)[[:space:]]*$/\1/p' | head -n1
}

effective_app_image() {
  local out
  out="$(compose config --images 2>/dev/null || true)"
  printf '%s' "$out" | grep -m1 'picsur' || true
}

set_compose_files 1
if [ "$(effective_port)" != "$PORT" ]; then
  warn "当前 compose 版本未能用覆盖文件改写端口（!override 需要 Docker Compose ≥ 2.24）。"
  if [ "$MANAGED_BY_US" = 1 ]; then
    rm -f -- "$MANAGED_OVERRIDE"
    info "已移除 install 覆盖文件，改用内置的参数化 compose 模板。"
  fi
  write_bundled_compose "$COMPOSE_FILE"
  set_compose_files 0
  if [ "$(effective_port)" != "$PORT" ]; then
    die "无法让 compose 使用端口 $PORT（当前生效端口：$(effective_port)）。" \
        "请升级 Docker Compose 到 ≥ 2.24，或检查安装目录里的自定义 docker-compose.override.yml。"
  fi
else
  ok "compose 覆盖生效：对外端口 $PORT → 容器 8080，容器名 ${effective_app_container:-$APP_CONTAINER}"
fi

# ---------------------------------------------------------------------------
# 5.1 特权面差异检查：升级不该悄悄多挂宿主 docker.sock 之类的东西
# ---------------------------------------------------------------------------
# 把 compose 里的「特权面」抽成规范化 token；只做粗粒度识别，够用来在升级时拦住意外提权
privileged_tokens() {
  local f="$1"
  [ -f "$f" ] || return 0
  if grep -qE "^[[:space:]]*-[[:space:]]*['\"]?(/var)?/run/docker\.sock" "$f"; then echo 'mount:/var/run/docker.sock'; fi
  if grep -qE '^[[:space:]]*privileged:[[:space:]]*true' "$f"; then echo 'privileged:true'; fi
  if grep -qE '^[[:space:]]*cap_add:' "$f"; then echo 'cap_add:额外内核能力'; fi
  if grep -qE "^[[:space:]]*network_mode:[[:space:]]*['\"]?host" "$f"; then echo 'network_mode:host'; fi
  if grep -qE "^[[:space:]]*pid:[[:space:]]*['\"]?host" "$f"; then echo 'pid:host'; fi
  local binds
  binds="$(grep -oE "^[[:space:]]*-[[:space:]]*['\"]?([.~]/[^:'\"]*|/[^:'\"]*):" "$f" \
    | grep -v 'docker\.sock' \
    | sed -E "s/^[[:space:]]*-[[:space:]]*['\"]?//; s/:$//" | sort -u || true)"
  if [ -n "$binds" ]; then printf '%s\n' "$binds" | sed 's/^/bind:/'; fi
  return 0
}

# 规整 token 列表（去空行 + 排序），供 comm 比对
normalize_tokens() {
  printf '%s\n' "$1" | grep -v '^$' | sort -u || true
}

check_compose_privileges() {
  local new_tokens old_tokens added
  new_tokens="$(privileged_tokens "$COMPOSE_FILE" | sort -u)"
  if [ ! -f "$COMPOSE_FILE.bak" ]; then
    if [ -n "$new_tokens" ]; then
      info "提示：本次 compose 里含以下特权面（面板内一键升级需要；不想要就删掉挂载并设 PICSUR_ALLOW_SELF_UPDATE=false）："
      while IFS= read -r line; do printf '      - %s\n' "$line"; done <<<"$new_tokens"
    fi
    return 0
  fi
  [ "$COMPOSE_REPLACED" = "1" ] || return 0
  old_tokens="$(privileged_tokens "$COMPOSE_FILE.bak" | sort -u)"
  added="$(comm -13 <(normalize_tokens "$old_tokens") <(normalize_tokens "$new_tokens") || true)"
  if [ -z "$added" ]; then
    return 0
  fi
  warn "新版 docker-compose.yml 给容器新增了特权面（升级不该悄悄提权）："
  while IFS= read -r line; do printf '      + %s\n' "$line"; done <<<"$added"
  if [ "${ACCEPT_NEW_PRIVILEGES:-0}" != "1" ]; then
    die "已中止，未启动任何容器（旧文件留在 docker-compose.yml.bak）。" \
        "确认接受就用 --accept-new-privileges 重跑；想退回旧配置就 cp docker-compose.yml.bak docker-compose.yml"
  fi
  warn "已按 --accept-new-privileges 继续（自行承担多出来的权限）。"
}

check_compose_privileges

# ---------------------------------------------------------------------------
# 6. 拉取镜像并启动
# ---------------------------------------------------------------------------
info "开始拉取镜像并启动（项目名 $PROJECT，安装目录 $DIR）…"
if ! compose pull; then
  warn "docker compose pull 失败，检查本地是否已有可用镜像…"
  images="$(compose config --images 2>/dev/null || true)"
  missing=""
  for img in $images; do
    docker image inspect "$img" >/dev/null 2>&1 || missing="$missing $img"
  done
  if [ -z "$images" ]; then
    die "docker compose pull 失败，且无法确定需要的镜像清单。" \
        "请手工执行 docker compose pull 查看具体错误（网络/镜像源问题最常见）。"
  fi
  if [ -n "$missing" ]; then
    die "以下镜像既拉不到本地也没有：$missing" \
        "请检查网络/镜像源，或先手工 docker pull；本地构建的镜像可用 PICSUR_IMAGE=zhemed/picsur:local 指定。"
  fi
  warn "本地已有全部镜像（$(printf '%s' "$images" | tr '\n' ' ')），继续用本地镜像启动。"
fi

if ! compose up -d; then
  fail "docker compose up -d 失败，容器未正常启动。"
  compose ps || true
  compose logs --tail=40 picsur || true
  die "请根据上面的日志排查（常见原因：端口被占用、镜像缺失、docker 资源不足）。"
fi
ok "容器已启动，等待服务就绪（最长 ${WAIT_TIMEOUT} 秒）…"

# ---------------------------------------------------------------------------
# 7. 等待 /api/info 就绪
# ---------------------------------------------------------------------------
http_code() {
  local url="$1" out=""
  if [ "$FETCHER" = "curl" ]; then
    out="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" </dev/null 2>/dev/null)" || out="000"
  elif [ "$FETCHER" = "wget" ]; then
    out="$(wget -q -S -O /dev/null --timeout=5 "$url" 2>&1 | grep -oE 'HTTP/[0-9.]+ [0-9]{3}' | tail -n1 | awk '{print $2}')" || out=""
  else
    if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then out="200"; else out="000"; fi
  fi
  printf '%s' "${out:-000}"
}

api_url="http://127.0.0.1:${PORT}/api/info"
start_ts="$(date +%s)"
ready=0
while :; do
  code="$(http_code "$api_url")"
  if [ "$code" = "200" ]; then ready=1; break; fi
  elapsed=$(( $(date +%s) - start_ts ))
  if [ "$elapsed" -ge "$WAIT_TIMEOUT" ]; then break; fi
  if [ "$elapsed" -gt 0 ] && [ $(( elapsed % 15 )) -eq 0 ]; then
    info "等待中就绪（已 ${elapsed}s，最近一次 HTTP $code）…"
  fi
  sleep 2
done

if [ "$ready" != 1 ]; then
  fail "等待 ${WAIT_TIMEOUT}s 后 /api/info 仍未返回 200，安装未完成。"
  compose ps || true
  compose logs --tail=60 picsur || true
  die "请按上面的日志排查；修好后可重跑本脚本（.env 与数据卷都会保留）。"
fi
ok "服务已就绪：$api_url → HTTP 200"

# 服务端版本（顺带确认返回体是 Picsur 的 /api/info）
info_body=""
if [ "$FETCHER" = "curl" ]; then
  info_body="$(curl -fsS --max-time 5 "$api_url" </dev/null 2>/dev/null || true)"
elif [ "$FETCHER" = "wget" ]; then
  info_body="$(wget -q -O - --timeout=5 "$api_url" </dev/null 2>/dev/null || true)"
fi
server_version="$(printf '%s' "$info_body" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -n1)"
[ -n "$server_version" ] || server_version="未知"

# 首次安装：用打印出去的口令真的登录一次，确认口令可用
login_note=""
if [ "$ENV_CREATED" = 1 ] && [ "$FETCHER" = "curl" ]; then
  esc_pw="${ADMIN_PASSWORD//\\/\\\\}"
  esc_pw="${esc_pw//\"/\\\"}"
  login_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' --max-time 15 \
      "http://127.0.0.1:${PORT}/api/user/login" --data-binary @- <<JSONEOF
{"username":"admin","password":"${esc_pw}"}
JSONEOF
    )" || login_code="000"
  if [ "$login_code" = "201" ]; then
    login_note="自检通过：用上面的口令调用 POST /api/user/login 返回 201"
  else
    warn "自检：用生成的 admin 口令登录返回 HTTP $login_code（不影响安装，可用 --admin-password 指定口令重装空库）。"
  fi
fi

# ---------------------------------------------------------------------------
# 8. 输出结果
# ---------------------------------------------------------------------------
app_image="$(effective_app_image)"
if [ -z "$app_image" ]; then
  app_image="${PICSUR_IMAGE:-ghcr.io/zhemed/picsur:latest}"
fi

printf '\n'
printf '======================================================================\n'
printf ' Picsur 安装完成 ✅\n'
printf '%s\n' '----------------------------------------------------------------------'
printf ' 访问地址   ： http://127.0.0.1:%s\n' "$PORT"
printf '              （同网段其它机器用本机 IP 替换 127.0.0.1）\n'
printf ' 管理员账号 ： admin\n'
if [ "$ENV_CREATED" = 1 ]; then
  printf ' 管理员口令 ： %s   ← 仅显示这一次，请立即保存\n' "$ADMIN_PASSWORD"
else
  printf ' 管理员口令 ： 已存在，本次不重新生成也不显示\n'
  printf '              （查看：grep PICSUR_ADMIN_PASSWORD %s/.env）\n' "$DIR"
fi
printf ' 服务端版本 ： %s\n' "$server_version"
printf ' 镜像       ： %s\n' "$app_image"
printf ' 安装目录   ： %s\n' "$DIR"
printf ' 容器       ： %s / %s\n' "$APP_CONTAINER" "$PG_CONTAINER"
printf ' 数据卷     ： %s_picsur-data（升级/重装都不会删除）\n' "$PROJECT"
if [ -n "$login_note" ]; then
  printf ' %s\n' "$login_note"
fi
printf '%s\n' '----------------------------------------------------------------------'
printf ' 常用操作（在 %s 下执行，%s 是本实例的项目名）：\n' "$DIR" "$PROJECT"
printf '   查看日志 ： docker compose -p %s logs -f picsur\n' "$PROJECT"
printf '   重启     ： docker compose -p %s restart picsur\n' "$PROJECT"
printf '   停止     ： docker compose -p %s down\n' "$PROJECT"
printf '   升级     ： 重新运行本脚本（自动保留 .env 与数据卷，--version 可指定 tag）\n'
printf '   连数据一起删： docker compose -p %s down -v   # 危险，图片与账号会全部丢失\n' "$PROJECT"
if [ "$MANAGED_OVERRIDE" != "$USER_OVERRIDE" ]; then
  printf '   注意     ： 手工执行上述命令时需补上 -f %s\n' "$(basename -- "$MANAGED_OVERRIDE")"
fi
printf '======================================================================\n'
