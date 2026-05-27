import { assertEquals } from "@std/assert";
import { WsConnection } from "../src/core/ws.ts";

Deno.test("WsConnection", async (t) => {
  await t.step("send() delivers bare HTML for html messages", () => {
    const sent: string[] = [];
    // deno-lint-ignore no-explicit-any
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ html: "<div>hello</div>" });

    assertEquals(sent, ["<div>hello</div>"]);
  });

  await t.step("send() delivers JSON string for signals messages", () => {
    const sent: string[] = [];
    // deno-lint-ignore no-explicit-any
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ signals: { x: 1, y: 2 } });

    assertEquals(sent, [JSON.stringify({ x: 1, y: 2 })]);
  });

  await t.step("send() delivers bare script text", () => {
    const sent: string[] = [];
    // deno-lint-ignore no-explicit-any
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ script: "console.log('hi')" });

    assertEquals(sent, ["console.log('hi')"]);
  });

  await t.step("send() handles multiple fields in one message", () => {
    const sent: string[] = [];
    // deno-lint-ignore no-explicit-any
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({ html: "<div>a</div>", signals: { x: 1 }, script: "foo()" });

    assertEquals(sent, ["<div>a</div>", JSON.stringify({ x: 1 }), "foo()"]);
  });

  await t.step("send() sends nothing for empty message", () => {
    const sent: string[] = [];
    // deno-lint-ignore no-explicit-any
    const ws = { send: (s: string) => sent.push(s) } as any;
    const conn = new WsConnection(ws, "test-id");

    conn.send({});

    assertEquals(sent, []);
  });
});
