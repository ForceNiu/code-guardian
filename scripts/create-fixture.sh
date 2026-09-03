#!/usr/bin/env bash
# 生成用于演示的示例 git 仓库：跨文件引用 + 一个「多文件混合变更」的典型 MR。
# 目标：一次任务里同时出现——
#   ① uncertain 变更（规则引擎归不了类 → 触发 AI 语义引擎）：
#      - 多个 export function → export const 箭头函数（符号类型 function→variable）
#      - 一个 enum 成员顺序变化（成员集相同 → 交 AI）
#   ② proven 变更（规则引擎直接定级，不送 AI）：
#      - 删除一个被引用的导出（formatDate → 高危）
#      - 给函数追加可选参数（multiply → 低危）
#   ③ 安全门禁（M5）：head 引入 lodash@4.17.15 + axios@0.21.1（含传递依赖
#      follow-redirects），触发 CVE 漏洞扫描 + 依赖体积门禁。
# 产物：fixtures/sample-repo（自带独立 git 历史），并打印 base / head 两个 commit SHA。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$ROOT/fixtures/sample-repo"

rm -rf "$REPO"
mkdir -p "$REPO/src/utils" "$REPO/src/services" "$REPO/src/pages"

cd "$REPO"
git init -q -b main
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

# ⑧ head 引入有漏洞的依赖（演示安全门禁：CVE 扫描 + 体积门禁）
#    lodash@4.17.15（原型污染 CVE-2019-10744 等）、axios@0.21.1（SSRF CVE-2021-3749 等）
#    传递依赖 follow-redirects（高严重 SSRF），完整依赖树由 lockfile 提供
cat > package.json <<'EOF'
{
  "name": "sample-repo",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "lodash": "4.17.15",
    "axios": "0.21.1"
  }
}
EOF

cat > package-lock.json <<'EOF'
{
  "name": "sample-repo",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "sample-repo",
      "version": "1.0.0",
      "dependencies": {
        "axios": "0.21.1",
        "lodash": "4.17.15"
      }
    },
    "node_modules/axios": {
      "version": "0.21.1",
      "resolved": "https://registry.npmjs.org/axios/-/axios-0.21.1.tgz",
      "integrity": "sha512-dKQiRHxGD9PPRIUNIWvZhPTPpl1rf/OxTYKsqKUDjBwYylTvV7SjSHJb9ratfyzM6wCdLCOYLzs73qpg5c4iGA==",
      "license": "MIT",
      "dependencies": {
        "follow-redirects": "^1.10.0"
      }
    },
    "node_modules/follow-redirects": {
      "version": "1.16.0",
      "resolved": "https://registry.npmjs.org/follow-redirects/-/follow-redirects-1.16.0.tgz",
      "integrity": "sha512-y5rN/uOsadFT/JfYwhxRS5R7Qce+g3zG97+JrtFZlC9klX/W5hD7iiLzScI4nZqUS7DNUdhPgw4xI8W2LuXlUw==",
      "license": "MIT",
      "engines": {
        "node": ">=4.0"
      },
      "peerDependenciesMeta": {
        "debug": {
          "optional": true
        }
      }
    },
    "node_modules/lodash": {
      "version": "4.17.15",
      "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz",
      "integrity": "sha512-8xOcRHvCjnocdS5cpwXQXVzmmh5e5+saE2QGoeQmbKmRS6J3VQppPOIt0MnmE+4xlZoumy0GPG0D0MVIQbNA1A==",
      "license": "MIT"
    }
  }
}
EOF

git add -A
git commit -q -m "head: 多文件重构（函数转 const + enum 顺序 + 删 formatDate + 引入 lodash/axios 依赖）"
HEAD_SHA="$(git rev-parse HEAD)"

echo "fixture 已生成：$REPO"
echo "BASE_SHA=$BASE_SHA"
echo "HEAD_SHA=$HEAD_SHA"
