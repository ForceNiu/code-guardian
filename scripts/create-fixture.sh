#!/usr/bin/env bash
# 生成用于演示的示例 git 仓库：跨文件引用 + 一个「多文件混合变更」的典型 MR。
# 目标：一次任务里同时出现——
#   ① uncertain 变更（规则引擎归不了类 → 触发 AI 语义引擎）：
#      - 多个 export function → export const 箭头函数（符号类型 function→variable）
#      - 一个 enum 成员顺序变化（成员集相同 → 交 AI）
#   ② proven 变更（规则引擎直接定级，不送 AI）：
#      - 删除一个被引用的导出（formatDate → 高危）
#      - 给函数追加可选参数（multiply → 低危）
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

cat > src/utils/math.ts <<'EOF'
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
EOF

cat > src/utils/format.ts <<'EOF'
export function formatPrice(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
EOF

cat > src/utils/status.ts <<'EOF'
export enum OrderStatus {
  Pending,
  Paid,
  Shipped,
  Done,
}
EOF

cat > src/services/api.ts <<'EOF'
import { formatPrice, formatDate } from "../utils/format";
import { add } from "../utils/math";

export function fetchUser(id: number): string {
  return `user-${id}`;
}

export function fetchOrder(id: number): string {
  const total = add(id, 10);
  return `${formatDate(new Date())}:${formatPrice(total)}`;
}
EOF

cat > src/services/cart.ts <<'EOF'
import { add, multiply } from "../utils/math";

export function calcTotal(price: number, qty: number): number {
  return multiply(price, qty) + add(price, 0);
}
EOF

cat > src/pages/home.tsx <<'EOF'
import { formatPrice } from "../utils/format";
import { add } from "../utils/math";
import { OrderStatus } from "../utils/status";

export function HomePage(): string {
  const total = add(2, 3);
  void OrderStatus.Pending;
  return formatPrice(total);
}
EOF

cat > src/pages/checkout.tsx <<'EOF'
import { formatPrice } from "../utils/format";
import { calcTotal } from "../services/cart";
import { OrderStatus } from "../utils/status";

export function CheckoutPage(price: number, qty: number): string {
  const total = calcTotal(price, qty);
  void OrderStatus.Shipped;
  return formatPrice(total);
}
EOF

git add -A
git commit -q -m "base: 初始实现"
BASE_SHA="$(git rev-parse HEAD)"

# ── head 版本：混合 uncertain + proven 变更，覆盖 7 个文件 ─────
# ① math.ts：add 函数→const（uncertain）；multiply 追加可选参数（proven 低危）
cat > src/utils/math.ts <<'EOF'
export const add = (a: number, b: number): number => a + b;

export function multiply(a: number, b: number, c: number = 1): number {
  return a * b * c;
}
EOF

# ② format.ts：formatPrice 函数→const（uncertain）；删除 formatDate（proven 高危，被 api.ts 引用）
cat > src/utils/format.ts <<'EOF'
export const formatPrice = (amount: number): string => `¥${amount.toFixed(2)}`;
EOF

# ③ status.ts：enum 成员顺序变化（成员集相同 → uncertain，交 AI）
cat > src/utils/status.ts <<'EOF'
export enum OrderStatus {
  Pending,
  Shipped,
  Paid,
  Done,
}
EOF

# ④ api.ts：fetchUser 函数→const（uncertain）；fetchOrder 仍引用已删除的 formatDate
cat > src/services/api.ts <<'EOF'
import { formatPrice, formatDate } from "../utils/format";
import { add } from "../utils/math";

export const fetchUser = (id: number): string => `user-${id}`;

export function fetchOrder(id: number): string {
  const total = add(id, 10);
  return `${formatDate(new Date())}:${formatPrice(total)}`;
}
EOF

# ⑤ cart.ts：calcTotal 函数→const（uncertain）
cat > src/services/cart.ts <<'EOF'
import { add, multiply } from "../utils/math";

export const calcTotal = (price: number, qty: number): number =>
  multiply(price, qty) + add(price, 0);
EOF

# ⑥ home.tsx：HomePage 函数→const（uncertain）
cat > src/pages/home.tsx <<'EOF'
import { formatPrice } from "../utils/format";
import { add } from "../utils/math";
import { OrderStatus } from "../utils/status";

export const HomePage = (): string => {
  const total = add(2, 3);
  void OrderStatus.Pending;
  return formatPrice(total);
};
EOF

# ⑦ checkout.tsx：CheckoutPage 函数→const（uncertain）
cat > src/pages/checkout.tsx <<'EOF'
import { formatPrice } from "../utils/format";
import { calcTotal } from "../services/cart";
import { OrderStatus } from "../utils/status";

export const CheckoutPage = (price: number, qty: number): string => {
  const total = calcTotal(price, qty);
  void OrderStatus.Shipped;
  return formatPrice(total);
};
EOF

git add -A
git commit -q -m "head: 多文件重构（函数转 const + enum 顺序 + 删 formatDate）"
HEAD_SHA="$(git rev-parse HEAD)"

echo "fixture 已生成：$REPO"
echo "BASE_SHA=$BASE_SHA"
echo "HEAD_SHA=$HEAD_SHA"
