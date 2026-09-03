import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getEventBus } from "./events";

export interface EnqueueInput {
  gitUrl: string;
  mrId: string;
  commitSha: string;
  baseRef?: string;
  headRef?: string;
  /** 事件源（M5 GitLab 回写判定）：gitlab-mr / github-push / github-pr，缺省=手动触发 */
  source?: string;
  /** GitLab project id（仅 gitlab-mr 来源，回写 commit status 用） */
  gitlabProjectId?: string;
}

export interface EnqueueResult {
  status: "created" | "duplicate";
  taskId: string;
}

function deriveName(gitUrl: string): string {
  const trimmed = gitUrl.replace(/\/$/, "").replace(/\.git$/, "");
  const seg = trimmed.split("/").filter(Boolean).pop();
  return seg || gitUrl;
}

/**
 * 任务入队：按 gitUrl 找到/创建仓库，插入 Task。
 * 依赖 Prisma 唯一索引 (repoId, mrId, commitSha) 实现幂等防重：
 * 同一 MR 同一 commit 重复触发时，捕获 P2002 返回 duplicate。
 */
export async function enqueueTask(input: EnqueueInput): Promise<EnqueueResult> {
  let repo = await prisma.repository.findUnique({ where: { gitUrl: input.gitUrl } });
  if (!repo) {
    repo = await prisma.repository.create({
      data: { name: deriveName(input.gitUrl), gitUrl: input.gitUrl },
    });
  }

  try {
    const task = await prisma.task.create({
      data: {
        repoId: repo.id,
        mrId: input.mrId,
        commitSha: input.commitSha,
        baseRef: input.baseRef ?? "",
        headRef: input.headRef ?? "",
        source: input.source ?? null,
        gitlabProjectId: input.gitlabProjectId ?? null,
      },
    });
    // M4 SSE：新任务入队 → 广播 pending（若有报告页已打开监听）
    getEventBus().publish(task.id, { status: "pending" });
    return { status: "created", taskId: task.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.task.findUnique({
        where: {
          repoId_mrId_commitSha: {
            repoId: repo.id,
            mrId: input.mrId,
            commitSha: input.commitSha,
          },
        },
      });
      return { status: "duplicate", taskId: existing?.id ?? "" };
    }
    throw err;
  }
}
