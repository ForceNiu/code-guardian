import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueTask } from "@/lib/enqueue";

// 兼容 GitLab MR 事件与自定义/手动 payload 的统一入参
const WebhookSchema = z.object({
  gitUrl: z.string().min(1),
  mrId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  commitSha: z.string().min(1),
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
});

/**
 * GitLab Webhook 接收端。
 * - 幂等：同一 repo + MR + commit 重复触发时返回 200（duplicate），不重复入队。
 * - 可选共享密钥校验：配置了 WEBHOOK_SECRET 时校验 X-Gitlab-Token。
 */
export async function POST(req: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const token = req.headers.get("x-gitlab-token");
    if (token !== secret) {
      return NextResponse.json({ error: "invalid webhook token" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const parsed = WebhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { status, taskId } = await enqueueTask(parsed.data);
    if (status === "duplicate") {
      return NextResponse.json({ status: "duplicate", taskId }, { status: 200 });
    }
    return NextResponse.json({ status: "created", taskId }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "enqueue failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
