// M4 SSE 事件总线单元测试（node:test + assert）
// 覆盖：publish→subscribe 送达 / 多订阅者隔离 / 取消订阅后不再收到 / 监听器清理。

import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventBus, type TaskEvent } from "../src/lib/events";

test("publish 事件送达订阅者", () => {
  const bus = getEventBus();
  const received: TaskEvent[] = [];
  const off = bus.subscribe("task-1", (e) => received.push(e));

  bus.publish("task-1", { status: "analyzing" });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], { status: "analyzing" });
  off();
});

test("不同任务的事件互相隔离", () => {
  const bus = getEventBus();
  const a: TaskEvent[] = [];
  const b: TaskEvent[] = [];
  const offA = bus.subscribe("task-a", (e) => a.push(e));
  const offB = bus.subscribe("task-b", (e) => b.push(e));

  bus.publish("task-a", { status: "done" });

  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
  offA();
  offB();
});

test("取消订阅后不再收到事件", () => {
  const bus = getEventBus();
  const received: TaskEvent[] = [];
  const off = bus.subscribe("task-2", (e) => received.push(e));

  off();
  bus.publish("task-2", { status: "failed", errorMessage: "boom" });

  assert.equal(received.length, 0);
});

test("取消订阅后监听器被清理（listenerCount 归零）", () => {
  const bus = getEventBus();
  const off = bus.subscribe("task-3", () => {});

  assert.equal(bus.listenerCount("task-3"), 1);
  off();
  assert.equal(bus.listenerCount("task-3"), 0);
});

test("event 负载含 errorMessage 时原样送达", () => {
  const bus = getEventBus();
  const received: TaskEvent[] = [];
  const off = bus.subscribe("task-4", (e) => received.push(e));

  bus.publish("task-4", { status: "failed", errorMessage: "git clone 失败" });

  assert.equal(received[0].errorMessage, "git clone 失败");
  off();
});
