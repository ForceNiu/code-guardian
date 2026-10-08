import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildReportDraft, renderStaticReport, ReportUnavailableError } from "@/lib/export-report";
import type { AnalysisResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 导出静态报告：把已完成的 `Task.result` 渲染成一个单文件 HTML 供下载。
 *
 * 只读端点 —— 不触发分析、不调 AI，**零模型成本**。
 * 能力未配置（`AM_CLI_PATH` 为空或路径不存在）时按 fail-closed 返回 503，与两个写端点同口径：
 * 「没配这个功能」必须显式可见，不能让按钮点了没反应。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: { repo: { select: { name: true } } },
  });
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  if (!task.result) {
    return NextResponse.json({ error: "报告尚未生成" }, { status: 409 });
  }

  try {
    const draft = buildReportDraft({
      repoName: task.repo?.name ?? "—",
      mrId: task.mrId,
      baseRef: task.baseRef,
      headRef: task.headRef,
      result: task.result as unknown as AnalysisResult,
    });
    const html = renderStaticReport(draft);
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="cg-report-${task.mrId}.html"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ReportUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    // 内部堆栈不外泄（同 scheduler 的 errorMessage 处理口径），细节只在服务端日志。
    console.error("[export] 导出失败:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}
