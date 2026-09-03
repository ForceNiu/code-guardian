// M4 SSE 实时进度：把任务状态变更实时推给浏览器（text/event-stream）。
// 事件格式：
//   data: {"type":"connected"}
//   data: {"type":"status","status":"analyzing"}
//   data: {"type":"heartbeat"}
// 前端用 EventSource 订阅；SSE 失败（沙箱 dev 常见）时前端降级回轮询。

import { getEventBus } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // EventEmitter + ReadableStream 需 Node runtime

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const bus = getEventBus();
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream 已关闭（客户端断开），忽略
        }
      };

      // 连接建立即回一个 ack，便于前端确认 SSE 可用
      send({ type: "connected" });

      // 订阅任务状态变更，转发给浏览器
      const unsubscribe = bus.subscribe(id, (event) => {
        send({ type: "status", ...event });
      });

      // 心跳保活：防止代理 / 中间层空闲断开长连
      const heartbeat = setInterval(() => {
        send({ type: "heartbeat" });
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 关掉 nginx 缓冲，否则事件会被攒批延迟
    },
  });
}
