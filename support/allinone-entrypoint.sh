#!/bin/sh
#
# Picsur all-in-one 容器入口。
#
#   docker run -d --name picsur --restart always -p 8080:8080 -v ./data:/data zhemed/picsur:allinone
#
# 本脚本是 PID 1（tini）的直接子进程，负责：
#   1. /data 里没有 Postgres 数据时 initdb + 建角色/建库 —— 幂等（只认 $PGDATA/PG_VERSION），
#      第二次启动绝不重新初始化；已有数据就直接启动。
#   2. PICSUR_DB_PASSWORD / PICSUR_ADMIN_PASSWORD / PICSUR_JWT_SECRET 未提供时自动生成
#      （/dev/urandom，足够长）并打印到容器日志；生成结果写入 /data/allinone.env（0600），
#      重启复用。-e 传入的值优先于文件里的值。
#   3. 起 Postgres 17（只监听容器内 127.0.0.1:$DB_PORT 与 $SOCKET_DIR，不对外），
#      再起后端应用；应用启动时照常自动跑迁移（与常规镜像同一条路径）。
#   4. 收到 SIGTERM/SIGINT：先优雅停应用，再 `pg_ctl -m fast stop` 停 Postgres，最后退出；
#      tini 负责收尸，容器里不留僵尸进程。
#
# 只依赖 busybox 自带的 applet（sh / od / sed / head / tr / mkdir / chown / date / wget）。
set -eu

DATA_DIR="${PICSUR_DATA_DIR:-/data}"
PGDATA="${PICSUR_PGDATA:-$DATA_DIR/postgres}"
SECRETS_FILE="$DATA_DIR/allinone.env"

DB_USER="${PICSUR_DB_USERNAME:-picsur}"
DB_NAME="${PICSUR_DB_DATABASE:-picsur}"
DB_HOST="${PICSUR_DB_HOST:-127.0.0.1}"
DB_PORT="${PICSUR_DB_PORT:-5432}"
SOCKET_DIR="${PICSUR_PG_SOCKET_DIR:-/run/postgresql}"
APP_PORT="${PICSUR_PORT:-8080}"

log() {
    printf '%s [allinone] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
    log "FATAL: $*"
    exit 1
}

# 生成随机密钥：$1 = 字节数（输出 $1*2 位十六进制字符）
rand_hex() {
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# 读取 /data/allinone.env 里已保存的值（不存在时输出空）
read_persisted() {
    [ -f "$SECRETS_FILE" ] || return 0
    sed -n "s/^$1=//p" "$SECRETS_FILE" | head -n 1
}

persist_secrets() {
    umask 077
    tmp="$SECRETS_FILE.tmp"
    cat > "$tmp" <<EOF
# Picsur all-in-one 自动生成的密钥（-e 传入的变量优先，不会写入本文件）。
# 备份 /data 时请一并备份本文件，否则重建容器会重新生成：管理员口令会与数据库里的不一致。
PICSUR_DB_PASSWORD=$DB_PASSWORD
PICSUR_ADMIN_PASSWORD=$ADMIN_PASSWORD
PICSUR_JWT_SECRET=$JWT_SECRET
EOF
    chmod 600 "$tmp"
    mv "$tmp" "$SECRETS_FILE"
}

psql_super() {
    su-exec postgres psql -X -q -h "$SOCKET_DIR" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

start_postgres() {
    log "启动 Postgres 17：PGDATA=$PGDATA，监听 $DB_HOST:$DB_PORT（仅容器内）"
    # 以前台方式直接起 postmaster（官方 postgres 镜像的做法）：日志走容器 stdout/stderr，
    # 直接进 `docker logs`。刻意不用 `pg_ctl -l /dev/stdout` —— pg_ctl 会用 /bin/sh 以
    # postgres 用户重新打开 /dev/stdout，容器 stdout 管道属于 root，会 Permission denied（实测）。
    su-exec postgres postgres -D "$PGDATA" \
        -c listen_addresses="$DB_HOST" \
        -c port="$DB_PORT" \
        -c unix_socket_directories="$SOCKET_DIR" \
        -c logging_collector=off &
    PG_PID=$!

    i=0
    while [ "$i" -lt 60 ]; do
        if su-exec postgres pg_isready -q -h "$SOCKET_DIR" -p "$DB_PORT"; then
            log "Postgres 已就绪（pid=$PG_PID）"
            return 0
        fi
        kill -0 "$PG_PID" 2>/dev/null || die "Postgres 进程已退出（详见上面的日志）"
        sleep 1
        i=$((i + 1))
    done
    die "Postgres 60 秒内未就绪"
}

stop_postgres() {
    [ -f "$PGDATA/postmaster.pid" ] || return 0
    log "优雅停止 Postgres（pg_ctl -m fast stop）..."
    if ! su-exec postgres pg_ctl -D "$PGDATA" -m fast -w -t 20 stop; then
        log "WARN: fast 停止未成功，改用 immediate"
        su-exec postgres pg_ctl -D "$PGDATA" -m immediate -w -t 10 stop || true
    fi
    wait "$PG_PID" 2>/dev/null || true
    log "Postgres 已停止"
}

bootstrap_db() {
    # 说明：psql 的 `-c` 不做变量插值（PG 17 起 -c 只接受纯服务器 SQL 或单条反斜杠命令），
    # 所以统一用 stdin 传 SQL，并在 shell 侧按 SQL 字面量规则转义。
    sql_lit() { printf '%s' "$1" | sed "s/'/''/g"; }
    sql_ident() { printf '%s' "$1" | sed 's/"/""/g'; }

    esc_user_lit=$(sql_lit "$DB_USER")
    esc_user_id=$(sql_ident "$DB_USER")
    esc_db_lit=$(sql_lit "$DB_NAME")
    esc_db_id=$(sql_ident "$DB_NAME")
    esc_pw=$(sql_lit "$DB_PASSWORD")

    log "确保角色与数据库存在：$DB_USER / $DB_NAME"
    role_exists=$(psql_super -tA <<SQL
SELECT 1 FROM pg_roles WHERE rolname = '$esc_user_lit';
SQL
)
    if [ "$role_exists" != "1" ]; then
        psql_super <<SQL
CREATE ROLE "$esc_user_id" LOGIN PASSWORD '$esc_pw';
SQL
    else
        # 覆盖两种情况：-e 换了 DB 口令；或 /data/postgres 被删过而 allinone.env 还在
        psql_super <<SQL
ALTER ROLE "$esc_user_id" WITH LOGIN PASSWORD '$esc_pw';
SQL
    fi

    db_exists=$(psql_super -tA <<SQL
SELECT 1 FROM pg_database WHERE datname = '$esc_db_lit';
SQL
)
    if [ "$db_exists" != "1" ]; then
        psql_super <<SQL
CREATE DATABASE "$esc_db_id" OWNER "$esc_user_id";
SQL
    fi

    # uuid 主键依赖 uuid-ossp（在 postgresql17-contrib 里）。应用启动时 typeorm 自己也会
    # 建一次，这里先用超级用户建好：角色是否有权限、扩展是否 trusted 都不再影响首启迁移。
    su-exec postgres psql -X -q -h "$SOCKET_DIR" -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SQL
}

print_banner() {
    log "=============================================================="
    log " Picsur all-in-one 已启动"
    log "   访问地址   : http://<本机IP>:$APP_PORT  （容器内 ${PICSUR_HOST:-0.0.0.0}:$APP_PORT）"
    log "   管理员账号 : admin"
    log "   管理员口令 : $ADMIN_PASSWORD"
    if [ -n "$generated" ]; then
        log "   本次自动生成 :$generated"
        log "   已写入     : $SECRETS_FILE（0600，请随 $DATA_DIR 一起备份）"
    else
        log "   密钥来源   : -e 传入或 $SECRETS_FILE（本次未重新生成）"
    fi
    if [ "$jwt_generated" = "1" ]; then
        log "   JWT secret : $JWT_SECRET（新增，请自行保存）"
    else
        log "   JWT secret : 沿用已有值（保存在 $SECRETS_FILE，日志不重复打印）"
    fi
    log "   数据目录   : $DATA_DIR（Postgres 数据在 $PGDATA）"
    log "   提醒       : 上面这行口令也会出现在 docker logs 里，按需限制日志访问"
    log "=============================================================="
}

stop_app() {
    [ -n "$APP_PID" ] || return 0
    kill -0 "$APP_PID" 2>/dev/null || return 0
    log "通知应用退出（SIGTERM pid=$APP_PID）..."
    kill -TERM "$APP_PID" 2>/dev/null || true
    i=0
    while [ "$i" -lt 5 ]; do
        kill -0 "$APP_PID" 2>/dev/null || break
        sleep 1
        i=$((i + 1))
    done
    if kill -0 "$APP_PID" 2>/dev/null; then
        log "WARN: 应用 5 秒内未退出，强制结束"
        kill -KILL "$APP_PID" 2>/dev/null || true
    fi
    wait "$APP_PID" 2>/dev/null || true
}

on_signal() {
    trap '' TERM INT
    log "收到停止信号，开始优雅退出 ..."
    shutting_down=1
    stop_app
    stop_postgres
    log "已退出（退出码 0）"
    exit 0
}

# 脚本因为 set -e / die 提前退出时，也要把 Postgres 优雅停掉，别留半写状态
on_exit() {
    rc=$?
    if [ "$shutting_down" != "1" ] && [ -n "$PG_PID" ]; then
        log "脚本异常退出（exit=$rc），停止 Postgres ..."
        shutting_down=1
        stop_postgres || true
    fi
    return "$rc"
}

# 后台探测：应用起来后打一行「服务已就绪」，方便测量冷启动耗时
wait_ready() {
    i=0
    while [ "$i" -lt 180 ]; do
        if wget -q -O /dev/null "http://127.0.0.1:$APP_PORT/api/info" 2>/dev/null; then
            log "服务已就绪：/api/info 可访问（http://127.0.0.1:$APP_PORT）"
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done
    log "WARN: 180 秒内未探测到 /api/info，容器继续运行，请查看上面的应用日志"
}

# ---------------------------------------------------------------- 主流程

# 1) 密钥：-e 传入 > /data/allinone.env 已有 > 新生成
env_db_password="${PICSUR_DB_PASSWORD:-}"
env_admin_password="${PICSUR_ADMIN_PASSWORD:-}"
env_jwt_secret="${PICSUR_JWT_SECRET:-}"

mkdir -p "$DATA_DIR" || die "无法创建数据目录 $DATA_DIR"
[ -w "$DATA_DIR" ] || die "数据目录 $DATA_DIR 不可写（检查 -v 挂载目录的宿主权限）"
mkdir -p "$SOCKET_DIR"
chown postgres:postgres "$SOCKET_DIR" 2>/dev/null || true
chmod 0755 "$SOCKET_DIR" 2>/dev/null || true

DB_PASSWORD="$env_db_password"
[ -n "$DB_PASSWORD" ] || DB_PASSWORD="$(read_persisted PICSUR_DB_PASSWORD)"
ADMIN_PASSWORD="$env_admin_password"
[ -n "$ADMIN_PASSWORD" ] || ADMIN_PASSWORD="$(read_persisted PICSUR_ADMIN_PASSWORD)"
JWT_SECRET="$env_jwt_secret"
[ -n "$JWT_SECRET" ] || JWT_SECRET="$(read_persisted PICSUR_JWT_SECRET)"

generated=""
admin_generated=0
jwt_generated=0
if [ -z "$DB_PASSWORD" ]; then
    DB_PASSWORD="$(rand_hex 24)"
    generated="$generated PICSUR_DB_PASSWORD"
fi
if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$(rand_hex 16)"
    generated="$generated PICSUR_ADMIN_PASSWORD"
    admin_generated=1
fi
if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET="$(rand_hex 32)"
    generated="$generated PICSUR_JWT_SECRET"
    jwt_generated=1
fi

if [ ! -f "$SECRETS_FILE" ] || [ -n "$generated" ]; then
    persist_secrets || die "无法写入 $SECRETS_FILE"
fi

export PICSUR_DB_HOST="$DB_HOST"
export PICSUR_DB_PORT="$DB_PORT"
export PICSUR_DB_USERNAME="$DB_USER"
export PICSUR_DB_DATABASE="$DB_NAME"
export PICSUR_DB_PASSWORD="$DB_PASSWORD"
export PICSUR_ADMIN_PASSWORD="$ADMIN_PASSWORD"
export PICSUR_JWT_SECRET="$JWT_SECRET"

# 应用把 npm_package_version 当作 /api/info 的版本号（常规镜像靠 `pnpm run` 自动注入）。
# 我们直接用 exec node 起应用，所以在这里显式注入，值取自 backend/package.json，避免写死。
if [ -z "${npm_package_version:-}" ]; then
    app_version=$(node -p "require('/picsur/backend/package.json').version" 2>/dev/null || true)
    if [ -n "$app_version" ]; then
        export npm_package_version="$app_version"
        log "应用版本号（npm_package_version）：$app_version"
    fi
fi

# 2) 数据目录：只在没有 PG_VERSION 时初始化（幂等）
pgdata_preexisting=0
if [ -f "$PGDATA/PG_VERSION" ]; then
    pgdata_preexisting=1
    log "发现已有数据目录（$PGDATA/PG_VERSION），跳过 initdb"
else
    log "首次启动：$PGDATA/PG_VERSION 不存在，执行 initdb ..."
    mkdir -p "$PGDATA"
    chown postgres:postgres "$PGDATA"
    chmod 0700 "$PGDATA"
    su-exec postgres initdb -D "$PGDATA" -U postgres \
        --encoding=UTF8 --locale=C \
        --auth-local=trust --auth-host=scram-sha-256 ||
        die "initdb 失败（$PGDATA 非空或权限不足）"
fi

# 3) 起库 -> 建库建角色 -> 起应用
APP_PID=""
PG_PID=""
shutting_down=0
trap on_signal TERM INT
trap on_exit EXIT

# 数据库还在、口令记录却丢了（例如只删了 allinone.env 或换了挂载目录）：
# 新生成的口令不会覆盖数据库里的旧口令，这里必须说清楚，否则就是「打印了口令却登不上」。
if [ "$admin_generated" = "1" ] && [ "$pgdata_preexisting" = "1" ]; then
    log "WARN: 数据库已存在但 /data/allinone.env 里没有管理员口令记录，本次新生成的口令"
    log "WARN: 不会覆盖数据库里的旧口令（应用只在用户不存在时创建 admin）。登不进去时用旧口令，"
    log "WARN: 或按 docs/MAINTAINING.md 的凭据轮换步骤重置。"
fi

start_postgres
bootstrap_db
print_banner

if [ "$#" -eq 0 ]; then
    set -- node backend/dist/main.js
fi
log "启动应用：$*"
"$@" &
APP_PID=$!
wait_ready &

rc=0
wait "$APP_PID" || rc=$?

log "应用已退出（exit=$rc），停止 Postgres ..."
shutting_down=1
stop_postgres
exit "$rc"
