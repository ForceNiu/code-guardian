// DeepSeek LLM 客户端（M3b AI 语义引擎）
// DeepSeek 兼容 OpenAI 协议，模型 deepseek-v4-flash。
//
// 🔧 为什么不用 @langchain/openai 的 ChatOpenAI：
// 在 Next.js 运行时里，ChatOpenAI（底层 OpenAI SDK）的 fetch 层会「间歇性挂死」——
// 后台长驻的 Next 服务出网优先走 HTTPS_PROXY（沙箱代理），而 Node 全局 fetch/undici
// 默认【不读】代理环境变量 → 沙箱直连被防火墙静默丢弃 → 挂起直到超时。
// （此坑在 interview-forge 项目已实测定位并修复）
//
// 本方案：直接用 Node 内置 http/tls/https 发 HTTPS 请求，显式走「HTTP 代理 CONNECT 隧道」，
// 规避挂死；未配置代理时直连兜底。对外暴露与 ChatOpenAI 等价的 invoke(messages) -> { content }，
// 供 LangGraph 节点零改动调用。

import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import https from "node:https";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

// 思考模式（V4）：开启后模型先输出思维链再给最终答案，提升判定/建议质量。
// 影响面判定需要推理，保留思考模式；reasoning_effort 用 low 平衡速度与质量（判定场景无需 max）。
const DEEPSEEK_THINKING: "enabled" | "disabled" = "enabled";
const DEEPSEEK_REASONING_EFFORT: "low" | "high" | "max" = "low";

type LLMMessage = { content?: unknown; _getType?: () => string; role?: string };

/** 把 LangChain 消息（string 或 Message[]）转成 DeepSeek 的 { role, content }[] */
function toDeepSeekMessages(input: unknown): { role: string; content: string }[] {
  if (typeof input === "string") return [{ role: "user", content: input }];
  return (input as LLMMessage[]).map((m) => {
    const type = typeof m._getType === "function" ? m._getType() : (m.role ?? "user");
    const role =
      type === "system" ? "system"
      : type === "assistant" || type === "ai" ? "assistant"
      : "user";
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    return { role, content };
  });
}

interface ProxyResp {
  status: number;
  body: string;
}

/** 无代理时直连 HTTPS（与 httpsViaProxy 等价，省去 CONNECT 隧道；代理不可用时兜底） */
function httpsDirect(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal,
  timeoutMs = 300000,
): Promise<ProxyResp> {
  const target = new URL(url);
  return new Promise<ProxyResp>((resolve, reject) => {
    const req = https.request(
      {
        method,
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        headers: { Host: target.hostname, "Content-Length": Buffer.byteLength(body), ...headers },
      },
      (resp) => {
        let data = "";
        resp.on("data", (c) => (data += c));
        resp.on("end", () => {
          clearTimeout(timer);
          resolve({ status: resp.statusCode ?? 0, body: data });
        });
      },
    );

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("直连请求超时"));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      req.destroy();
      reject(new Error("请求已取消"));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

/** 通过 HTTP 代理的 CONNECT 隧道发 HTTPS 请求（绕过 undici/Next fetch 的代理与打包问题） */
function httpsViaProxy(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal,
  timeoutMs = 300000,
): Promise<ProxyResp> {
  const proxy = (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").replace(/^https?:\/\//, "");
  if (!proxy) {
    return httpsDirect(url, method, headers, body, signal, timeoutMs);
  }

  const [ph, pp] = proxy.split(":");
  const target = new URL(url);
  const port = target.port || 443;

  return new Promise<ProxyResp>((resolve, reject) => {
    const timer = setTimeout(() => {
      connectReq.destroy();
      reject(new Error("代理请求超时"));
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      connectReq.destroy();
      reject(new Error("请求已取消"));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const connectReq = http.request({
      host: ph,
      port: Number(pp),
      method: "CONNECT",
      path: `${target.hostname}:${port}`,
      headers: { Host: `${target.hostname}:${port}` },
      timeout: 15000,
    });

    connectReq.on("connect", (res: http.IncomingMessage, socket: net.Socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        clearTimeout(timer);
        return reject(new Error(`代理 CONNECT 失败: ${res.statusCode}`));
      }
      const tlsSocket = tls.connect({ socket, servername: target.hostname }, () => {
        const req = https.request(
          {
            method,
            path: target.pathname + target.search,
            headers: { Host: target.hostname, "Content-Length": Buffer.byteLength(body), ...headers },
            createConnection: () => tlsSocket,
          },
          (resp) => {
            let data = "";
            resp.on("data", (c) => (data += c));
            resp.on("end", () => {
              clearTimeout(timer);
              resolve({ status: resp.statusCode ?? 0, body: data });
            });
          },
        );
        req.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        req.write(body);
        req.end();
      });
      tlsSocket.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });

    connectReq.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    connectReq.on("timeout", () => {
      connectReq.destroy();
      clearTimeout(timer);
      reject(new Error("CONNECT 超时"));
    });
    connectReq.end();
  });
}

export class DeepSeekLLM {
  constructor(private apiKey: string) {}

  async invoke(
    input: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<{ content: string }> {
    const messages = toDeepSeekMessages(input);
    const apiUrl = `${DEEPSEEK_BASE_URL}/v1/chat/completions`;
    const body = JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      thinking: { type: DEEPSEEK_THINKING },
      reasoning_effort: DEEPSEEK_REASONING_EFFORT,
      temperature: 0.7,
    });

    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (options?.signal?.aborted) {
        throw new Error("请求已被上层超时取消");
      }
      try {
        const res = await httpsViaProxy(
          apiUrl,
          "POST",
          { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body,
          options?.signal,
        );

        if (res.status === 200) {
          const data = JSON.parse(res.body) as {
            choices?: { message?: { content?: string } }[];
          };
          return { content: data?.choices?.[0]?.message?.content ?? "" };
        }
        if (res.status === 429) {
          lastErr = new Error("DeepSeek 返回 429（触发限流）");
          if (attempt < 4) {
            const wait = Math.min(2 ** (attempt - 1) * 1000, 8000);
            console.warn(`[LLM] 触发限流，退避 ${wait}ms 后重试（第 ${attempt}/4 次）`);
            await new Promise((r) => setTimeout(r, wait));
            continue;
          }
          throw lastErr;
        }
        throw new Error(`DeepSeek 返回 ${res.status}: ${res.body.slice(0, 200)}`);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        if (options?.signal?.aborted) throw err;
        lastErr = err;
        console.error(`[LLM] 调用异常（第 ${attempt} 次）：${err.message}`);
        if (attempt < 4) {
          const wait = Math.min(2 ** (attempt - 1) * 500, 4000);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw lastErr;
      }
    }
    throw lastErr ?? new Error("LLM 调用失败");
  }
}

/** 从环境变量读取 key 并创建 LLM；无 key 返回 null（调用方降级处理） */
export function createLLM(): DeepSeekLLM | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return new DeepSeekLLM(apiKey);
}
