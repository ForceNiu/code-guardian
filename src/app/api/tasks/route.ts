import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enqueueTask } from "@/lib/enqueue";
import { safeEqual } from "@/lib/webhook-adapters";

export const dynamic = "force-dynamic";

// 任务列表（服务端分页，默认按创建时间倒序）
export async function GET(req: NextRequest) {
  const page = Number(req.nextUrl.searchParams.get("page") ?? "1");
  const size = Number(req.nextUrl.searchParams.get("size") ?? "20");
  const take = Math.min(Math.max(size, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;

  // done/failed 用服务端聚合计数，**不能**由前端在 size=50 的窗口里 filter ——
  // 任务超 50 条后窗口内计数会小于真实值（首页 Hero 三个数字都会错）。
  const [tasks, total, done, failed] = await Promise.all([
    prisma.task.findMany({
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: { repo: { select: { name: true, gitUrl: true } } },
    }),
    prisma.task.count(),
    prisma.task.count({ where: { status: "done" } }),
    prisma.task.count({ where: { status: "failed" } }),
  ]);

  return NextResponse.json({ tasks, total, done, failed, page, size: take });
}

// 手动触发：粘贴仓库地址 + base/head ref 拉起分析
const ManualSchema = z.object({
  gitUrl: z.string().min(1),
  mrId: z.string().min(1).default("manual"),
  commitSha: z.string().optional(),
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
});

/**
 * 🔴 2026-09-16（D5）写端点鉴权，**fail-closed**。
 *
 * 修复前：POST /api/tasks **完全没有鉴权** —— 任何能访问到部署地址的人都能提交任意 gitUrl
 * 拉起分析任务，而分析链路会真调 DeepSeek（**直接产生费用**）。这是本项目唯一一处
 * 「不做就会直接损失钱」的缺口。
 *
 * 口径：**未配置 token 即整段拒绝**，而不是「未配置就不校验」。
 * 安全默认必须是「关着」，否则漏配一个环境变量就等于公网敞开 —— 这正是 D5 的原始成因。
 */
const MANUAL_TRIGGER_HEADER = "x-manual-trigger-token";

export async function POST(req: NextRequest) {
  const expected = process.env.MANUAL_TRIGGER_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "手动触发已禁用：未配置 MANUAL_TRIGGER_TOKEN（fail-closed，请先设置该环境变量）" },
      { status: 503 },
    );
  }
  if (!safeEqual(req.headers.get(MANUAL_TRIGGER_HEADER) ?? "", expected)) {
    return NextResponse.json({ error: "invalid manual trigger token" }, { status: 401 });
  }

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
