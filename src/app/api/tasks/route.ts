import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enqueueTask } from "@/lib/enqueue";

export const dynamic = "force-dynamic";

// 任务列表（服务端分页，默认按创建时间倒序）
export async function GET(req: NextRequest) {
  const page = Number(req.nextUrl.searchParams.get("page") ?? "1");
  const size = Number(req.nextUrl.searchParams.get("size") ?? "20");
  const take = Math.min(Math.max(size, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: { repo: { select: { name: true, gitUrl: true } } },
    }),
    prisma.task.count(),
  ]);

  return NextResponse.json({ tasks, total, page, size: take });
}

// 手动触发：粘贴仓库地址 + base/head ref 拉起分析
const ManualSchema = z.object({
  gitUrl: z.string().min(1),
  mrId: z.string().min(1).default("manual"),
  commitSha: z.string().optional(),
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = ManualSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;
  // 手动触发没有单一 commit，去重键回退到 headRef
  const commitSha = data.commitSha ?? data.headRef ?? "manual";
  try {
    const result = await enqueueTask({ ...data, commitSha });
    return NextResponse.json(result, { status: result.status === "created" ? 201 : 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "enqueue failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
