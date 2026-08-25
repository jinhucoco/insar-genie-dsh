#!/usr/bin/env bash
# ============================================================================
# insar-genie-dsh 一键发布脚本
#
# 用法:
#   bash .release.sh patch      # bump patch (bug 修复/文档): 0.1.0 -> 0.1.1
#   bash .release.sh minor      # bump minor (新功能, 非 breaking): 0.1.0 -> 0.2.0
#   bash .release.sh major      # bump major (breaking): 0.1.0 -> 1.0.0
#   bash .release.sh 0.2.0      # 直接指定版本号
#   bash .release.sh --dry-run  # 只打印将执行的操作, 不实际发布
#
# 流程:
#   1. 确认技能仓库 assets 已同步(改脚本必须先改技能仓库 dev 并用 sync_assets --sync)
#   2. npm version bump (更新 package.json + package-lock.json + 打 git tag)
#   3. npm run build (prepack 也会跑, 但显式 build 保证产物最新)
#   4. 校验两仓资产一致 (sync_assets)
#   5. npm publish --access public (scoped 包必须 public 才免费)
#   6. git push origin main --follow-tags (推送 tag 触发 CI)
#
# 依赖: npm 已登录 (npm whoami), 能访问技能仓库, git 已配置 SSH/HTTPS.
# ============================================================================
set -euo pipefail
# 脚本在仓库根, 直接 cd 到脚本所在目录
cd "$(dirname "$0")"
ROOT="$(pwd)"
SKILL_REPO="${INSAR_GENIE_SKILL_REPO:-/c/Users/86155/.pi/agent/skills/asf-sentinel1-download}"
PLUGIN_NAME="$(node -e "console.log(require('./package.json').name)")"

C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'; C_NC='\033[0m'
ok(){ echo -e "${C_GREEN}[OK]${C_NC} $*"; }
warn(){ echo -e "${C_YELLOW}[!]${C_NC} $*"; }
die(){ echo -e "${C_RED}[X]${C_NC} $*" >&2; exit 1; }

BUMP="${1:-patch}"
DRY=0
[ "$BUMP" = "--dry-run" ] && { DRY=1; BUMP=patch; }

# --- 0. 前置检查 ---
command -v npm >/dev/null || die "npm 不可用"
[ "$(npm whoami 2>/dev/null)" ] || die "npm 未登录 (npm whoami 为空)"
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || warn "当前不在 main 分支 (实际: $(git rev-parse --abbrev-ref HEAD))"

# --- 1. 校验技能仓库资产一致 (改脚本必须先改技能仓库 dev) ---
warn "校验两仓资产一致 (技能仓库: $SKILL_REPO)..."
if ! PYTHONIOENCODING=utf-8 python scripts/sync_assets.py --skill-repo "$SKILL_REPO" 2>&1 | tail -3; then
  die "资产校验失败: 先改技能仓库 dev 并跑 scripts/sync_assets.py --skill-repo <技能仓库> --sync"
fi

# --- 2. 确定版本号 ---
CUR="$(node -e "console.log(require('./package.json').version)")"
case "$BUMP" in
  patch|minor|major|prepatch|preminor|premajor|prerelease) NEXT="$BUMP" ;;
  *) NEXT="$BUMP" ;;   # 直接指定的版本号
esac
ok "当前版本: $CUR → 将 bump 为: $NEXT"

# --- 3. 构建 + 测试 + 发布 (dry-run 时跳过实际命令) ---
if [ "$DRY" = 1 ]; then
  echo ""; echo "=== [dry-run] 将执行以下操作 ==="; echo "  npm version $NEXT (需覆盖无新提交时: --allow-same-version 或 --no-git-tag-version)"
  echo "  npm run build"; echo "  npm publish --access public"
  echo "  git push origin main --follow-tags (+ 技能仓库 dev 若已改)"
  echo "=== [dry-run] 完成 (未做任何发布) ==="; exit 0
fi

# --- 4. bump 版本 + 打 tag ---
ok "bump 版本: npm version $NEXT"
npm version "$NEXT" --no-git-tag-version   # 只改 package.json/lock, tag 后面手动打
# 重新打 git tag (对齐 npm version)
TAG="v$(node -e "console.log(require('./package.json').version)")"
git add package.json package-lock.json
git commit -m "chore(release): v$TAG" || warn "无改动可提交"
git tag "$TAG" -f
ok "tag 已打: $TAG"

# --- 5. 构建 + 测试 ---
ok "构建产物: npm run build"
npm run build

# --- 6. 校验资产 + 发布 ---
warn "发布前二次校验资产一致..."
PYTHONIOENCODING=utf-8 python scripts/sync_assets.py --skill-repo "$SKILL_REPO" 2>&1 | tail -2
ok "发布 npm: $PLUGIN_NAME"
npm publish --access public

# --- 7. 推送 git (main + tag 触发 CI) ---
ok "推送 git (main + tag)..."
git push origin main --follow-tags || warn "git push 失败, 请手动推送 (git push origin main --follow-tags)"

echo ""
echo "====================================================="
echo "  ✅ 发布完成: $PLUGIN_NAME@$(node -e "console.log(require('./package.json').version)")"
echo "====================================================="
echo ""
echo "  用户升级: dsh plugin --profile web update $PLUGIN_NAME (或全量 update)"
echo "  注意: 若改过资产, 记得同步技能仓库 dev:"
echo "    cd $SKILL_REPO && git add -A && git commit -m 'fix(plugin): ...' && git push origin dev"
