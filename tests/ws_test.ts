import { assertEquals } from "@std/assert";
import { stripSseFrame, dispatchWsMessage } from "../src/core/ws.ts";
import { subscribe } from "../src/core/hub.ts";

Deno.test("stripSseFrame", async (t) => {
  await t.step("extracts bare HTML from datastar patch event", () => {
    const result = stripSseFrame(
      "event: datastar-patch-elements\ndata: <div>hello</div>\n\n",
    );
    assertEquals(result, ["<div>hello</div>"]);
  });

  await t.step("extracts JSON from datastar merge-signals event", () => {
    const result = stripSseFrame(
      "event: datastar-merge-signals\ndata: {\"x\":1,\"y\":2}\n\n",
    );
    assertEquals(result, ['{"x":1,"y":2}']);
  });

  await t.step("extracts script from datastar execute-script event", () => {
    const result = stripSseFrame(
      "event: datastar-execute-script\ndata: console.log('hi')\n\n",
    );
    assertEquals(result, ["console.log('hi')"]);
  });

  await t.step("handles multiple concatenated events", () => {
    const result = stripSseFrame(
      "event: datastar-patch-elements\ndata: <div>a</div>\n\nevent: datastar-patch-elements\ndata: <div>b</div>\n\n",
    );
    assertEquals(result, ["<div>a</div>", "<div>b</div>"]);
  });

  await t.step("returns empty array for empty string", () => {
    assertEquals(stripSseFrame(""), []);
  });

  await t.step("returns empty array for no data line", () => {
    assertEquals(stripSseFrame("event: foo\n\n"), []);
  });
});

Deno.test("dispatchWsMessage", async (t) => {
  await t.step("parses valid topic/payload and publishes", () => {
    const received: unknown[] = [];
    // deno-lint-ignore no-explicit-any
    const unsub = subscribe("spatial:tick" as any, (p: unknown) => {
      received.push(p);
    });
    dispatchWsMessage(JSON.stringify({ topic: "spatial:tick", payload: { x: 10 } }));
    assertEquals(received, [{ x: 10 }]);
    unsub();
  });

  await t.step("ignores invalid JSON silently", () => {
    dispatchWsMessage("not json");
  });

  await t.step("ignores missing topic silently", () => {
    dispatchWsMessage(JSON.stringify({ payload: { x: 1 } }));
  });

  await t.step("ignores missing payload silently", () => {
    dispatchWsMessage(JSON.stringify({ topic: "spatial:tick" }));
  });
});
