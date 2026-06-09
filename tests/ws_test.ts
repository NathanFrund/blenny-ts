import { assertEquals } from "@std/assert";
import { WsConnection } from "@blenny/core/ws.ts";

Deno.test("WsConnection", async (t) => {
  await t.step("send() delivers bare HTML for ui messages", () => {
    const sent: string[] = [];
    // deno-lint-ignore no-explicit-any
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ intent: "ui", html: "<div>hello</div>" });

    assertEquals(sent, ["<div>hello</div>"]);
  });

  await t.step("send() delivers JSON string for data messages", () => {
    const sent: string[] = [];
    // deno-lint-ignore no-explicit-any
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ intent: "data", signals: { x: 1, y: 2 } });

    assertEquals(sent, [JSON.stringify({ x: 1, y: 2 })]);
  });

  await t.step("send() delivers bare script text for command messages", () => {
    const sent: string[] = [];
    // deno-lint-ignore no-explicit-any
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ intent: "command", script: "console.log('hi')" });

    assertEquals(sent, ["console.log('hi')"]);
  });
});
