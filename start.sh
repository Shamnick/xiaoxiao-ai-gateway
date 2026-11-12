#!/usr/bin/env bash
# 宇天科技镜像站 + 管理后台 启动脚本
set -e
cd "$(dirname "$0")"
export PORT="${PORT:-8848}"
export HOST="${HOST:-127.0.0.1}"
echo "前台: http://${HOST}:${PORT}/"
echo "后台: http://${HOST}:${PORT}/admin/  (默认 admin / admin123)"
exec node server/server.js
