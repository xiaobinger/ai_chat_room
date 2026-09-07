#!/usr/bin/env bash
# =============================================================================
# 天马行空 —— 发布脚本（裸机 + PM2 + nginx）
#
# 做什么：
#   1. 安装依赖（frozen lockfile，保证可复现）
#   2. Prisma generate + migrate（幂等，可重复执行）
#   3. 构建前端（apps/web -> apps/web/dist）
#   4. 打包 releases/<timestamp>/ 归档（可回滚）
#   5. 可选：pm2 reload（由 RELOAD_PM2=1 控制）
#
# 用法：
#   bash scripts/release.sh              # 只构建归档
#   RELOAD_PM2=1 bash scripts/release.sh # 构建 + 零停机重载
#
# 前置条件：
#   - Node >= 20.11, pnpm >= 9
#   - MySQL 8 可连接（migrate 需要）
#   - .env 已配置（DATABASE_URL / REDIS_URL / JWT_SECRET 等）
# =============================================================================
set -euo pipefail

RELEASE_DIR="releases/$(date +%Y%m%d%H%M%S)"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> 1/5 安装依赖"
pnpm install --frozen-lockfile

echo "==> 2/5 Prisma generate + migrate"
# 强制重新生成客户端，避免 node_modules 缓存旧版本导致字段缺失
rm -rf node_modules/.prisma/client
pnpm db:generate
pnpm db:migrate

echo "==> 3/5 构建前端"
pnpm build

echo "==> 4/5 打包归档 -> $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
# 只复制运行所需，不复制源码与 dev 依赖
cp -r apps "$RELEASE_DIR/"
cp -r packages "$RELEASE_DIR/"
cp -r node_modules "$RELEASE_DIR/"
cp ecosystem.config.cjs "$RELEASE_DIR/"
cp pnpm-workspace.yaml "$RELEASE_DIR/"
cp package.json "$RELEASE_DIR/"
cp pnpm-lock.yaml "$RELEASE_DIR/"
cp .env "$RELEASE_DIR/" 2>/dev/null || echo "（警告：未复制 .env，请手动放置到目标机）"

# 软链 current 指向最新发布（方便回滚：ln -sfn releases/<旧时间戳> current）
ln -sfn "$(basename "$RELEASE_DIR")" releases/current
echo "    归档完成：$RELEASE_DIR"
echo "    软链更新：releases/current -> $(basename "$RELEASE_DIR")"

echo "==> 5/5 PM2 重载"
if [[ "${RELOAD_PM2:-0}" == "1" ]]; then
  if command -v pm2 &>/dev/null; then
    cd releases/current
    pm2 reload ecosystem.config.cjs --update-env
    pm2 save
    echo "    PM2 重载完成"
  else
    echo "    （警告：pm2 未安装，跳过重载。手动执行：cd releases/current && pm2 start ecosystem.config.cjs）"
  fi
else
  echo "    （跳过。设置 RELOAD_PM2=1 启用自动重载）"
fi

echo "==> 发布完成"
echo ""
echo "回滚命令："
echo "  ln -sfn releases/<旧时间戳> releases/current"
echo "  cd releases/current && pm2 reload ecosystem.config.cjs"
