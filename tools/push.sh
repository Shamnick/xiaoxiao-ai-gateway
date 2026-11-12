#!/usr/bin/env bash
# 一键提交并推送（每次更新后执行）
set -e
cd "$(dirname "$0")/.."
msg="${1:-chore: 更新}"
git add -A
git diff --cached --quiet && { echo "没有需要提交的改动"; exit 0; }
git commit -m "$msg"
git push origin main
echo "已推送：$(git log --oneline -1)"
