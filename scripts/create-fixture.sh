#!/usr/bin/env bash
# 生成用于演示的示例 git 仓库：跨文件引用 + 一个「删函数/改签名/加函数」的典型 MR。
# 产物：fixtures/sample-repo（自带独立 git 历史），并打印 base / head 两个 commit SHA。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$ROOT/fixtures/sample-repo"

rm -rf "$REPO"
mkdir -p "$REPO/src/utils" "$REPO/src/services" "$REPO/src/pages"

cd "$REPO"
git init -q
git config user.email "demo@code-guardian.local"
git config user.name "Code Guardian Demo"

# ── base 版本 ──────────────────────────────────────────────────
cat > package.json <<'EOF'
{ "name": "sample-repo", "version": "1.0.0", "private": true }
EOF

cat > src/utils/format.ts <<'EOF'
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatPrice(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}
EOF

cat > src/utils/math.ts <<'EOF'
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
EOF

cat > src/services/api.ts <<'EOF'
import { formatDate, formatPrice } from "../utils/format";
import { add } from "../utils/math";

export function fetchUser(id: number): string {
  return `user-${id}`;
}

export function fetchOrder(id: number): string {
  const total = add(id, 10);
  const day = formatDate(new Date());
  return `${day}:${formatPrice(total)}`;
}
EOF

cat > src/pages/home.tsx <<'EOF'
import { formatPrice } from "../utils/format";
import { add } from "../utils/math";

export function HomePage(): string {
  const total = add(2, 3);
  return formatPrice(total);
}
EOF

git add -A
git commit -q -m "base: 初始实现"
BASE_SHA="$(git rev-parse HEAD)"

# ── head 版本：format.ts 删 formatDate、改 formatPrice 签名、加 formatCurrency ──
cat > src/utils/format.ts <<'EOF'
export function formatPrice(amount: number, currency: string = "CNY"): string {
  const symbol = currency === "CNY" ? "¥" : "$";
  return `${symbol}${amount.toFixed(2)}`;
}

export function formatCurrency(code: string): string {
  return code;
}
EOF

git add -A
git commit -q -m "head: 重构 formatPrice 并删除 formatDate"
HEAD_SHA="$(git rev-parse HEAD)"

echo "fixture 已生成：$REPO"
echo "BASE_SHA=$BASE_SHA"
echo "HEAD_SHA=$HEAD_SHA"
