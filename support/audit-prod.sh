#!/usr/bin/env bash
# Picsur 生产口径依赖审计：后端/共享必须 0，前端运行时只提示、不阻断。
#
# 背景：`frontend/package.json` 的运行时库（Angular / rxjs / axios / moment …）会打进
# 浏览器产物发给用户，所以它们属于 `dependencies`（2026-10-15 审计修复前误放在
# `devDependencies`，导致 `pnpm audit --prod` 看不到它们）。搬过来之后，
# `pnpm audit --prod` 会**同时**报出浏览器侧的告警 —— 那是已知的、要随 Angular
# 大版本升级才能清掉的存量；真正跑在服务器上的代码（backend / shared 的生产依赖闭包）
# 必须保持 0，这个口径不能被浏览器侧的数字稀释。
#
# 判定方法：拿 `pnpm audit --prod` 命中的 (包名, 版本)，逐个问一句
# 「这个 (包, 版本) 在后端/共享的生产依赖闭包里吗」。闭包直接读 `pnpm-lock.yaml`
# （不依赖 node_modules 是否安装、也不依赖是否跑过 install）。
#
# 用法：
#   bash support/audit-prod.sh
#
# 退出码：
#   0 = 后端/共享口径 0 告警（浏览器侧可能有已知告警，脚本会列出来）
#   1 = 后端/共享还有告警
#   2 = 审计本身失败（registry 不可达 / 依赖缺失）
#
# 依赖：`pnpm`、`python3`（+ PyYAML）。默认 registry 是官方源（本机默认源没有
# audit 端点），可用 PICSUR_AUDIT_REGISTRY 覆盖。
set -uo pipefail
cd "$(dirname "$0")/.."

REGISTRY="${PICSUR_AUDIT_REGISTRY:-https://registry.npmjs.org/}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "▶ pnpm audit --prod（registry: $REGISTRY）"
# 有告警时 pnpm 退出码非 0，属正常；只有拿不到 JSON 才算失败。
pnpm audit --prod --json --registry "$REGISTRY" >"$TMP" 2>/dev/null || true
if ! grep -q '"advisories"' "$TMP" 2>/dev/null; then
  echo "❌ 拿不到审计结果（registry 不可达，或本机默认源没有 audit 端点）：$REGISTRY"
  exit 2
fi

python3 - "$TMP" <<'PY'
import collections
import json
import sys

try:
    import yaml
except ImportError:
    print('❌ 需要 python3 + PyYAML 才能解析 pnpm-lock.yaml（pip install pyyaml）')
    sys.exit(2)

advisories = list((json.load(open(sys.argv[1])).get('advisories') or {}).values())

lock = yaml.safe_load(open('pnpm-lock.yaml'))
snapshots = lock.get('snapshots') or {}


def prod_closure(importer: str) -> set:
    """生产依赖闭包（snapshot 级，形如 'pkg@version'）。"""
    deps = (lock['importers'].get(importer) or {}).get('dependencies') or {}
    seen, stack = set(), [(name, meta['version']) for name, meta in deps.items()]
    while stack:
        name, version = stack.pop()
        key = f'{name}@{version}'
        if key in seen:
            continue
        seen.add(key)
        node = snapshots.get(key) or {}
        for section in ('dependencies', 'optionalDependencies'):
            for dep, dep_version in (node.get(section) or {}).items():
                stack.append((dep, dep_version))
    return seen


server_side = prod_closure('backend') | prod_closure('shared')

blocking = collections.defaultdict(list)   # (severity) -> [描述]
browser_side = collections.defaultdict(list)
for advisory in advisories:
    for finding in advisory.get('findings', []):
        ref = f"{advisory['module_name']}@{finding.get('version')}"
        line = f"{ref:44} {advisory['severity']:8} {advisory['title'][:60]}"
        (blocking if ref in server_side else browser_side)[advisory['severity']].append(line)

order = ['critical', 'high', 'moderate', 'low']
def summary(bucket):
    return ", ".join(f"{len(bucket[s])} {s}" for s in order if bucket.get(s)) or "0"

print(f"  backend/shared 生产依赖闭包：{len(server_side)} 个包")
print(f"  命中总数：后端/共享 {sum(len(v) for v in blocking.values())} ｜ 浏览器侧 {sum(len(v) for v in browser_side.values())}")

if browser_side:
    print("\n  ▸ 浏览器侧（已知存量，随 Angular 大版本升级解决；不影响本次判定）")
    for severity in order:
        for line in browser_side.get(severity, []):
            print(f"      [{severity}] {line}")

if blocking:
    print("\n  ▸ ❌ 后端/共享（阻断）")
    for severity in order:
        for line in blocking.get(severity, []):
            print(f"      [{severity}] {line}")
    print("\n❌ 后端/共享生产依赖有告警 —— 必须清零后再发版。")
    sys.exit(1)

print(f"\n✅ 后端/共享口径 0 告警（浏览器侧 {sum(len(v) for v in browser_side.values())} 条，已知）")
PY
