#!/usr/bin/env bash
# 从本地把 GitHub Release 的 assets 下载并上传到自有更新服务器
# 用法：
#   ./scripts/release-to-server.sh 2.9.9
# 环境变量（可选）：
#   ADMIN_USERNAME  admin 账号名（默认 chenhui）
#   ADMIN_PASSWORD  admin 密码（若未设置会交互输入）
#   SERVER          服务器域名（默认 auth.3ux.cn）
#   SSH_USER        SSH 登录用户（默认 root）
#   REMOTE_BASE     服务器上的 updates 基础路径（默认 /www/wwwroot/auth.3ux.cn/updates）
# 依赖：gh / ssh / scp / curl / python3

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>   e.g. $0 2.9.9"
  exit 1
fi

TAG="v${VERSION}"
REPO="${REPO:-Boohu/banana-pro}"
SERVER="${SERVER:-auth.3ux.cn}"
SSH_USER="${SSH_USER:-root}"
REMOTE_BASE="${REMOTE_BASE:-/www/wwwroot/auth.3ux.cn/updates}"
REMOTE_DIR="${REMOTE_BASE}/${VERSION}"
ADMIN_USERNAME="${ADMIN_USERNAME:-chenhui}"

# 交互输入密码（如未通过环境变量提供）
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  read -rsp "管理员密码 (${ADMIN_USERNAME}): " ADMIN_PASSWORD
  echo
fi
if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "❌ 管理员密码为空" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "=== 1/5 下载 GitHub Release v${VERSION} 资产 ==="

# 构造鉴权 header：优先使用 GITHUB_TOKEN / GH_TOKEN env，否则尝试 gh CLI token
AUTH_HEADER=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  echo "  使用 GITHUB_TOKEN 鉴权"
elif [[ -n "${GH_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${GH_TOKEN}")
  echo "  使用 GH_TOKEN 鉴权"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  GH_TOKEN_CACHED="$(gh auth token 2>/dev/null || true)"
  if [[ -n "$GH_TOKEN_CACHED" ]]; then
    AUTH_HEADER=(-H "Authorization: Bearer ${GH_TOKEN_CACHED}")
    echo "  使用 gh CLI 登录态鉴权"
  fi
fi
if [[ ${#AUTH_HEADER[@]} -eq 0 ]]; then
  echo "  ⚠️  未提供 GitHub 鉴权（GITHUB_TOKEN/GH_TOKEN/gh auth），私有仓库可能下载失败"
fi

REL_JSON_PATH="$TMP/_release.json"
curl -sSfL ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} -H "Accept: application/vnd.github+json" \
  -o "$REL_JSON_PATH" "https://api.github.com/repos/${REPO}/releases/tags/${TAG}" || {
  echo "❌ 无法获取 release 元数据：$REPO $TAG（检查是否私有仓库且未提供 token）" >&2
  exit 1
}
if ! python3 -c "import json; json.load(open('$REL_JSON_PATH'))" >/dev/null 2>&1; then
  echo "❌ release 元数据非 JSON"
  cat "$REL_JSON_PATH" | head -20
  exit 1
fi

# 解析 assets → 写到 tsv 文件
ASSETS_TSV="$TMP/_assets.tsv"
python3 <<PY > "$ASSETS_TSV"
import json
d = json.load(open('$REL_JSON_PATH'))
exts = ('.app.tar.gz', '.app.tar.gz.sig', '_x64-setup.exe', '_x64-setup.exe.sig', '.dmg')
for a in d.get('assets', []):
    n = a.get('name','')
    if any(n.endswith(e) for e in exts) or n == 'latest.json':
        print(f"{n}\t{a['browser_download_url']}")
PY

if [[ ! -s "$ASSETS_TSV" ]]; then
  echo "❌ 未在 Release 中找到任何可用资产"
  exit 1
fi

while IFS=$'\t' read -r aname aurl; do
  [[ -z "$aname" ]] && continue
  echo "  下载 $aname ..."
  # 私有仓库的 release assets 需要发到 api.github.com/repos/.../releases/assets/<id> 端点
  # 并带 Accept: application/octet-stream，才能真正拿到文件
  # browser_download_url 在私有仓库对普通 token 可能返回 302 → S3 但 S3 需要 Referer，这里直接兼容两种写法
  if ! curl -sSfL ${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"} -H "Accept: application/octet-stream" \
       -o "$TMP/$aname" "$aurl"; then
    echo "❌ 下载失败: $aname"
    exit 1
  fi
done < "$ASSETS_TSV"
rm -f "$ASSETS_TSV" "$REL_JSON_PATH".tmp

ls -lh "$TMP" | grep -v "^total\|_release.json"

# 验证核心文件是否齐全
required_patterns=("aarch64*.app.tar.gz" "aarch64*.app.tar.gz.sig" "universal*.app.tar.gz" "universal*.app.tar.gz.sig" "*_x64-setup.exe" "*_x64-setup.exe.sig")
for p in "${required_patterns[@]}"; do
  if ! ls "$TMP"/$p >/dev/null 2>&1; then
    echo "⚠️  缺少核心资产：$p"
  fi
done

echo ""
echo "=== 2/5 上传到服务器 ${SERVER}:${REMOTE_DIR} ==="
ssh "${SSH_USER}@${SERVER}" "mkdir -p '${REMOTE_DIR}'"
# 批量 scp（*.dmg 不强制，安装包用 exe/tar.gz 即可但 dmg 也一起上传给用户下载）
scp "$TMP"/* "${SSH_USER}@${SERVER}:${REMOTE_DIR}/"
echo "✓ 上传完成"

echo ""
echo "=== 3/5 登录 admin 获取 token ==="
LOGIN_PAYLOAD="$(U="$ADMIN_USERNAME" P="$ADMIN_PASSWORD" \
  python3 -c "import json,os; print(json.dumps({'username':os.environ['U'],'password':os.environ['P']}))")"
LOGIN_RESP="$(
  curl -sS -X POST "https://${SERVER}/api/admin/login" \
    -H "Content-Type: application/json" \
    -d "$LOGIN_PAYLOAD"
)"
TOKEN="$(echo "$LOGIN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('token',''))")"
if [[ -z "$TOKEN" ]]; then
  echo "❌ 登录失败: $LOGIN_RESP" >&2
  exit 1
fi
echo "✓ 登录成功"

echo ""
echo "=== 4/5 读取 .sig 内容 ==="
# .sig 文件内容本身就是 base64 文本（minisign 格式），直接 cat，不做二次 base64 编码
sig_b64() {
  local f="$1"
  if [[ -f "$f" ]]; then
    cat "$f"
  else
    echo ""
  fi
}

DARWIN_ARM_SIG_PATH="$(ls "$TMP"/*aarch64*.app.tar.gz.sig 2>/dev/null | head -1 || true)"
DARWIN_UNI_SIG_PATH="$(ls "$TMP"/*universal*.app.tar.gz.sig 2>/dev/null | head -1 || true)"
WIN_SIG_PATH="$(ls "$TMP"/*_x64-setup.exe.sig 2>/dev/null | head -1 || true)"

DARWIN_ARM_NAME="$(basename "$(ls "$TMP"/*aarch64*.app.tar.gz | grep -v '\.sig$' | head -1)")"
DARWIN_UNI_NAME="$(basename "$(ls "$TMP"/*universal*.app.tar.gz | grep -v '\.sig$' | head -1)")"
WIN_NAME="$(basename "$(ls "$TMP"/*_x64-setup.exe | grep -v '\.sig$' | head -1)")"

BASE_URL="https://${SERVER}/updates/${VERSION}"

DARWIN_ARM_SIG="$(sig_b64 "$DARWIN_ARM_SIG_PATH")"
DARWIN_UNI_SIG="$(sig_b64 "$DARWIN_UNI_SIG_PATH")"
WIN_SIG="$(sig_b64 "$WIN_SIG_PATH")"

echo "  darwin-aarch64: ${DARWIN_ARM_NAME:-(缺失)}  sig=${#DARWIN_ARM_SIG}字符"
echo "  darwin-universal: ${DARWIN_UNI_NAME:-(缺失)}  sig=${#DARWIN_UNI_SIG}字符"
echo "  windows-x64: ${WIN_NAME:-(缺失)}  sig=${#WIN_SIG}字符"

echo ""
echo "=== 5/5 从 Release 提取 notes 并调用 admin API 注册版本 ==="
NOTES="$(python3 -c "import json; print((json.load(open('$REL_JSON_PATH')).get('body') or '')[:8000])")"

export V="$VERSION" NOTES BASE="$BASE_URL" \
       A_NAME="$DARWIN_ARM_NAME" A_SIG="$DARWIN_ARM_SIG" \
       U_NAME="$DARWIN_UNI_NAME" U_SIG="$DARWIN_UNI_SIG" \
       W_NAME="$WIN_NAME" W_SIG="$WIN_SIG"

PAYLOAD="$(python3 <<PY
import json, os
print(json.dumps({
  "app_id": "jdyai",
  "version": os.environ["V"],
  "notes": os.environ["NOTES"],
  "darwin_aarch64_url": f"{os.environ['BASE']}/{os.environ['A_NAME']}" if os.environ.get('A_NAME') else "",
  "darwin_aarch64_sig": os.environ.get("A_SIG", ""),
  "darwin_x86_64_url": f"{os.environ['BASE']}/{os.environ['U_NAME']}" if os.environ.get('U_NAME') else "",
  "darwin_x86_64_sig": os.environ.get("U_SIG", ""),
  "windows_x86_64_url": f"{os.environ['BASE']}/{os.environ['W_NAME']}" if os.environ.get('W_NAME') else "",
  "windows_x86_64_sig": os.environ.get("W_SIG", ""),
}, ensure_ascii=False))
PY
)"

REG_RESP="$(
  curl -sS -X POST "https://${SERVER}/api/admin/versions" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD"
)"
echo "$REG_RESP" | python3 -m json.tool

CODE="$(echo "$REG_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('code',-1))")"
if [[ "$CODE" != "200" ]]; then
  echo "❌ 注册失败" >&2
  exit 1
fi

echo ""
echo "✅ 发布完成 v${VERSION}"
echo "   更新 endpoint: https://${SERVER}/api/update/check?target=...&current_version=..."
