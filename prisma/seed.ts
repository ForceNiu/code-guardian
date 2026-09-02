import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";

const FIXTURE = path.join(process.cwd(), "fixtures", "sample-repo");

function git(cmd: string): string {
  return execSync(cmd, { cwd: FIXTURE, encoding: "utf8" }).trim();
}

async function main() {
  if (!existsSync(path.join(FIXTURE, ".git"))) {
    console.error("❌ 示例仓库不存在，请先运行 `npm run fixture` 生成。");
    process.exit(1);
  }

  const head = git("git rev-parse HEAD");
  const base = git("git rev-parse HEAD~1");
  const gitUrl = FIXTURE;

  const repo = await prisma.repository.upsert({
    where: { gitUrl },
    create: { name: "sample-repo", gitUrl, defaultBranch: "main" },
    update: {},
  });

  // 幂等：同一 (repo, mr, commit) 不重复插入
  const task = await prisma.task.upsert({
    where: { repoId_mrId_commitSha: { repoId: repo.id, mrId: "demo-1", commitSha: head } },
    create: {
      repoId: repo.id,
      mrId: "demo-1",
      commitSha: head,
      baseRef: base,
      headRef: head,
    },
    update: { baseRef: base, headRef: head },
  });

  console.log("✅ seed 完成：");
  console.log(`   repository  id=${repo.id}  name=${repo.name}`);
  console.log(`   task        id=${task.id}  status=${task.status}`);
  console.log(`   base=${base.slice(0, 8)} → head=${head.slice(0, 8)}`);
}

main()
  .catch((e) => {
    console.error("❌ seed 失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
