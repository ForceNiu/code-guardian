// C6 · `src/lib/ai/deepseek.ts` 的 DeepSeek 客户端单测（node:test + 模块 mock）
// 范式见 tests/security-index.test.ts 与技能 detection-regression-discipline ⑥
//
// 🔴 被 mock 的东西必须真实存在（上一版就栽在这：mock 了一个根本不存在的 askDeepSeek，
//    4 条断言全是「mock 和自己比」，0 覆盖率，而 npm test 报全绿）。
//    本模块真实导出只有：class DeepSeekLLM 与 createLLM()。全部断言都打在这两个上。
//
// 网络层怎么断：本模块刻意不用 fetch，而是 node:https / node:http / node:tls 直发
// （源码注释写了原因：undici 不读 HTTPS_PROXY 会挂死）。所以这里 mock 这两个内置模块，
// 而不是 mock fetch —— 一层 fake 就够，不必真起服务器。
// ⚠️ 运行依赖 `--experimental-test-module-mocks`（已写进 package.json 的 test 脚本）

import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// 假网络层的类型
// ---------------------------------------------------------------------------

type RespLike = EventEmitter & { statusCode: number };
type ReqLike = EventEmitter & {
  write: (chunk: string) => void;
  end: () => void;
  destroy: () => void;
};

type RequestOpts = {
  method?: string;
  host?: string;
  hostname?: string;
  port?: number | string;
  path?: string;
  headers?: Record<string, string | number>;
  createConnection?: unknown;
  timeout?: number;
};

type FakeResponse = { status: number; body: string };

// ---------------------------------------------------------------------------
// 可变 holder：mock 只注册一次，行为由各用例改写
// ---------------------------------------------------------------------------

const httpsHolder = {
  /** 依次消费的响应序列；只剩最后一个时反复用它 */
  responses: [] as FakeResponse[],
  calls: [] as RequestOpts[],
  /** 请求体 —— write() 就是天然的记录点，不用绕路截获 */
  bodies: [] as string[],
  /** 非空时让请求直接走 error 分支（模拟网络层异常） */
  failWith: null as Error | null,
};

const httpHolder = {
  calls: [] as RequestOpts[],
  /** CONNECT 隧道的响应码，非 200 即失败分支 */
  connectStatus: 200,
  connectError: null as Error | null,
};

let DeepSeekLLM: new (apiKey: string) => {
  invoke: (input: unknown, options?: { signal?: AbortSignal }) => Promise<{ content: string }>;
};
let createLLM: () => unknown;

// ---------------------------------------------------------------------------
// 假实现
// ---------------------------------------------------------------------------

function makeReq(): ReqLike {
  return Object.assign(new EventEmitter(), {
    write: (chunk: string) => {
      httpsHolder.bodies.push(chunk);
    },
    end: () => {},
    destroy: () => {},
  });
}

/** 假 https.request：记录调用参数与请求体，再按 holder 吐出响应（或抛网络错误） */
function fakeHttpsRequest(opts: RequestOpts, cb?: (resp: RespLike) => void): ReqLike {
  httpsHolder.calls.push(opts);
  const req = makeReq();

  process.nextTick(() => {
    if (httpsHolder.failWith) {
      req.emit("error", httpsHolder.failWith);
      return;
    }
    if (!cb) return;
    const step = httpsHolder.responses.length > 1
      ? httpsHolder.responses.shift() ?? { status: 200, body: "{}" }
      : httpsHolder.responses[0];
    if (!step) return;

    const resp = Object.assign(new EventEmitter(), { statusCode: step.status });
    cb(resp);
    // 等调用方把 data/end 监听挂上，再推数据
    process.nextTick(() => {
      resp.emit("data", step.body);
      resp.emit("end");
    });
  });

  return req;
}

/** 假 http.request：只用于 CONNECT 隧道。成功路径还要过 node:tls，不测那么深 */
function fakeHttpRequest(opts: RequestOpts): ReqLike {
  httpHolder.calls.push(opts);
  const req = makeReq();

  process.nextTick(() => {
    if (httpHolder.connectError) {
      req.emit("error", httpHolder.connectError);
      return;
    }
    const res = Object.assign(new EventEmitter(), { statusCode: httpHolder.connectStatus });
    req.emit("connect", res, { destroy: () => {} });
  });

  return req;
}

/** 让出事件循环一整轮（nextTick / IO 都会跑掉），只 flush microtask 不够 */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * 跑一个会退避重试的调用，用假定时器跳过真实等待。
 * 真实退避是 500/1000/2000ms（异常）或 1000/2000/4000ms（429），真等会让测试跑十几秒。
 *
 * 🔴 **顺序是命门**：`mock.timers.enable()` 必须在**被测代码开始调度定时器之前**调用。
 *    实测（2026-09-16）：先 `const p = llm.invoke(...)` 再 enable，第一个退避定时器
 *    已经被真的 setTimeout 注册走了，mock 根本接管不到 → tick 无效 → 测试卡到超时被杀（exit 137）。
 *    改成「先 enable，再 start()」后，同一段逻辑 5005ms → 3.2ms。
 *    → 所以这里收「启动函数」而不是「已启动的 promise」。
 */
async function runWithFakeTimers<T>(start: () => Promise<T>): Promise<T> {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const p = start();
    let done = false;
    p.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    for (let i = 0; i < 8 && !done; i++) {
      await flush();
      mock.timers.tick(30_000);
      await flush();
    }
    return await p;
  } finally {
    mock.timers.reset();
  }
}

// ---------------------------------------------------------------------------
// 环境隔离：代理变量决定走 CONNECT 还是直连，key 决定 createLLM 是否返回实例
// ---------------------------------------------------------------------------

const envBackup = { ...process.env };

before(async () => {
  mock.module("node:https", {
    defaultExport: { request: fakeHttpsRequest },
    namedExports: { request: fakeHttpsRequest },
  });
  mock.module("node:http", {
    defaultExport: { request: fakeHttpRequest },
    namedExports: { request: fakeHttpRequest },
  });

  const mod = await import("../src/lib/ai/deepseek");
  DeepSeekLLM = mod.DeepSeekLLM;
  createLLM = mod.createLLM;
});

after(() => {
  for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "DEEPSEEK_API_KEY"]) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k] as string;
  }
});

function resetNet() {
  httpsHolder.responses = [];
  httpsHolder.calls = [];
  httpsHolder.bodies = [];
  httpsHolder.failWith = null;
  httpHolder.calls = [];
  httpHolder.connectStatus = 200;
  httpHolder.connectError = null;
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
  delete process.env.DEEPSEEK_API_KEY;
}

function okResponse(content: string): FakeResponse {
  return { status: 200, body: JSON.stringify({ choices: [{ message: { content } }] }) };
}

/** 取最近一次请求发出去的 JSON body */
function lastBody(): Record<string, unknown> {
  return JSON.parse(httpsHolder.bodies[httpsHolder.bodies.length - 1] ?? "{}") as Record<
    string,
    unknown
  >;
}

// ---------------------------------------------------------------------------
// createLLM：无 key 返回 null，让调用方降级
// ---------------------------------------------------------------------------

test("createLLM 无 DEEPSEEK_API_KEY → 返回 null（调用方降级）", () => {
  resetNet();

  assert.equal(createLLM(), null);
});

test("createLLM 有 key → 返回 DeepSeekLLM 实例", () => {
  resetNet();
  process.env.DEEPSEEK_API_KEY = "sk-test";

  assert.ok(createLLM() instanceof DeepSeekLLM);
});

// ---------------------------------------------------------------------------
// 自检 + 请求形状
// ---------------------------------------------------------------------------

test("自检：invoke 返回 mock 独有的哨兵内容", async () => {
  resetNet();
  httpsHolder.responses = [okResponse("CONTENT-ONLY-MOCK-CAN-PRODUCE")];

  const res = await new DeepSeekLLM("sk-test").invoke("hello");

  assert.equal(res.content, "CONTENT-ONLY-MOCK-CAN-PRODUCE");
});

test("请求打到 api.deepseek.com 的 chat/completions，带 Bearer 鉴权", async () => {
  resetNet();
  httpsHolder.responses = [okResponse("ok")];

  await new DeepSeekLLM("sk-secret-key").invoke("hello");

  assert.equal(httpsHolder.calls.length, 1);
  const opts = httpsHolder.calls[0];
  assert.equal(opts.method, "POST");
  assert.equal(opts.hostname, "api.deepseek.com");
  assert.equal(opts.path, "/v1/chat/completions");
  assert.equal(opts.headers?.Authorization, "Bearer sk-secret-key");
});

test("请求体带模型 / 思考模式 / reasoning_effort / temperature", async () => {
  resetNet();
  httpsHolder.responses = [okResponse("ok")];

  await new DeepSeekLLM("k").invoke("hello");

  const body = lastBody();
  assert.equal(body.model, "deepseek-v4-flash");
  assert.deepEqual(body.thinking, { type: "enabled" });
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.temperature, 0.7);
});

test("200 但没有 choices → content 兜底为空串", async () => {
  resetNet();
  httpsHolder.responses = [{ status: 200, body: JSON.stringify({}) }];

  const res = await new DeepSeekLLM("k").invoke("hello");

  assert.equal(res.content, "");
});

// ---------------------------------------------------------------------------
// 消息转换 toDeepSeekMessages（未导出，经请求体观察）
// ---------------------------------------------------------------------------

test("字符串输入 → 单条 user 消息", async () => {
  resetNet();
  httpsHolder.responses = [okResponse("ok")];

  await new DeepSeekLLM("k").invoke("hello");

  assert.deepEqual(lastBody().messages, [{ role: "user", content: "hello" }]);
});

test("数组输入：system / ai / assistant 的角色映射正确，未知回落 user", async () => {
  resetNet();
  httpsHolder.responses = [okResponse("ok")];

  await new DeepSeekLLM("k").invoke([
    { _getType: () => "system", content: "你是助手" },
    { _getType: () => "ai", content: "上轮回答" },
    { _getType: () => "human", content: "这轮提问" },
    { role: "assistant", content: "用 role 兜底" },
    { role: "unknown-role", content: "未知回落 user" },
  ]);

  const messages = lastBody().messages as { role: string; content: string }[];
  assert.deepEqual(
    messages.map((m) => m.role),
    ["system", "assistant", "user", "assistant", "user"],
  );
});

test("非字符串 content → 走 JSON.stringify", async () => {
  resetNet();
  httpsHolder.responses = [okResponse("ok")];

  await new DeepSeekLLM("k").invoke([{ role: "user", content: { a: 1 } }]);

  const messages = lastBody().messages as { role: string; content: string }[];
  assert.equal(messages[0].content, JSON.stringify({ a: 1 }));
});

// ---------------------------------------------------------------------------
// 失败与重试（真实实现最多 4 次尝试）
// ⚠️ 注意：源码的 catch 块不区分「HTTP 错误」和「网络异常」，
//    所以 500 这类确定性错误**同样会被重试满 4 次**。下面前两条就是照这个真实行为写的。
// ---------------------------------------------------------------------------

test("非 200/429 的状态码也走重试，4 次后抛带状态码的错误", async () => {
  resetNet();
  httpsHolder.responses = [{ status: 500, body: "boom" }];

  const llm = new DeepSeekLLM("k");

  await assert.rejects(() => runWithFakeTimers(() => llm.invoke("hello")), /DeepSeek 返回 500/);
  assert.equal(httpsHolder.calls.length, 4, "500 会被 catch 住并重试到上限 4 次");
});

test("429 触发限流退避：重试后成功", async () => {
  resetNet();
  httpsHolder.responses = [{ status: 429, body: "rate limited" }, okResponse("RETRY-THEN-OK")];

  const res = await runWithFakeTimers(() => new DeepSeekLLM("k").invoke("hello"));

  assert.equal(res.content, "RETRY-THEN-OK");
  assert.equal(httpsHolder.calls.length, 2);
});

test("网络层异常 → 重试到上限后抛原错误", async () => {
  resetNet();
  httpsHolder.failWith = new Error("ECONNRESET socket hang up");
  httpsHolder.responses = [okResponse("ok")];

  await assert.rejects(
    () => runWithFakeTimers(() => new DeepSeekLLM("k").invoke("hello")),
    /ECONNRESET/,
  );
  assert.equal(httpsHolder.calls.length, 4);
});

test("signal 已 aborted → 立即抛「请求已被上层超时取消」，一次请求都不发", async () => {
  resetNet();
  httpsHolder.responses = [okResponse("ok")];
  const ac = new AbortController();
  ac.abort();

  await assert.rejects(
    () => new DeepSeekLLM("k").invoke("hello", { signal: ac.signal }),
    /请求已被上层超时取消/,
  );
  assert.equal(httpsHolder.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 两条出网通路：有代理走 CONNECT 隧道，无代理直连
// ---------------------------------------------------------------------------

test("配置了代理 → 走 CONNECT 隧道；隧道建立失败抛明确错误", async () => {
  resetNet();
  // 用明显是占位的域名：避免把「localhost 端口」这类本地元数据写进 PUBLIC 仓库
  process.env.HTTPS_PROXY = "http://proxy.example.com:7890";
  httpHolder.connectStatus = 407;
  httpsHolder.responses = [okResponse("ok")];

  await assert.rejects(
    () => runWithFakeTimers(() => new DeepSeekLLM("k").invoke("hello")),
    /代理 CONNECT 失败: 407/,
  );

  // CONNECT 失败同样落进那个「不区分错误类型」的 catch，所以也是重试到 4 次上限
  assert.equal(httpHolder.calls.length, 4);
  const opts = httpHolder.calls[0];
  assert.equal(opts.method, "CONNECT");
  assert.equal(opts.path, "api.deepseek.com:443");
  assert.equal(opts.host, "proxy.example.com", "隧道应打向代理地址，不是目标站");
});

test("未配代理 → 不建隧道，直接 https 直连", async () => {
  resetNet();
  httpsHolder.responses = [okResponse("ok")];

  await new DeepSeekLLM("k").invoke("hello");

  assert.deepEqual(httpHolder.calls, [], "无代理时不该有 CONNECT");
  assert.equal(httpsHolder.calls.length, 1);
});
