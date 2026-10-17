import { test } from "bun:test";
import { WsConnection } from "@blenny/core/ws.ts";
import { assertEquals } from "@std/assert";

test("WsConnection", async () => {
  await step("send() delivers bare HTML for ui messages", () => {
    const sent: string[] = [];
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ intent: "ui", html: "<div>hello</div>" });

    assertEquals(sent, ["<div>hello</div>"]);
  });

  await step("send() delivers JSON string for data messages", () => {
    const sent: string[] = [];
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ intent: "data", signals: { x: 1, y: 2 } });

    assertEquals(sent, [JSON.stringify({ x: 1, y: 2 })]);
  });

  await step("send() delivers bare script text for command messages", () => {
    const sent: string[] = [];
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ intent: "command", script: "console.log('hi')" });

    assertEquals(sent, ["console.log('hi')"]);
  });
});
