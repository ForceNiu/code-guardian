import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueTask } from "@/lib/enqueue";
import {
  adaptWebhook,
  detectEvent,
  verifyGitHubSignature,
} from "@/lib/webhook-adapters";

// 统一入队格式（向后兼容：无平台事件头时按此解析，供 curl 手动测试 / 自定义发送方）
const UnifiedSchema = z.object({
  gitUrl: z.string().min(1),
  mrId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  commitSha: z.string().min(1),
  baseRef: z.string().optional(),
  headRef: z.string().optional(),
});

function enqueueError(err: unknown) {
  return NextResponse.json(
    { error: "enqueue failed", detail: err instanceof Error ? err.message : String(err) },
    { status: 500 },
  );
}

/**
 * Webhook 接收端：识别 GitLab MR / GitHub push / GitHub PR 三源事件，
 * 经适配层统一映射后入队。幂等：同一 repo + mrId + commitSha 重复触发返回 200。
 */
export async function POST(req: NextRequest) {
  const headers = req.headers;
  const secret = process.env.WEBHOOK_SECRET;
  const rawBody = await req.text().catch(() => null);
  if (rawBody === null) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const source = detectEvent(headers);

  // ---- 已识别的平台事件：先校验签名，再适配 ----
  if (source) {
    if (secret) {
      if (source === "gitlab-mr") {
        if (headers.get("x-gitlab-token") !== secret) {
          return NextResponse.json({ error: "invalid webhook token" }, { status: 401 });
        }
      } else if (!verifyGitHubSignature(secret, rawBody, headers.get("x-hub-signature-256"))) {
        return NextResponse.json({ error: "invalid webhook signature" }, { status: 401 });
      }
    }

    const adapted = adaptWebhook(source, rawBody);
    if (!adapted.ok) {
      return NextResponse.json({ error: adapted.error }, { status: 400 });
    }

    try {
      const { status, taskId } = await enqueueTask({ ...adapted.input, source: adapted.source });
      return NextResponse.json(
        { status, taskId, source: adapted.source },
        { status: status === "created" ? 201 : 200 },
      );
    } catch (err) {
      return enqueueError(err);
    }
  }

  // ---- 无平台事件头：按统一格式向后兼容 ----
  if (secret && headers.get("x-gitlab-token") !== secret) {
    return NextResponse.json({ error: "invalid webhook token" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const parsed = UnifiedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { status, taskId } = await enqueueTask(parsed.data);
    return NextResponse.json({ status, taskId }, { status: status === "created" ? 201 : 200 });
  } catch (err) {
    return enqueueError(err);
  }
}
