// M5 依赖清单提取单元测试：临时目录写 package.json + package-lock.json 验证提取逻辑。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readManifest } from "../src/lib/security/dependency-manifest";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cg-manifest-"));
}

test("无 package.json 返回 null", () => {
  const dir = makeTmpDir();
  assert.equal(readManifest(dir), null);
});

test("仅 package.json：direct 来自顶层依赖，all 退化为 direct，hasLockfile=false", () => {
  const dir = makeTmpDir();
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: { lodash: "^4.17.15" }, devDependencies: { "@types/node": "^20.0.0" } }),
  );
  const m = readManifest(dir)!;
  assert.equal(m.hasLockfile, false);
  assert.deepEqual(m.all, m.direct);
  // @types/node 被过滤
  assert.deepEqual(m.direct.map((d) => d.name), ["lodash"]);
  assert.equal(m.direct[0].isDirect, true);
});

test("有 lockfile：all 含传递依赖、direct 版本被精确覆盖、isDirect 标记正确", () => {
  const dir = makeTmpDir();
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: { lodash: "^4.17.15" }, devDependencies: {} }),
  );
  fs.writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify({
      packages: {
        "": { name: "root", version: "1.0.0" },
        "node_modules/lodash": { version: "4.17.21" },
        "node_modules/@babel/core": { version: "7.20.0" }, // 传递依赖 + scoped
        "node_modules/lodash/node_modules/minimist": { version: "0.0.8" }, // 嵌套
      },
    }),
  );
  const m = readManifest(dir)!;
  assert.equal(m.hasLockfile, true);

  // direct 版本被 lockfile 精确覆盖
  assert.equal(m.direct.length, 1);
  assert.equal(m.direct[0].name, "lodash");
  assert.equal(m.direct[0].version, "4.17.21"); // 覆盖了 ^4.17.15

  // all 含传递依赖 + scoped + 嵌套，isDirect 标记正确
  const allNames = m.all.map((d) => `${d.name}@${d.version}[${d.isDirect ? "direct" : "trans"}]`);
  assert.deepEqual(allNames, [
    "lodash@4.17.21[direct]",
    "@babel/core@7.20.0[trans]",
    "minimist@0.0.8[trans]",
  ]);
});

test("缺 version 的 lockfile 条目被跳过", () => {
  const dir = makeTmpDir();
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { a: "1.0.0" } }));
  fs.writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify({ packages: { "": { name: "root" }, "node_modules/a": { version: "1.0.0" }, "node_modules/nover": {} } }),
  );
  const m = readManifest(dir)!;
  assert.deepEqual(m.all.map((d) => d.name), ["a"]); // nover 缺 version 被跳过
});
