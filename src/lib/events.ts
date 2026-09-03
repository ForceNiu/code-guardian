// M4 SSE 实时进度：进程内事件总线（pub/sub）。
// scheduler / enqueue 在任务状态变更时 publish，SSE route 订阅并推送给浏览器。
//
// 为什么用「内存单例」而不是消息队列：
//   当前单实例部署，scheduler 与 SSE route 在同一 Node 进程内，内存 EventEmitter 足够。
//   多实例 / Serverless 部署时需换成 Redis pub/sub（预留 TODO，接口不变）。

import { EventEmitter } from "node:events";

/** 一次任务状态变更事件（taskId 由订阅上下文提供，负载只带状态） */
export interface TaskEvent {
  status: string;
  errorMessage?: string | null;
}

/** 防 HMR 热重载重复初始化：挂到 globalThis 上，同进程复用同一个 bus */
const globalForEvents = globalThis as unknown as {
  __taskEventBus?: TaskEventBus;
};

class TaskEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // 允许较多并发订阅（每个打开的 SSE 连接 + 单测各占一个监听器）
    this.emitter.setMaxListeners(1000);
  }

  /** 发布一次任务状态变更（同步触发所有订阅者） */
  publish(taskId: string, event: TaskEvent): void {
    this.emitter.emit(taskId, event);
  }

  /** 订阅某个任务的状态变更，返回取消订阅函数 */
  subscribe(taskId: string, handler: (event: TaskEvent) => void): () => void {
    this.emitter.on(taskId, handler);
    return () => {
      this.emitter.off(taskId, handler);
    };
  }

  /** 当前某任务的订阅者数量（供测试断言清理是否生效） */
  listenerCount(taskId: string): number {
    return this.emitter.listenerCount(taskId);
  }
}

export function getEventBus(): TaskEventBus {
  if (!globalForEvents.__taskEventBus) {
    globalForEvents.__taskEventBus = new TaskEventBus();
  }
  return globalForEvents.__taskEventBus;
}
